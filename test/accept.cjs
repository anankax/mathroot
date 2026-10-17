// 数根验收：一条命令跑完，不绿就不是绿。
//
// 用法:
//   node test/accept.cjs            # L1 静态契约 + L2 协议/纯函数（不花钱、不联网）
//   node test/accept.cjs --red      # 跑完绿，再把实现故意改坏，验"尺子真能报红"
//   node test/accept.cjs --net      # 再加 L3：真调一次模型（花钱，用你自己的 Key）
//   node test/accept.cjs --json     # 只输出 JSON，给别的脚本吃
//
// 为什么要有这个文件，而不是继续往 test/ 里加 probe_xxx.cjs：
//   那七百多个脚本是"一个问题一个"，量完就死。它们能回答"这个数是多少"，
//   回答不了"这次改动把别处弄坏了没有"——而后者才是每次改产品真正要问的。
//   这个文件只做一件事：把"该一直是怎样"写成断言，**能重复跑**。
//
// 三条自己给自己定的规矩（都吃过亏）:
//   ① 每条断言尽量配**第二把尺**。不信函数的返回值，就去截真发出去的请求体；
//      不信配置项在，就同时看"路由真的读到了它"。
//   ② 该拒绝的地方必须有反例。没有反例的绿是假的绿——空集合上"全部通过"恒真。
//   ③ 尺子本身先跑红（--red）。把实现改坏一处，对应那条必须变红；
//      它要是不红，说明它量的不是那件事。
//
// ★ 浏览器是**隔离的**：自己起一个临时 profile，端口默认 9224。
//   绝不连 9222（那是他正在用的浏览器），也不往里写一个字节。
//   窗口是可见的（不加 --headless）——验收得让他能看见，不是听我一面之词。

const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { spawn, spawnSync } = require('child_process');

function reqWs() {
  const a = path.join(process.env.USERPROFILE || os.homedir(), '.claude', 'skills', 'browser', 'node_modules', 'ws');
  const b = path.join(process.env.USERPROFILE || os.homedir(), '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws');
  return require(fs.existsSync(a) ? a : b);
}
const WebSocket = reqWs();

const WEB_PORT = Number(process.env.ACCEPT_WEB_PORT || 8151);
const CDP_PORT = Number(process.env.ACCEPT_CDP_PORT || 9224);
const PAGE_URL = 'http://localhost:' + WEB_PORT + '/index.html';
const WITH_NET = process.argv.includes('--net');
const RED = process.argv.includes('--red');
const JSON_ONLY = process.argv.includes('--json');

let server = null, chrome = null, chromeSpawned = false, profileDir = null;
let ws = null, msgId = 0;
const waiters = new Map();
const pageErrors = [], loadFails = [], loadSoft = [];
// requestId → URL：报加载失败时得说清**是哪一个文件**失败了，不然只看见
// "Stylesheet: ERR_CONNECTION_RESET"，修的人不知道去查哪儿。
const reqUrls = new Map();

// ── 小工具 ────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((res, rej) => {
    const r = http.get(url, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej);
    r.setTimeout(2000, () => { r.destroy(new Error('timeout')); });
  });
}

async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await httpGet(url); return true; } catch (e) {}
    await sleep(300);
  }
  return false;
}

function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
  ].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return null;
}

// ── CDP ──────────────────────────────────────────────────────
function send(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    waiters.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => {
      if (waiters.has(id)) {
        waiters.delete(id);
        reject(new Error('CDP 超时: ' + method));
      }
    }, timeoutMs || 30000);
  });
}

async function evalPage(fnOrExpr, timeoutMs) {
  const expr = typeof fnOrExpr === 'function' ? '(' + fnOrExpr.toString() + ')()' : fnOrExpr;
  const r = await send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true
  }, timeoutMs);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('页面里抛了: ' + (d.exception && d.exception.description || d.text));
  }
  return r.result ? r.result.value : undefined;
}

async function waitReady(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await evalPage('!!(window.SR && window.SR.api && window.SR.render && window.SR.blueprint)')) return true;
    } catch (e) {}
    await sleep(400);
  }
  return false;
}

async function reload() {
  pageErrors.length = 0;
  loadFails.length = 0;
  loadSoft.length = 0;
  await send('Page.navigate', { url: PAGE_URL + '?accept=' + Date.now() });
  await sleep(800);
  return waitReady(40000);
}

// ── 用例 ─────────────────────────────────────────────────────
// 每条 fn 都在**页面里**跑，返回 {ok, got, want, note}。
// ★ 不许把 Node 这边的东西写进 fn——它会被 toString 送进浏览器。

const CASES = [
  {
    id: 'L1.boot', layer: 1, name: '页面起得来，关键模块都在',
    fn: function () {
      var need = ['api', 'render', 'blueprint', 'WORKS', 'BACKENDS'];
      var missing = need.filter(function (k) { return !window.SR || !window.SR[k]; });
      return {
        ok: missing.length === 0,
        got: { missing: missing, works: window.SR && window.SR.WORKS ? Object.keys(window.SR.WORKS).length : 0 },
        want: { missing: [], works: 6 }
      };
    }
  },
  {
    id: 'L1.cap-material', layer: 1, name: '组卷的输出上限：DeepSeek 一档、GLM 一档，互不牵连',
    // 第二把尺：函数返回值必须等于配置里那一格（防"函数走的是别的分支"）。
    fn: function () {
      var A = window.SR.api, B = window.SR.BACKENDS, W = window.SR.WORKS.material;
      var got = {
        glm: A.输出上限('material', B.glm),
        ds: A.输出上限('material', B.deepseek),
        rawGlm: W.maxTokens,
        rawDs: W.maxTokensDeepseek
      };
      var ok = got.glm === got.rawGlm &&
               got.ds === got.rawDs &&
               got.glm === 3072 &&          // 免费链的账没被顺手改宽
               got.ds >= 4096 &&            // 一份 30 题的卷子要写得完
               got.ds > got.glm;            // 两档真的分开了
      return { ok: ok, got: got, want: { glm: 3072, ds: '>=4096 且等于 maxTokensDeepseek' } };
    }
  },
  {
    id: 'L1.chains', layer: 1, name: 'DeepSeek 两条模型链是写明白的，不是碰巧回落到 models',
    fn: function () {
      var B = window.SR.BACKENDS.deepseek;
      var own = Object.prototype.hasOwnProperty;
      var got = {
        ownImage: own.call(B, 'modelsImage'),
        ownText: own.call(B, 'modelsText'),
        image: B.modelsImage,
        text: B.modelsText,
        // 第二把尺：路由实际取到的那一份
        routedImage: window.SR.api.backend('deepseek').modelsImage
      };
      var ok = got.ownImage && got.ownText &&
               Array.isArray(got.image) && got.image.length > 0 &&
               Array.isArray(got.text) && got.text.length > 0 &&
               got.image[0] === 'deepseek-flash' && got.text[0] === 'deepseek-flash' &&
               got.routedImage[0] === 'deepseek-flash';
      return { ok: ok, got: got, want: '两条链都是自有属性，路由读到同一份' };
    }
  },
  {
    id: 'L2.fence-parse', layer: 2, name: '三种围栏都摘干净：正文留下，机器看的藏起来',
    fn: function () {
      var s = '第一句\n```ggb 数轴\n#清空\nA=(0,0)\n```\n中间\n```想说\nA．1|B．2\n```\n```材料\n第1题\n```\n最后';
      var p = window.SR.render.parseFences(s, {});
      var got = {
        ggb: p.ggb.length, ggbInfo: p.ggbInfo[0], say: p.say.length, mat: p.mat.length,
        visible: p.visible, pending: p.pending
      };
      var ok = got.ggb === 1 && got.ggbInfo === '数轴' && got.say === 1 && got.mat === 1 &&
               got.visible.indexOf('第一句') >= 0 && got.visible.indexOf('中间') >= 0 &&
               got.visible.indexOf('最后') >= 0 &&
               got.visible.indexOf('#清空') < 0 && got.visible.indexOf('第1题') < 0 &&
               got.pending === '';
      return { ok: ok, got: got, want: '正文三句都在，围栏内容一句不在，pending 为空' };
    }
  },
  {
    id: 'L2.fence-half', layer: 2, name: '半截围栏：流式当中藏住，收尾那一遍才交出去',
    // 这一对是第 26 轮那个下标 bug 的哨兵：同一段文字，只差 opts.收尾，
    // 结果必须相反。两个都写成"对"的那种断言，说明它根本没在判这件事。
    fn: function () {
      var txt = '正文\n```ggb\n#清空\nA=(0,0)';
      var mid = window.SR.render.parseFences(txt, {});
      var end = window.SR.render.parseFences(txt, { 收尾: true });
      var got = {
        midGgb: mid.ggb.length, midPending: mid.pending,
        midVisible: mid.visible,
        endGgb: end.ggb.length, endBody: end.ggb[0]
      };
      var ok = got.midGgb === 0 &&
               got.midPending.indexOf('#清空') >= 0 &&
               got.midVisible.indexOf('#清空') < 0 &&
               got.endGgb === 1 &&
               got.endBody.indexOf('A=(0,0)') >= 0;
      return { ok: ok, got: got, want: '流式：0 块 + 藏进 pending；收尾：1 块且含 A=(0,0)' };
    }
  },
  {
    id: 'L2.gate-go', layer: 2, name: '点头判据：真点头要放过去（含最短的那几句）',
    // "按这个办" 是空前缀那个坑的活哨兵（''.indexOf('') === 0）。
    // ★ 后两句是 2026-10-17 把回看距离从 1 个字放到 3 个字时**必须一起钉住**的边界：
    //   「不要再改了，按这个办」的否定在**前一个分句**，离得远，得放行；
    //   「按这个办，第3题改小」是**点头 + 附加改动**——GO 那段自己写着"交代了改动就先改掉"。
    fn: function () {
      var B = window.SR.blueprint;
      var yes = ['就按这个办', '按这个办', '出吧', '可以，出吧', '照这个来',
                 '不要再改了，按这个办', '按这个办，第3题改小'];
      var no = yes.filter(function (s) { return !B.是点头(s); });
      var segOk = B.段('就按这个办') === window.SR.PROMPT_BLUE_GO &&
                  B.段('再改改第三题') === window.SR.PROMPT_BLUE_ASK;
      return {
        ok: no.length === 0 && segOk,
        got: { 没放过去的: no, 段对: segOk },
        want: { 没放过去的: [], 段对: true }
      };
    }
  },
  {
    id: 'L2.gate-no', layer: 2, name: '点头判据的反例：带否定、带改动的都不能当成点头',
    // ★ 2026-10-17 之前这里红两条：判据只看紧挨着的一个字，"不要按这个办" 中间
    //   隔了个"要"就穿过去了，"不行，按这个办" 隔得更远。产品改成回看三个字之后转绿。
    //   ⚠ 前两句是那次修复的**直接反例**，删掉它们这条就退回"空集合上全部通过"。
    fn: function () {
      var no = [
        '不要按这个办，先把第2题改小',
        '别按这个办',
        '不行，按这个办',
        '先别出',
        '这道题就这样出，第三题再加个图，另外把第一题的数字换成负的，难度提上去，答案也要'
      ];
      var bad = no.filter(function (s) { return window.SR.blueprint.是点头(s); });
      return { ok: bad.length === 0, got: { 被判成点头的: bad }, want: { 被判成点头的: [] } };
    }
  },
  {
    id: 'L2.req-body', layer: 2, name: '第二把尺：真发出去的请求体里，max_tokens 跟配置一致',
    // 不真打网络：把 fetch 换掉，自己造一条 SSE 回来。量的是"发了什么"，不是"写了什么"。
    fn: async function () {
      var out = {}, origFetch = window.fetch, origGate = null;
      var oldBackend = window.SR.api.getBackendId(), oldKey = null;
      try { oldKey = window.SR.api.getKey(); } catch (e) {}
      try {
        if (window.SR.GATE) { origGate = window.SR.GATE.on; window.SR.GATE.on = false; }
        var bodies = [];
        window.fetch = function (url, opt) {
          var u = String(url);
          if (u.indexOf('chat/completions') >= 0 || u.indexOf('api.deepseek.com') >= 0 || u.indexOf('bigmodel.cn') >= 0) {
            try { bodies.push(JSON.parse(opt.body)); } catch (e) {}
            var s = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
                    'data: {"usage":{"prompt_tokens":10,"completion_tokens":1}}\n\n' +
                    'data: [DONE]\n\n';
            return Promise.resolve(new Response(new Blob([s]).stream(), {
              status: 200, headers: { 'Content-Type': 'text/event-stream' }
            }));
          }
          return origFetch.apply(window, arguments);
        };

        window.SR.api.setBackend('deepseek');
        window.SR.api.setKey('sk-accept-0000000000000000');
        await window.SR.api.ask({ work: 'material', text: '出一道题', history: [] });
        window.SR.api.setBackend('glm');
        await window.SR.api.ask({ work: 'material', text: '出一道题', history: [] });

        out.sent = bodies.map(function (b) {
          return { model: b.model, max_tokens: b.max_tokens, stream: b.stream };
        });
      } finally {
        window.fetch = origFetch;
        if (window.SR.GATE && origGate !== null) window.SR.GATE.on = origGate;
        window.SR.api.setBackend(oldBackend);
        if (oldKey == null) window.SR.api.forgetKey(); else window.SR.api.setKey(oldKey);
      }
      var A = window.SR.api, B = window.SR.BACKENDS;
      var ds = out.sent[0], glm = out.sent[1];
      var wantDs = A.输出上限('material', B.deepseek), wantGlm = A.输出上限('material', B.glm);
      var ok = !!(ds && glm) &&
               ds.max_tokens === wantDs && glm.max_tokens === wantGlm &&
               ds.max_tokens > glm.max_tokens;
      out.want = { deepseek: wantDs, glm: wantGlm };
      return { ok: ok, got: out, want: out.want };
    }
  },
  // ── 六个工位的纯函数：每条都配一个反例 ──────────────────────
  {
    id: 'L2.scores-basic', layer: 2, name: '学情：学生数、题号、得分率都算对',
    // 第二把尺：不只看"有得分率"，看具体两道题各是多少，而且顺序是低→高。
    fn: function () {
      var t = [
        '学号\t姓名\t1\t2',
        '1\t张三\t4\t2',
        '2\t李四\t4\t2',
        '3\t王五\t4\t1',
        '4\t赵六\t4\t1',
        '5\t钱七\t3\t1',
        '满分\t\t5\t5'
      ].join('\n');
      var r = window.SR.scores.解析(t);
      var got = {
        err: r.err || '', 学生数: r.学生数,
        题列: (r.题列 || []).map(function (x) { return x.标签; }),
        每题: (r.每题 || []).map(function (x) { return [x.题号, x.得分率]; }),
        有得分率: r.有得分率, 来源: r.得分率来源
      };
      var ok = !r.err && got.学生数 === 5 &&
               got.题列.join(',') === '1,2' &&
               got.每题.length === 2 &&
               got.每题[0][0] === 2 && got.每题[0][1] === 28 &&
               got.每题[1][0] === 1 && got.每题[1][1] === 76 &&
               got.有得分率 === true && got.来源 === '算';
      return { ok: ok, got: got, want: { 学生数: 5, 每题: '第2题28%在前、第1题76%在后', 来源: '算' } };
    }
  },
  {
    id: 'L2.scores-messy', layer: 2, name: '学情：汇总行不算学生、空列不算题、11-18 是合并的一列',
    // 这三样都是真人成绩表里出现过的（见 js/scores.js 里的实测注释），
    // 每一样坏掉时屏幕上都**看着正常**：平均分偏一点、少一道题、百分数对不上，
    // 老师不会怀疑读数，只会怀疑自己的表。
    fn: function () {
      var t = [
        '学号\t姓名\t1\t11-18\t120',
        '1\t张三\t10\t20\t',
        '2\t李四\t10\t20\t',
        '3\t王五\t10\t10\t',
        '班级均分\t\t10\t16.67\t',
        '班级得分率%\t\t100\t41.67\t'
      ].join('\n');
      var r = window.SR.scores.解析(t);
      var got = {
        err: r.err || '', 学生数: r.学生数,
        题列: (r.题列 || []).map(function (x) { return x.标签; }),
        每题: (r.每题 || []).map(function (x) { return [x.题号, x.得分率]; }),
        来源: r.得分率来源, 汇总行: r.汇总行们,
        首题号: r.首题号, 末题号: r.末题号, 满分对不齐: r.满分对不齐
      };
      var ok = !r.err && got.学生数 === 3 &&
               got.题列.join(',') === '1,11–18' &&
               got.每题.length === 2 && got.每题[0][0] === 11 && got.每题[0][1] === 41.67 &&
               got.每题[1][0] === 1 && got.每题[1][1] === 100 &&
               got.来源 === '表' &&
               got.汇总行.length === 2 &&
               got.首题号 === 1 && got.末题号 === 18 &&
               got.满分对不齐 === false;
      return {
        ok: ok, got: got,
        want: { 学生数: 3, 题列: '1,11–18', 来源: '表（41.67 不许四舍五入）', 汇总行: 2, 末题号: 18 }
      };
    }
  },
  {
    id: 'L2.scores-neg', layer: 2, name: '学情：只有总分的表要说出"没有每题一列"，别笼统要表',
    fn: function () {
      var a = window.SR.scores.解析(['学号\t姓名\t分数', '1\t张三\t95', '2\t李四\t88'].join('\n'));
      var b = window.SR.scores.解析('只有一行');
      var got = { 只有总分: a.kind, 有说法: !!a.err, 太小: b.kind, 有说法2: !!b.err };
      var ok = got.只有总分 === 'noq' && got.有说法 && got.太小 === 'notable' && got.有说法2;
      return { ok: ok, got: got, want: { 只有总分: 'noq', 太小: 'notable' } };
    }
  },
  {
    id: 'L2.material-blocks', layer: 2, name: '组卷→材料：编号行拆得开、掉了围栏也捡得回来',
    // 第二把尺：pickSource 选中的那一份**必须真比另一份厚**，不是"挑到了就行"。
    fn: function () {
      var B = window.SR.produce;
      var src = ['#0 某某中学 2026 七年级数学', '#2', '#1 1．计算 $(-2)^3$',
                 '#1 A．-8', '#1 [图] 数轴; A=(-2,0)', '#6 [图]', '正文没有号'].join('\n');
      var bl = B.parseBlocks(src);
      var lf = B.lift(['#1 一', '正文', '#2 二', '#0 三'].join('\n'));
      var p1 = B.pickSource(['#1 一', '#2 二', '#0 三', '正文'].join('\n'), '#1 一');
      var p2 = B.pickSource(['#1 一', '正文'].join('\n'), '#9 围栏里');
      var got = {
        段数: bl.length,
        格式号: JSON.stringify(bl.map(function (x) { return x.slot; })),
        图: (bl[4] || {}).fig || '',
        漏号落正文: bl[5] && bl[5].slot === null,
        空的图行没成段: !bl.some(function (x) { return x.slot === 6; }),
        捡回: { n: lf.n, rest: lf.rest },
        两条来源: { from: p1.from, body行: p1.body.split('\n').length, rest: p1.rest },
        围栏顶住: { from: p2.from, body: p2.body, rest: p2.rest }
      };
      var ok = got.段数 === 6 &&
               got.格式号 === '[0,2,1,1,1,null]' &&
               got.图 === '数轴; A=(-2,0)' &&
               got.漏号落正文 && got.空的图行没成段 &&
               got.捡回.n === 3 && got.捡回.rest === '正文' &&
               got.两条来源.from === 'lift' && got.两条来源.body行 === 3 && got.两条来源.rest === '正文' &&
               got.围栏顶住.from === 'fence' && got.围栏顶住.body === '#9 围栏里' && got.围栏顶住.rest === '正文';
      return { ok: ok, got: got, want: '6 段 / 图在第 5 段 / 3 行被捡回 / 两条来源都比过' };
    }
  },
  {
    id: 'L2.memo-probs', layer: 2, name: '学情口袋：只认 ```材料 里的题号，一道题不许数成两道',
    fn: function () {
      var M = window.SR.memo;
      M.clear();
      var a = M.countProbs('```材料\n#1 1．计算\n#1 A．选项\n#1 2．下一题\n```');
      var b = M.countProbs('1．甲\n2．乙\n3．丙');                 // 围栏外面：一个字都不认
      var c = M.countProbs('**变式一**（改条件）\n变式二（换数字）'); // 命题那一格：中文变式
      M.pushTurn('assistant', '```材料\n#1 12．题\n#1 13．题\n```\n后文 1．不算', 'material');
      M.pushTurn('assistant', '```材料\n#1 12．重复\n```', 'material');
      var pl = M.probs();
      M.clear();
      var got = { 材料里两道: a, 围栏外: b, 变式: c, 口袋题号: pl };
      var ok = a === 2 && b === 0 && c === 2 && pl.join(',') === '12,13';
      return { ok: ok, got: got, want: { 材料里两道: 2, 围栏外: 0, 变式: 2, 口袋题号: '12,13（去重）' } };
    }
  },
  {
    id: 'L2.landing-route', layer: 2, name: '首屏分流：该认的认，含糊的和打招呼一个都不许硬猜',
    fn: function () {
      var L = window.SR.landing;
      var r = function (s) { return L.route(s); };
      var got = {
        周练卷: r('出一份周练卷').work,
        画图: r('画个函数图象').work,
        讲评: r('讲评一下这次考试').work,
        低到高: r('得分率从低到高排').work,
        含糊: r('得分率排一排').work,
        打招呼: r('你好').work,
        课题: r('3.1 代数式').work + '/' + r('3.1 代数式').sure
      };
      var ok = got.周练卷 === 'material' && got.画图 === 'draw' &&
               got.讲评 === 'review' && got.低到高 === 'grade' &&
               got.含糊 === '' && got.打招呼 === '' && got.课题 === 'prep/0';
      return { ok: ok, got: got,
               want: { 周练卷: 'material', 画图: 'draw', 讲评: 'review', 低到高: 'grade',
                       含糊: '', 打招呼: '', 课题: 'prep/0' } };
    }
  },
  {
    id: 'L2.draw-cards', layer: 2, name: '作图：该翻哪张卡，翻出来的得是那张',
    // 这几句是从提示词自己的门词里挑的，不是"看着像"；反例是"今天天气不错"。
    fn: function () {
      var D = window.SR.drawkb, G = window.SR.ggbcmds;
      var names = function (a) { return a.map(function (k) { return k.名; }); };
      var got = {
        立体: names(D.翻('画个正方体，让它转起来')),
        圆: names(D.翻('画一个圆，标出半径')),
        中线: names(D.翻('三角形三条中线')),
        三视图: names(D.翻('画三视图')),
        无关: names(D.翻('今天天气不错')),
        极值: names(G.翻('标出它的最低点')),
        最多四张: names(G.翻('画正方体，标角度，画中线，作垂直平分线，翻折，画统计图，动点，圆'))
      };
      var ok = got.立体[0] === '立体几何（三维画板）' &&
               got.圆[0] === '圆' &&
               got.中线[0] === '中线、重心' &&
               got.三视图.indexOf('三视图、展开图') >= 0 &&
               got.无关.length === 0 &&
               got.极值[0] === '顶点/极值' &&
               got.最多四张.length === 4;
      return { ok: ok, got: got,
               want: { 立体: '立体几何（三维画板）', 圆: '圆', 中线: '中线、重心',
                       无关: [], 极值: '顶点/极值', 最多四张: 4 } };
    }
  },
  {
    id: 'L2.draw-chain', layer: 2, name: '作图链只留能用的一颗：头一颗挤掉也回它，不去找那颗不说话/塞不下的',
    // 2026-10-17 孔老师截图那一趟：板上好好的 8 件，只有 1 条没认，产品自修，
    // 回来的却是「模型没说出话来」。量下来是降级链本身的问题（test/_repair_empty.cjs）：
    //   glm-4.1v-thinking-flash 回一千多字没闭口的 `<think>`，正文 0 字；
    //   glm-4v-flash 在这一格 16.6k 的请求体上直接 1210。
    // 这条用例**不看配置**，看真发出去的请求体：让头一颗连续 429 两次，
    // （旧链子这个时候必然掉到第二颗）→ 第三次必须还是 glm-4.6v-flash。
    // 第二把尺：断言**两条备胎一次都没被请求过**，而不只是"最后成功了"。
    timeout: 40000,
    fn: async function () {
      var A = window.SR.api;
      A.setBackend('glm');
      if (window.SR.GATE) window.SR.GATE.on = false;
      var 原名 = window.SR.WORKS.draw.chainModels;
      var orig = window.fetch;
      var 发过 = [], n = 0;
      window.fetch = function (u, o) {
        if (String(u).indexOf('chat/completions') < 0) return orig.apply(window, arguments);
        var b = {}; try { b = JSON.parse(o.body); } catch (e) {}
        发过.push(b.model); n++;
        if (n <= 2) return Promise.resolve(new Response('', { status: 429 }));
        var s = 'data: {"choices":[{"delta":{"content":"```ggb\\n#清空\\nA=(0,0)\\nB=(4,0)\\n```"}}]}\n\n' +
                'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
                'data: {"usage":{"prompt_tokens":10,"completion_tokens":8}}\n\n' +
                'data: [DONE]\n\n';
        return Promise.resolve(new Response(new Blob([s]).stream(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      };
      var r, 抛 = null;
      try {
        r = await A.ask({
          work: 'draw', text: '画个三角形', history: [],
          // 带一张图 = "这一轮手里有图"，避开 textHead 把板空着的第一轮改派文字模型。
          parts: [{ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }]
        });
      } catch (e) { 抛 = String(e && e.message || e); }
      finally {
        window.fetch = orig;
        if (原名 === undefined) delete window.SR.WORKS.draw.chainModels;
        else window.SR.WORKS.draw.chainModels = 原名;
      }
      var 备胎 = ['glm-4.1v-thinking-flash', 'glm-4v-flash'];
      var 漏了 = 发过.filter(function (m) { return 备胎.indexOf(m) >= 0; });
      var got = {
        发出去的: 发过,
        备胎被请求: 漏了,
        回话: r && (r.text || r.error),
        抛了: 抛
      };
      var ok = !抛 && 发过.length >= 3 &&
               发过.every(function (m) { return m === 'glm-4.6v-flash'; }) &&
               漏了.length === 0 &&
               !!(r && r.text && r.text.indexOf('```ggb') >= 0);
      return {
        ok: ok, got: got,
        want: { 发出去的: '3 次全是 glm-4.6v-flash', 备胎被请求: [], 回话: '含 ```ggb' }
      };
    }
  },
  {
    id: 'L2.robustness', layer: 2, name: '空回复/半截围栏/超长文本：纯函数不许抛，也不许崩在空值上',
    // 输入只用**真会出现的东西**：空串、没写完的围栏、模型只回了一个 ``` 或空行。
    // 不拿对象/数字去凑——那不是产品会遇到的情况，拿它报出来的红是假警报。
    fn: function () {
      var C = window.SR;
      var bads = [null, undefined, '', ' ', '```', '```材料\n', '```ggb\n#清空',
                  '###', '#1', '一'.repeat(3000), '\n\n\n', '{}', '[]'];
      var calls = [
        ['render.parseFences', function (x) { C.render.parseFences(x, {}); }],
        ['blueprint.是点头', function (x) { C.blueprint.是点头(x); }],
        ['blueprint.段', function (x) { C.blueprint.段(x); }],
        ['scores.解析', function (x) { C.scores.解析(x); }],
        ['produce.parseBlocks', function (x) { C.produce.parseBlocks(x); }],
        ['produce.lift', function (x) { C.produce.lift(x); }],
        ['produce.pickSource', function (x) { C.produce.pickSource(x, x); }],
        ['memo.countProbs', function (x) { C.memo.countProbs(x); }],
        ['landing.route', function (x) { C.landing.route(x); }],
        ['drawkb.翻', function (x) { C.drawkb.翻(x); }],
        ['ggbcmds.翻', function (x) { C.ggbcmds.翻(x); }],
        ['filterCopiedChips', function (x) { C.filterCopiedChips([x]); }],
        ['chips.parseChain', function (x) { C.parseChain(x); }],
        ['chips.parseRoutes', function (x) { C.parseRoutes(x); }],
        ['chips.hasChain', function (x) { C.hasChain(x); }],
        ['chips.dimFromTexts', function (x) { C.dimFromTexts([x]); }],
        ['chips.drawCodeFromTexts', function (x) { C.drawCodeFromTexts([x]); }],
        ['chips.figureKind', function (x) { C.figureKind(x); }],
        ['chips.polyVerts', function (x) { C.polyVerts(x); }],
        ['chips.bisectedVertex', function (x) { C.bisectedVertex(x); }],
        ['chips.ggbLooks3D', function (x) { C.ggbLooks3D(x); }],
        ['tpl.plain', function (x) { C.tpl.plain(x); }],
        ['tpl.findCut', function (x) { C.tpl.findCut([x]); }],
        ['tpl.block', function (x) { C.tpl.block(x, 'w:p'); }]
      ];
      var threw = [], n = 0;
      calls.forEach(function (c) {
        bads.forEach(function (b) {
          n++;
          try { c[1](b); }
          catch (e) { threw.push(c[0] + ' ← ' + (b == null ? String(b) : '「' + String(b).slice(0, 12) + '」')); }
        });
      });
      return {
        ok: threw.length === 0 && n === calls.length * bads.length,
        got: { 调用: n, 抛了: threw.slice(0, 8) },
        want: { 调用: calls.length * bads.length, 抛了: [] }
      };
    }
  },
  {
    id: 'L2.ui-six', layer: 2, name: '六件工位各走一遍屏幕：围栏不外泄、产物落在自己那条气泡里、口袋记对账',
    // 这一条量的**不是模型**（api.ask 被换成固定回复），是**模型答完到屏幕上那段路**：
    //   围栏有没有漏进气泡、材料卡长没长在对的位置、口袋里的数跟这一轮对不对得上。
    //   前面那些用例量的是纯函数，纯函数全对、接起来还是可能错（参数接反、落点给错）。
    timeout: 180000,
    fn: async function () {
      var C = window.SR;
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var realAsk = C.api.ask;
      var 问题 = [], 结果 = {};
      try {
        // ★ 先等开门：`SR.main.boot()` 挂在 SRlib.whenReady 上（index.html 里那条
        //   8 秒兜底闸），库还没落定时 chat.init 压根没跑，`reset()` 会撞空句柄。
        //   这一条不是产品慢，是尺子起得太早——等工位那一行画出来才算开了机。
        for (var kb = 0; kb < 150 && !document.querySelector('.workbtn'); kb++) await sleep(100);
        C.api.setBackend('deepseek');
        C.api.setKey('sk-accept-not-a-real-key');
        if (C.GATE) C.GATE.on = false;
        C.chat.reset('material', { wipe: true });
        // 组卷那条路要真有模板才落卡（没模板 feed 直接 ok:false，见 js/material.js）
        C.material.setCurrent({
          page: { w: 595, h: 842, left: 85, right: 85, top: 68, bottom: 68, landscape: false },
          slots: [
            { i: 0, n: 3, sample: '某某中学 周练卷' },
            { i: 1, n: 24, sample: '1．计算 (-2)^3 的结果是（　　）' },
            { i: 2, n: 2, sample: '一、选择题（本题共 10 小题）' },
            { i: 3, n: 6, sample: '' }
          ],
          bodySlot: 1
        });

        var 回 = {
          material: '先出这两道：\n\n```材料\n#0 七年级周练卷\n#2 一、选择题\n#1 1．计算 $(-8)+(-5)$ 的结果是（　　）\n#1 2．$-3$ 的绝对值是（　　）\n```\n',
          draw: '画一条数轴，标出 -2 和 3。\n\n```ggb\n#清空\nA=(-2,0)\nB=(3,0)\nSegment(A,B)\n```\n',
          prep: '先问一句：这里的负号管的是谁？\n\n```想说\n把第2问再拆细一点\n给个生活里的例子\n```\n',
          vary: '变式一（改条件）：把 -8 换成 -12。\n\n变式二（改结论）：改成求相反数。\n',
          grade: '成绩表我看了：第 2 题只有三个人做对。',
          review: '这次卷子讲三处：第一题的口算、第七题的图、最后一道的分类讨论。'
        };
        // ★ 假模型也得照**真接口的契约**回：走 onChunk 把字吐出去。
        //   chat.js 的气泡是拿 onChunk 攒出来的（`msg.raw += piece`），
        //   只 resolve({text}) 不调 onChunk，气泡是空的、账本却有字——
        //   第一版就是这么红的：量的不是"屏幕坏没坏"，是"假模型少走了一步"。
        C.api.ask = function (o) {
          var t = 回[o.work] || '';
          if (o.onChunk) o.onChunk(t);
          return Promise.resolve({ text: t, model: 'mock', backend: 'deepseek', usage: {} });
        };

        var 顺序 = ['material', 'draw', 'prep', 'vary', 'grade', 'review'];
        for (var i = 0; i < 顺序.length; i++) {
          var w = 顺序[i];
          C.chat.setWork(w);
          C.chat.say('接着往下。');
          // mock 是立刻回的，但 paint → 收尾那一拍是异步的
          for (var k = 0; k < 200 && C.chat.isAsking(); k++) await sleep(25);
          await sleep(150);
          var as = document.querySelectorAll('.msg.assistant');
          var last = as[as.length - 1];
          var txt = last ? (last.querySelector('.bubble') || last).textContent : '';
          var 记 = C.memo.pocket().marks || {};
          结果[w] = {
            气泡字: txt.length,
            露围栏: txt.indexOf('```') >= 0 || txt.indexOf('#清空') >= 0 || txt.indexOf('#1 ') >= 0,
            材料卡: last ? last.querySelectorAll('.paperbox').length : 0,
            题: 记.prob || 0, 图: 记.fig || 0, 材料: 记.paper || 0,
            缓存按钮: document.querySelectorAll('.chips .chip').length,
            // ★ 组卷的口袋记的是「卷子 1 份」，**题号不记在 marks 里**（见 memo.js 的 SAY 表：
            //   命中的 k 是 'paper'）。学情要的那份清单是 probs()，从 ```材料 围栏当场重算的。
            题号: (C.memo.probs() || []).length,
            工位: C.chat.getWork(),
            样: txt.replace(/\s+/g, ' ').slice(0, 50),
            助手条数: as.length,
            各条: Array.prototype.map.call(as, function (e) {
              return ((e.querySelector('.bubble') || e).textContent || '').replace(/\s+/g, ' ').slice(0, 14);
            }),
            记账: (C.memo.turns() || []).length
          };
          if (结果[w].露围栏) 问题.push(w + '：围栏/编号行漏到了气泡上');
          if (!txt.length) 问题.push(w + '：回复一个字都没画出来');
        }
        if (结果.material.材料卡 !== 1) 问题.push('组卷：材料卡没长在它自己那条气泡里');
        if (结果.material.题号 !== 2) 问题.push('组卷：学情要的题号清单应是 2 个，数出 ' + 结果.material.题号);
        if (结果.material.材料 !== 1) 问题.push('组卷：口袋没记"排出一份材料"');
        if (结果.draw.图 !== 1) 问题.push('作图：口袋应记 1 张图，记了 ' + 结果.draw.图);
        if (结果.prep.缓存按钮 < 1) 问题.push('备课：```想说 那几颗按钮没长出来');
        if (结果.vary.题 !== 2) 问题.push('命题：两条变式应记 2 道，记了 ' + 结果.vary.题);
      } finally {
        C.api.ask = realAsk;
        C.chat.reset('material', { wipe: true });
      }
      return {
        ok: 问题.length === 0,
        got: { 问题: 问题.slice(0, 8), 明细: 结果 },
        want: { 问题: [], 组卷: '材料卡 1／题号 2／卷子 1', 作图: '图 1', 命题: '题 2', 全部: '不露围栏' }
      };
    }
  },
  {
    id: 'L2.chips-copy', layer: 2, name: '按钮抄写闸：原句、改几个字的抄，都整组作废；自己写的话留下',
    fn: function () {
      var C = window.SR;
      var ex = (C.EXAMPLE_CHIPS || [])[0] || '';
      var fresh = '把第三题的数字改成负七';
      var got = {
        原句原文: C.filterCopiedChips([ex]).length,
        改几个字: C.filterCopiedChips(['请' + ex]).length,
        新话: C.filterCopiedChips([fresh]).length,
        空: C.filterCopiedChips([]).length
      };
      var ok = !!ex && got.原句原文 === 0 && got.改几个字 === 0 && got.新话 === 1 && got.空 === 0;
      return { ok: ok, got: got, want: { 原句原文: 0, 改几个字: 0, 新话: 1, 空: 0 } };
    }
  }
];

// ── 红验：把实现改坏，对应那条必须变红 ─────────────────────────
const RED_MUTATIONS = [
  {
    target: 'L1.cap-material',
    why: '把 DeepSeek 那一档改成 1024（回到被截断的数）',
    script: "window.SR.WORKS.material.maxTokensDeepseek = 1024;"
  },
  {
    target: 'L1.chains',
    why: '删掉两条显式链，让它们回落到 models',
    script: "delete window.SR.BACKENDS.deepseek.modelsImage; delete window.SR.BACKENDS.deepseek.modelsText;"
  },
  {
    target: 'L2.gate-no',
    why: '把点头判据改成永远点头',
    script: "window.SR.blueprint.是点头 = function(){ return true; };"
  },
  {
    target: 'L2.scores-basic',
    why: '让成绩表解析直接报错',
    script: "window.SR.scores.解析 = function(){ return {err:'坏了'}; };"
  },
  {
    target: 'L2.scores-messy',
    why: '把汇总行当学生一起平均（回到旧行为）',
    script: "window.SR.scores.解析 = function(){ return {err:'坏了'}; };"
  },
  {
    target: 'L2.material-blocks',
    why: '让编号行解析一个都拆不出来',
    script: "window.SR.produce.parseBlocks = function(){ return []; };"
  },
  {
    target: 'L2.memo-probs',
    why: '让口袋永远数 0 道题',
    script: "window.SR.memo.countProbs = function(){ return 0; };"
  },
  {
    target: 'L2.landing-route',
    why: '让首屏永远说"哪一件都对不上"',
    script: "window.SR.landing.route = function(){ return {work:'',sure:0,why:'',ranked:[],score:0}; };"
  },
  {
    target: 'L2.draw-cards',
    why: '让作图一张卡都不翻',
    script: "window.SR.drawkb.翻 = function(){ return []; };"
  },
  {
    target: 'L2.draw-chain',
    why: '把作图链退回三颗（头一颗挤掉后，第三个请求会落到不说话的那颗上）',
    script: "window.SR.WORKS.draw.chainModels = { glm: ['glm-4.6v-flash','glm-4.1v-thinking-flash','glm-4v-flash'] };"
  },
  {
    target: 'L2.robustness',
    why: '让一个纯函数在空输入上直接抛',
    script: "window.SR.drawkb.翻 = function(x){ return String(x).length ? [] : (function(){throw new Error('空值没兜住');})(); };"
  },
  {
    target: 'L2.ui-six',
    why: '让口袋这一轮什么都不记',
    script: "window.SR.memo.produced = function(){};"
  },
  {
    target: 'L2.chips-copy',
    why: '把抄写闸拆掉（什么按钮都放行）',
    script: "window.SR.filterCopiedChips = function(a){ return (a||[]).filter(function(s){return String(s).trim();}); };"
  }
];

// ── L3：真模型 ────────────────────────────────────────────────
const NET_CASE = {
  id: 'L3.paper-flow', layer: 3, name: '真走一遍组卷：蓝图 → 点头 → 成品，30 题写得完',
  timeout: 240000,   // 两次调用加一起要写一阵，别拿 30 秒的尺子量
  fn: async function () {
    // Key 由 Node 那边读 settings.json 后塞进来（不落仓库、不打印）。
    window.SR.api.setBackend('deepseek');
    window.SR.api.setKey(window.__ACCEPT_KEY || '');
    if (window.SR.GATE) window.SR.GATE.on = false;

    // ★ 必须给一份模板：产品的规矩是"没模板不写材料围栏"（js/material.js 的 slotBrief 明说），
    //   不是模型不肯写。这里塞一份**合成的**模板（四档格式、正文是 #1），
    //   只为了走到"真出成品"那一步；不依赖他机器上的任何个人文件。
    window.SR.material.setCurrent({
      page: { w: 595, h: 842, left: 85, right: 85, top: 68, bottom: 68, landscape: false },
      slots: [
        { i: 0, n: 3, sample: '某某中学 2026—2027学年第一学期七年级数学' },
        { i: 1, n: 24, sample: '1．计算 (-2)^3 的结果是（　　）' },
        { i: 2, n: 2, sample: '一、选择题（本题共 10 小题，每小题 3 分）' },
        { i: 3, n: 6, sample: '' }
      ],
      bodySlot: 1
    });

    var q = '出一份七年级上有理数混合运算的周练卷，30 道题，每题后面附答案。';
    var t0 = Date.now();
    var uBefore = window.SR.api.usage.completion;

    // 第一轮：产品默认挂着蓝图闸门，这一轮**应该只给蓝图**（不给成品）。
    // ★ ask 回的是 {text, model, backend}，不是一段字符串——第一次写成直接 match，尺子自己先红了。
    var r1 = await window.SR.api.ask({ work: 'material', text: q, history: [] });
    // 第二轮：老师点头。闸门读到「就按这个办」→ 拼 GO 段 → 才出成品。
    var r2 = await window.SR.api.ask({
      work: 'material',
      text: '就按这个办',
      history: [
        { role: 'user', content: q },
        { role: 'assistant', content: (r1 && r1.text) || '' }
      ]
    });

    var txt1 = (r1 && r1.text) || '';
    var txt = (r2 && r2.text) || '';
    var ms = Date.now() - t0;
    var used = window.SR.api.usage.completion - uBefore;
    var p1 = window.SR.render.parseFences(txt1, { 收尾: true });
    var p = window.SR.render.parseFences(txt, { 收尾: true });
    var body = p.mat.length ? p.mat[0] : txt;
    // ★ 围栏里每一行开头是 `#号`（模板格式号），题号在它**后面**。
    //   第一版直接数行首数字，数出 0——量的不是"有几道题"，是"行首有没有数字"。
    function 数题(s) {
      return String(s || '').split('\n').filter(function (ln) {
        return /^\s*\d+[．.、]/.test(ln.replace(/^\s*#\d+\s*/, ''));
      }).length;
    }
    var n = 数题(body);
    var n全部 = 数题(txt);
    var 干净 = /[。！？`）)】\]]\s*$/.test(txt.trim());
    var cap = window.SR.api.输出上限('material', window.SR.BACKENDS.deepseek);

    return {
      // 三条一起判：成品围栏闭着、题数够、token 没顶到上限（顶到就是被截断）。
      ok: p.mat.length === 1 && n >= 25 && used < cap && 干净,
      got: {
        第一轮围栏: p1.mat.length, 第一轮题数: (p1.mat[0] || txt1).match(/(^|\n)\s*\d+[．.、]/g) ? (p1.mat[0] || txt1).match(/(^|\n)\s*\d+[．.、]/g).length : 0,
        第二轮围栏: p.mat.length, 题数: n, 全文题数: n全部, 字数: txt.length,
        围栏头: String(body).slice(0, 240),
        completion: used, 上限: cap, 结尾干净: 干净, 毫秒: ms,
        模型: r2 && r2.model, 后端: r2 && r2.backend,
        末段: txt.slice(-80)
      },
      want: { 第二轮围栏: 1, 题数: '>=25', completion: '<' + cap, 结尾干净: true }
    };
  }
};

// ── 跑 ───────────────────────────────────────────────────────
async function main() {
  // 1) 静态服务器（no-store，见 serve.cjs 头注释）
  if (!(await waitHttp('http://localhost:' + WEB_PORT + '/index.html', 600))) {
    server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), String(WEB_PORT)], { stdio: 'ignore' });
    if (!(await waitHttp('http://localhost:' + WEB_PORT + '/index.html', 8000))) {
      throw new Error('静态服务器起不来：端口 ' + WEB_PORT);
    }
  }

  // 2) 隔离浏览器
  let already = false;
  try { await httpGet('http://127.0.0.1:' + CDP_PORT + '/json/version'); already = true; } catch (e) {}
  if (!already) {
    const exe = chromePath();
    if (!exe) throw new Error('找不到 chrome.exe，设 CHROME_PATH 指过去');
    profileDir = path.join(os.tmpdir(), 'mr-accept-' + process.pid);
    fs.rmSync(profileDir, { recursive: true, force: true });
    chrome = spawn(exe, [
      '--remote-debugging-port=' + CDP_PORT,
      '--user-data-dir=' + profileDir,
      '--no-first-run', '--no-default-browser-check',
      '--window-size=1280,900',
      'about:blank'
    ], { stdio: 'ignore' });
    chromeSpawned = true;
    if (!(await waitHttp('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000))) {
      throw new Error('浏览器没起来：端口 ' + CDP_PORT);
    }
  } else {
    // 端口上已经有一个浏览器。**不是我们起的，就别用**——万一是他正在用的那个。
    throw new Error('端口 ' + CDP_PORT + ' 已被占用（不是本脚本起的，不敢用）。换个 ACCEPT_CDP_PORT。');
  }

  const targets = JSON.parse(await httpGet('http://127.0.0.1:' + CDP_PORT + '/json/list'));
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('没有可用的标签页');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id); waiters.delete(m.id);
      m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push((d.exception && d.exception.description) || d.text);
    }
    if (m.method === 'Network.requestWillBeSent') {
      reqUrls.set(m.params.requestId, m.params.request.url);
    }
    if (m.method === 'Network.loadingFailed') {
      const t = m.params.type, e = m.params.errorText || '';
      if ((t === 'Script' || t === 'Stylesheet') && e.indexOf('ERR_ABORTED') < 0) {
        const u = reqUrls.get(m.params.requestId) || '';
        const line = t + ': ' + e + (u ? '  ← ' + u : '');
        // ★ 只把**我们自己的文件**算红：三次实测里有一次 jsdelivr 的
        //   `@fontsource/noto-serif-sc` 样式表被 reset，页面照常（有系统字体兜底），
        //   可 L1.quiet 会随机变红——那量的是网络天气，不是产品。
        //   外部的照样记下来，摆在报告的"外部CDN"一格，**不藏**。
        const local = u.indexOf('http://localhost:' + WEB_PORT) === 0 ||
                      u.indexOf('http://127.0.0.1:' + WEB_PORT) === 0 ||
                      u.indexOf('file:') === 0;
        (local ? loadFails : loadSoft).push(line);
      }
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  // ★ 先 Network.enable 再 setCacheDisabled——同域普通导航会吃缓存，
  //   不关掉就会拿旧代码量新改动（这个坑记在体检表里）。
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  if (!(await reload())) throw new Error('页面 40 秒内没就绪');

  // ★ 这里**当场拍一张快照**。原来 L1.quiet 是在所有用例跑完之后才去读
  //   pageErrors 的——它的名字说的是"启动期"，量的却是整场；只要有一条用例
  //   在页面里抛了异常，这条"启动期"也会跟着红，维修的人追到启动那儿会什么也找不到。
  //   拍在用例之前，它才真的只量启动。（[[scanner-numbers-are-not-what-they-claim]]）
  const bootErrs = pageErrors.slice(), bootFails = loadFails.slice();

  // Key 只在 --net 时读，且只塞进这个临时标签页
  if (WITH_NET) {
    const st = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    const k = st.env && st.env.ANTHROPIC_AUTH_TOKEN;
    if (!k) throw new Error('settings.json 里没有 ANTHROPIC_AUTH_TOKEN，--net 跑不了');
    // 只塞进这个临时标签页；不在控制台打印，也不进仓库。
    await evalPage('window.__ACCEPT_KEY = ' + JSON.stringify(k));
  }

  const results = [];
  const all = CASES.concat(WITH_NET ? [NET_CASE] : []);
  for (const c of all) {
    let r;
    try {
      r = await evalPage(c.fn, c.timeout);
    } catch (e) {
      r = { ok: false, got: '抛异常: ' + e.message, want: '正常返回' };
    }
    results.push({ id: c.id, layer: c.layer, name: c.name, ...r });
  }

  // 启动期异常 / 资源失败
  // 外部 CDN 的失败也拍一张快照，跟本地分开报。
  const bootSoft = loadSoft.slice();
  const bootOk = bootErrs.length === 0 && bootFails.length === 0;
  results.unshift({
    id: 'L1.quiet', layer: 1, name: '启动期零异常、本地脚本/样式零加载失败',
    ok: bootOk,
    got: { 异常: bootErrs.slice(0, 3), 本地失败: bootFails.slice(0, 3), 外部CDN: bootSoft.slice(0, 3) },
    want: { 异常: [], 本地失败: [], 外部CDN: '只记录，不计红' }
  });

  // 红验
  const reds = [];
  if (RED) {
    for (const m of RED_MUTATIONS) {
      const target = results.find(r => r.id === m.target);
      if (!target) { reds.push({ ...m, ok: false, got: '没有这条用例' }); continue; }
      if (!target.ok) { reds.push({ ...m, ok: null, got: '跳过：它本来就不是绿的' }); continue; }
      try {
        await evalPage(m.script);
        const c = all.find(x => x.id === m.target);
        const r = await evalPage(c.fn);
        reds.push({ ...m, ok: r.ok === false, got: r.ok === false ? '变红了（尺子有效）' : '还是绿的（尺子量的不是这件事）' });
      } catch (e) {
        reds.push({ ...m, ok: null, got: '改坏时抛异常: ' + e.message });
      }
      if (!(await reload())) throw new Error('红验后页面没回来');
    }
  }

  report(results, reds);
  const bad = results.filter(r => !r.ok).length;
  // ★ 必须显式收尾再退出：起过的 Chrome / 服务器是**活句柄**，
  //   只设 exitCode 的话事件循环永远不空，脚本会挂在"已经跑完"之后。
  cleanup();
  process.exit(bad ? 1 : 0);
}

function report(results, reds) {
  if (JSON_ONLY) {
    console.log(JSON.stringify({ results, reds }, null, 2));
    return;
  }
  const pad = s => (s + '      ').slice(0, 6);
  console.log('\n数根验收  ' + new Date().toLocaleString('zh-CN'));
  console.log('─'.repeat(64));
  let last = 0;
  for (const r of results) {
    if (r.layer !== last) { console.log('\nL' + r.layer); last = r.layer; }
    console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.id + '  ' + r.name);
    if (!r.ok) {
      console.log('      got  ' + JSON.stringify(r.got));
      console.log('      want ' + JSON.stringify(r.want));
    }
  }
  if (reds.length) {
    console.log('\n红验（把实现改坏，尺子必须报红）');
    for (const x of reds) {
      console.log('  ' + (x.ok === true ? '✓' : x.ok === null ? '·' : '✗') + ' ' + x.target + '  ' + x.why);
      console.log('      ' + x.got);
    }
  }
  const bad = results.filter(r => !r.ok);
  console.log('\n' + '─'.repeat(64));
  console.log((bad.length ? '红 ' + bad.length + ' 条' : '全绿') + ' · 共 ' + results.length + ' 条');
  if (bad.length) console.log('  ' + bad.map(r => r.id).join('  '));
  console.log('');
}

function cleanup() {
  try { if (ws) ws.close(); } catch (e) {}
  if (chromeSpawned && chrome && chrome.pid) {
    // 只杀我们自己那棵进程树；他正在用的 Chrome 一个都不碰。
    spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  if (server && server.pid) {
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  if (profileDir) {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

main().catch(e => {
  console.error('\n怎么验的自己先塌了: ' + e.message);
  cleanup();
  process.exit(2);
});

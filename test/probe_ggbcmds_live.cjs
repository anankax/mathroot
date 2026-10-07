// 整改③ 的命令目录**在产品页面里**到底通没通 —— 走真页面、真 index.html、真 buildSystem。
//
// 为什么 Node 那把尺子（probe_ggbcmds.cjs）还不够：
//   那个探针是**自己按清单 require 文件**的，`js/ggbcmds.js` 是我手写进去的一行；
//   产品页面上却是 `index.html` 那个 <script> 标签说了算。两处一旦不一致
//   （标签漏了 / 路径打错 / 文件被 .gitignore 挡在仓库外），Node 那边照样 31 绿，
//   线上却是"SR.ggbcmds 是 undefined、那段静默跳过"——**看着全绿，其实一格没走**。
//   这不是我编的担心：drawkb 那一轮就是这么栽的（probe_drawkb_live.cjs 顶上记着）。
//
// ★ 这一版**不调模型**（跟 probe_drawkb_live.cjs 不同）。理由：
//   ③ 要证的是"贴没贴上"，而 buildSystem 是同步的、确定的 —— 调一次模型只会把
//   一份确定的读数换成一份会抖的读数。模型那一侧归 probe_drawfence.cjs 管。
//
// ⚠ 探针纪律（跟 probe_drawkb_live.cjs 同一套，别动）：
//   · 浏览器必须**开着窗口**（不带 --headless），用隔离档案 test/_chrome，绝不碰他那个 9222 的桌面 Chrome；
//   · 每次都要**硬重载**（dev server 会给 js 发 max-age，普通导航吃同源缓存，
//     会把"已生效"读成"没生效"）；
//   · ⚠⚠ **别在这页上调 `Network.setCacheDisabled`**（2026-10-06 夜实测）：调了之后
//     `window.ggbApplet` **永远停在 undefined**，`SR.board.isReady()` 再也不真，
//     而且**一条 Network.loadingFailed 都不发**——是静默的。三条差分探针定位到的：
//     什么都不做 → 起得来；只 `Network.enable` → 起得来；只 `Emulation.setDeviceMetricsOverride`
//     → 起得来；**加上 setCacheDisabled → 画板永远不起来**。
//     dev server（test/serve.cjs）本来就把 js 发成 `no-store, no-cache, must-revalidate`
//     （curl -sI 核过），所以这一页根本不需要它。下面那行留着是为了"硬重载"这个动作本身。
//     ★ 这一版探针**不碰画板**，所以它没被这条坑到；但凡是**要量画板**的探针，
//       带上这一行就是**在一个板子从没起来的页面上量东西**。probe_sigsink.cjs 因此专门留了
//       "★★ 真画板装起来了（ggbApplet 在）"这一格——不量那一格，板子死了读数也全绿。
//   · 硬重载（`Page.reload {ignoreCache:true}`）：防的是同源普通导航吃缓存把"已生效"读成"没生效"；
//   · 读数一律从 SR 里读，不扒 DOM；
//   · 页面上翻的那个开关**用完当场还原**（虽然重载就没了，但别留个"我以为的初值"给下一条读数）。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222;
// ★ 「硬重载之后等开完机」共用那一份，别在这儿再抄一遍。见 test/_等开机.cjs。
const { 等开机 } = require(path.join(__dirname, '_等开机.cjs'));

// ★★ 条数**从源文件里数**，不写死（2026-10-06 夜加第 14 条时改的）：
//   原来这一格写的是 `F.条数 === 13`。加一条卡的那天，它会红着脸说"页面没装对"——
//   而页面装得一点没错，是这把尺子的那个数过期了。同族栽过：[[scanner-numbers-are-not-what-they-claim]]
//   里那条"写死的件数在'加一件'那天报成'仪器不对'"。改成数源码，加多少条它自己跟上。
//
// ★★ 这个正则本身也栽过一次，别改回去（当场读数是"页面 14 条 / 源文件 0 条"→ 判了红）：
//   第一版写的是 `/^\s*名: '/gm` —— 可源文件那几行长这样 `  { 名: 'Slider', 类: '动态',`，
//   **行首是 `{`**，不是 `名`，所以一条都没数到。那把尺子于是**把装得好好的页面判成了红**。
//   顺手试过的 `/\\b名: '/` 也是 0 —— 因为 `\b` 只认 ASCII 的 \w，中文前面根本不产生词边界。
//   最后用的是下面这条（`{` 或 `,` 之后再跟 `名:`），当场数出 14，跟页面上的 14 对得上。
//   ⚠ 教训不是"正则写错了"，是**"从源文件里数"这个办法本身也得先证明它数得对**：
//     数出 0 和数出 14 都只是个数，得拿一个能对上的另一端（页面上的卡表）来验。
const 应装 = (fs.readFileSync(path.join(__dirname, '..', 'js', 'ggbcmds.js'), 'utf8').match(/[{,]\s*名: '/g) || []).length;

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));

(async () => {
  const 列表 = await 取('/json/list');
  // ★★ 同源标签页会有一堆，`find()` 抓第一个**迟早抓错**（[[scanner-numbers-are-not-what-they-claim]]）。
  //   按 url 过滤，再**逐个核身份**（这一页里有没有 SR），核不出来的当场跳过。
  const 候选 = 列表.filter(t => t.type === 'page' && /^(https?:\/\/)?(localhost|127\.0\.0\.1):8138/.test(String(t.url)));
  console.log('本地 8138 开着 ' + 候选.length + ' 个标签页，逐个核身份…');
  if (!候选.length) { console.error('★ 没有 8138 的标签页。先把探针浏览器开起来（可见窗口 + test/_chrome 档案 + 静态服务 8138）。'); process.exit(2); }

  let 会话 = null, 目标 = null, 缺 = [];
  for (const t of 候选) {
    const w = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise(r => w.on('open', r));
    let id = 0; const 等 = {};
    w.on('message', m => {
      let o; try { o = JSON.parse(m); } catch (e) { return; }
      if (o.id && 等[o.id]) { 等[o.id](o); return; }
      if (o.method === 'Network.responseReceived' && o.params.response.status >= 400) 缺.push(o.params.response.url + ' → ' + o.params.response.status);
    });
    const 发 = (method, params) => new Promise(r => { const i = ++id; 等[i] = r; w.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (e) => { const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return 'THROW: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description); return r.result && r.result.result && r.result.result.value; };
    const 有 = await ev('typeof SR !== "undefined" && !!SR.WORKS');
    if (有 === true) { 会话 = { 发, ev, w }; 目标 = t; break; }
    w.close();
  }
  if (!会话) { console.error('★ 这几个标签页里没有一个真跑着数根。'); process.exit(2); }
  const { 发, ev, w } = 会话;
  console.log('核上了：' + 目标.url);

  await 发('Network.enable');                       // ★ 留着：下面要收 4xx/5xx（Network.responseReceived 得先 enable）
  // ★★ 这里**原来有一行 `Network.setCacheDisabled`，2026-10-06 夜删掉了** ——
  //   它在这一页上会让 GeoGebra 永远装不起来（见文件顶上那段实测）。删之前这一版是 12 绿，
  //   删之后再跑一遍还是同样的 12 条绿、同样的读数 —— 那就说明**它一直没起过作用**，
  //   "不碰画板所以不受影响"这个辩解本来也站不住：留着就等于在一条已知会弄坏页面的路上走。
  //   真要吃缓存的是 GitHub Pages（max-age=600）；本机 8138 是 test/serve.cjs，发的是 no-store。
  await 发('Page.enable');
  await 发('Page.reload', { ignoreCache: true });   // 硬重载

  // ★★ 硬重载之后**等页面真开完机**再读第一个数（2026-10-06 夜补）。
  //   原来这里是"睡 4 秒就读 SR.…"——冷启动时那 4 秒不够，`SR` 还没定义，
  //   整把尺子当场炸成 `ReferenceError: SR is not defined`，而那个"炸"跟
  //   "产品坏了"**长得一模一样**。判据与用法见 test/_等开机.cjs 顶上那段。
  const 开完了 = await 等开机(ev);
  if (!开完了) console.log('★ 20 秒没等到开机 —— 后面的读数要打折看');

  // ★★ 第一件事：**证明页面上装的是这一版**。证不出来，后面的读数全部作废。
  const 指纹 = await ev('JSON.stringify({ 模块: typeof SR.ggbcmds, 条数: SR.ggbcmds ? SR.ggbcmds.卡.length : null, 开关: SR.WORKS.draw ? SR.WORKS.draw.cmds : "(没有这条)", base: (SR.PROMPT_BASE||"").length })');
  console.log('页面指纹：' + 指纹);
  if (String(指纹).indexOf('THROW') === 0) { console.error('★ 页面里读指纹就炸了：' + 指纹); process.exit(2); }
  const F = JSON.parse(指纹);
  判('★★ 页面真装上了 js/ggbcmds.js（不是 Node 探针里手写的那一行）', F.模块 === 'object', 'typeof SR.ggbcmds = ' + F.模块);
  判('★ 签名条数跟源文件对得上（' + 应装 + ' 条）', F.条数 === 应装,
    '页面 ' + F.条数 + ' 条 / js/ggbcmds.js 里 ' + 应装 + ' 条');
  判('★ 作图工位的 cmds 开关开着', F.开关 === true);
  判('★ 底座也在（① 没被这一轮碰掉）', F.base === 761, 'SR.PROMPT_BASE = ' + F.base + ' 字');
  判('★ 加载期没有 4xx/5xx', 缺.length === 0, 缺.length ? 缺.join('；') : '一个都没有');

  // ---- 真页面里的 buildSystem：贴没贴上 ----
  // 走产品自己那条路（chat.js 调的也是 SR.api.buildSystem）。第 7 个参数是**老师这一轮的原话**，
  // 跟 api.js:927 那个调用点同形。
  const 跑 = async (话, 开关) => {
    const e = '(function(){ var 原=SR.WORKS.draw.cmds; SR.WORKS.draw.cmds=' + (开关 ? 'true' : 'false') + ';'
      + ' var s=SR.api.buildSystem("draw", ' + JSON.stringify(话) + ', null, [], [], {}, ' + JSON.stringify(话) + ');'
      + ' SR.WORKS.draw.cmds=原; return JSON.stringify({len:s.length, 贴了: SR.ggbcmds.卡.filter(function(c){return s.indexOf(c.体)>=0}).map(function(c){return c.名})}); })()';
    const r = await ev(e);
    if (String(r).indexOf('THROW') === 0) { console.error('★ 页面上调 buildSystem 炸了：' + r); process.exit(2); }
    return JSON.parse(r);
  };

  for (const c of [{ 话: '画个圆，半径能拖的', 该中: ['Circle', 'Slider'] },
                   { 话: '画个正方体的展开图', 该中: ['Cube', 'Net'] },
                   { 话: '今天天气不错', 该中: [] }]) {
    const 开 = await 跑(c.话, true);
    const 关 = await 跑(c.话, false);
    console.log('   「' + c.话 + '」开：' + (开.贴了.join('、') || '无') + '（' + 开.len + ' 字）'
      + '　关：' + (关.贴了.join('、') || '无') + '（' + 关.len + ' 字）');
    if (c.该中.length) {
      判('★★ 真页面里「' + c.话 + '」贴上了 ' + c.该中.join('、'),
        c.该中.every(n => 开.贴了.indexOf(n) >= 0), 开.贴了.join('、') || '无');
      判('   └ ★ 页面上翻开关也真管用（关了这条路上一条都贴不上）',
        关.贴了.length === 0, 关.贴了.join('、') || '无');
    } else {
      判('★★ 一条都没中 → system **一个字符都不加**（不是"加个空段"）',
        开.len === 关.len && 开.贴了.length === 0, 开.len + ' / ' + 关.len);
    }
  }

  // ★ 反向核一次：**不认识的句子一条都不许翻**（门在页面上也得是紧的）
  const 负 = await ev('JSON.stringify(SR.ggbcmds.翻("明天要开家长会"))');
  判('★ 页面上门也是紧的：「明天要开家长会」一条都不翻', 负 === '[]', 负);

  // ★ 收尾：开关是原样还回去的（上面 跑() 里那句 `SR.WORKS.draw.cmds=原`），核一下
  const 复位 = await ev('SR.WORKS.draw.cmds');
  判('★ 探针没把页面上的开关留在翻过的状态（用完还原）', 复位 === true, '现值 ' + 复位);

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

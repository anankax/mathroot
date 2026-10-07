// 专题卡这一改，**老师真用起来好不好** —— 走真 UI，不是直接调 SR.api.ask。
//
// 为什么非要这一把尺子（probe_drawkb_live.cjs 还不够）：
//   那个探针是 `SR.api.ask({work:"draw", text:…})` **我替产品把参数摆好了**。
//   可老师那条路上还有四件事它一格都没量：
//     ① 工位是按 `#works .workbtn` 那一排选的 —— `opts.work` 到底传成什么了？
//     ② 原话是 `#input` 那个 textarea 里敲进去、回车触发的 submit() ——
//        `opts.text`（门的输入）到底是原话，还是被别的东西顶掉了？
//     ③ 提示词发出去之后，**画板真建出对象了吗**（模型说话了 ≠ 图上真有了）。
//     ④ 屏幕上老师看到的是什么（助手气泡、状态条），中途有没有报错。
//   ①②③④ 里任何一格断了，api 探针**照样全绿**——因为那四格本来就不在它的路上。
//
// ⚠ 探针纪律（跟 probe_drawkb_live.cjs 同一套，别动）：
//   · 浏览器**开着窗口**（不带 --headless），隔离档案 test/_chrome，绝不碰他 9222 那个桌面 Chrome；
//   · 硬重载（Network.enable → setCacheDisabled → Page.reload{ignoreCache:true}）；
//   · 敲字走真实键盘事件（Input.insertText + dispatchKeyEvent），不是 `el.value=…`；
//   · 读数一律从 SR / 产品自己的记账里读；DOM 只用来确认"老师看见了什么"。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222;

// ★★ 「这一版」的基准**从磁盘现算**，别写死字节数 —— 详见 test/_base_len.cjs 顶上那段。
const 磁盘base = require(path.join(__dirname, "_base_len.cjs")).磁盘底座长度();

const 话 = process.argv[2] || '画个圆，半径能拖的';
const 期望卡 = process.argv[3] || '圆';

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ★★ 自己去开**一张干净的标签页**，用完关掉 —— 不挑现成的（2026-10-06 夜改）。
  //   原来那段是"从 8138 的标签页里挑第一个能认的"，而这个隔离 profile 里
  //   攒了**十六个**同源页（历次探针留下的）。工位是**每个标签页各自记在内存里**的，
  //   挑中的那一页当场是 `vary`（命题）—— 于是 1丙 读到「命题」就红了，
  //   读数**合情合理却量的是别人那页**。同族老账：
  //   [[scanner-numbers-are-not-what-they-claim]] 里「19 个同源页里挑错，
  //   会随开页次数**劣化**」。⇒ 根治不是"挑得更准"，是**别挑**。
  const 新 = JSON.parse(await (p => new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'PUT' }, x => {
      let s = ''; x.on('data', c => s += c); x.on('end', () => res(s));
    }); r.on('error', rej); r.end();
  }))('/json/new?http://localhost:8138/index.html'));
  await sleep(600);
  console.log('自己开了一张干净标签页：' + 新.id);
  const 关掉自己 = () => new Promise(r => { const q = http.request({ host: '127.0.0.1', port: PORT, path: '/json/close/' + 新.id, method: 'GET' }, x => { x.on('data', () => { }); x.on('end', r); }); q.on('error', r); q.end(); });

  const 列表 = await 取('/json/list');
  const 候选 = 列表.filter(t => t.id === 新.id);
  console.log('本地 8138 开着 ' + 列表.filter(t => t.type === 'page' && /8138/.test(String(t.url))).length + ' 个标签页，只认自己开的那一张…');
  if (!候选.length) { console.error('★ 自己开的那张标签页没找到。'); process.exit(2); }

  let 会 = null, 目标 = null;
  for (const t of 候选) {
    const w = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise(r => w.on('open', r));
    let id = 0; const 等 = {};
    w.on('message', m => { let o; try { o = JSON.parse(m); } catch (e) { return; } if (o.id && 等[o.id]) 等[o.id](o); });
    const 发 = (m, p) => new Promise(r => { const i = ++id; 等[i] = r; w.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
    // ★★ 页面里抛异常时**当场抛出去**，不许折成一个 `'THROW: …'` 字符串还回来。
    //   老写法栽过：调用方 `JSON.parse(await ev(...))` 吃到那个字符串，
    //   报出来的是 `SyntaxError: Unexpected token 'T'` ——
    //   **离现场十米远的一个不相干的错**，顺着它查会白查半天
    //   （[[scanner-numbers-are-not-what-they-claim]] 里"真值字符串当循环条件"那一族）。
    const ev = async e => {
      const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails;
        throw new Error('页面里这一句炸了：' + ((d.exception && (d.exception.description || d.exception.value)) || d.text) + '\n  表达式：' + String(e).slice(0, 200));
      }
      return r.result && r.result.result && r.result.result.value;
    };
    if (await ev('typeof SR !== "undefined" && !!SR.WORKS') === true) { 会 = { 发, ev, w }; 目标 = t; break; }
    w.close();
  }
  if (!会) { console.error('★ 没有一页真跑着数根。'); await 关掉自己(); process.exit(2); }
  const { 发, ev, w } = 会;
  console.log('核上了：' + 目标.url);

  // ── 报错收集：控制台、未捕获异常、4xx/5xx ─────────────────────────
  //
  // ★★ 为什么要分「我方 / 第三方」两栏（第一版跑出来栽的）：
  //   GeoGebra 自己那个 `web3d-0.js` 一来就播两条
  //   `Permissions policy violation: unload is not allowed in this document`。
  //   那是**它的**模块在浏览器新策略下的常规提示，跟数根这几行改动一个字都不沾；
  //   可它走的是 `Log.entryAdded`/`level:'error'`，跟"我们自己炸了"落在同一个桶里，
  //   于是 5甲 当场假红——**红的样子跟"页面真出错了"一模一样**。
  //   ⇒ 出路不是把它删了（那就成了"把读数藏起来"），是**按来源分桶**：
  //     我们的（8138 上 js/*.js）算红，第三方的单列出来**照样打印**，
  //     谁也不藏，但断言只断我们自己的。
  // ★★ 凭什么分桶（两趟跑下来才定死的一条规矩）：
  //   判据只有一条 —— **这条东西是不是从 8138 上我们自己的文件来的**。
  //   是 → 算我们的，报红；不是（GeoGebra 的 web3d-0.js、智谱 open.bigmodel.cn 的 429、
  //   各种 CDN）→ 单列出来**照样打印**，但不冒充"我们把页面弄坏了"。
  //   栽过两回，两回都是"红的样子跟产品坏了长得一样"：
  //     · web3d-0.js 的 `Permissions policy violation`（GeoGebra 自己那个 3D 模块的常规提示）
  //       走 Log.entryAdded/level:error，跟"我们炸了"同一个桶 → 5甲 假红；
  //     · 智谱免费通道限流 429 走同一个口子 → 按"文件名像不像第三方的"分，漏进我方 → 又假红。
  //   ⇒ 不再猜文件名，只看**来源主机**。判断依据是 url 本身，看得见，不靠模式匹配的运气。
  const 是我方的 = u => /^(https?:\/\/)?(localhost|127\.0\.0\.1):8138\//.test(String(u || ''));
  const 报错 = [], 缺 = [], 控制台 = [], 外方 = [];
  const 记一条 = (文, url) => { if (是我方的(url)) 报错.push(文 + '   ← ' + url); else 外方.push(文 + (url ? '   ← ' + url : '   ← （没给来源）')); };
  会.w.on('message', m => {
    let o; try { o = JSON.parse(m); } catch (e) { return; }
    if (o.method === 'Runtime.exceptionThrown') {
      const d = o.params.exceptionDetails || {};
      记一条('未捕获异常：' + ((d.exception && (d.exception.description || d.exception.value)) || d.text), d.url);
    } else if (o.method === 'Runtime.consoleAPICalled') {
      const 字 = (o.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
      const u = o.params.stackTrace && o.params.stackTrace.callFrames && o.params.stackTrace.callFrames[0] && o.params.stackTrace.callFrames[0].url;
      if (o.params.type === 'error' || o.params.type === 'warning') 控制台.push(o.params.type + '：' + 字 + (u ? '   ← ' + u : ''));
    } else if (o.method === 'Log.entryAdded') {
      const e = o.params.entry || {};
      // 全 url 记下来 —— "它是外来的"这个判断得**看得见来源**才算数
      if (e.level === 'error') 记一条('页面日志：' + (e.text || ''), e.url);
    } else if (o.method === 'Network.responseReceived' && o.params.response.status >= 400) {
      const u = o.params.response.url;
      (是我方的(u) ? 缺 : 外方).push('网络 ' + u + ' → ' + o.params.response.status);
    }
  });

  await 发('Runtime.enable');
  await 发('Log.enable');
  await 发('Network.enable');                       // ★ 必须在前
  await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.enable');
  await 发('Page.reload', { ignoreCache: true });
  await sleep(5000);

  // ── 0. 证明页面上装的是这一版。证不出来，后面全部作废 ─────────────
  const 指纹 = await ev('JSON.stringify({ 模块: typeof SR.drawkb, 张数: SR.drawkb ? SR.drawkb.卡.length : null, base: String(SR.PROMPT_DRAW).length, 开关: !!(SR.WORKS.draw && SR.WORKS.draw.drawkb), ggb: typeof ggbApplet })');
  console.log('\n页面指纹：' + 指纹);
  const F = JSON.parse(指纹);
  判('0甲 页面真装着 js/drawkb.js', F.模块 === 'object', 'typeof SR.drawkb = ' + F.模块);
  判('0乙 ★ 页面跑的就是磁盘这一份 prompt-draw.js（不是缓存里的旧版）', F.base === 磁盘base,
    '页面 ' + F.base + ' 字 ／ 磁盘 ' + 磁盘base + ' 字');
  判('0丙 作图工位的 drawkb 开着', F.开关 === true);
  判('0丁 9 张卡都在', F.张数 === 9, F.张数 + ' 张');

  // ★★ 等画板那个全局真起来再往下量。硬重载 + setCacheDisabled 会让 GeoGebra 从 CDN
  //   **重新下载**，5 秒不保证到位；而 `ggbApplet` 一旦还没定义，裸写 `ggbApplet && …`
  //   是 **ReferenceError**（不是 undefined）——第 3 趟就死在这儿。
  //   ⇒ 判据用 `typeof`，并且**先等**，让"没起来"变成一条读数而不是一个炸。
  let 板起来了 = false;
  for (let i = 0; i < 60; i++) {                                  // 最多 30 秒
    if (await ev('(typeof ggbApplet !== "undefined") && !!ggbApplet && typeof ggbApplet.getAllObjectNames === "function"') === true) { 板起来了 = true; break; }
    await sleep(500);
  }
  判('0戊 画板那个全局起来了（没起来的话"板上几个对象"这一格量不了）', 板起来了, 板起来了 ? 'ggbApplet 就绪' : '★ 30 秒没等到 ggbApplet');
  // 统一的安全取法：一律 typeof 打头，绝不裸引
  const 取板 = '(function(){ if (typeof ggbApplet === "undefined" || !ggbApplet || typeof ggbApplet.getAllObjectNames !== "function") return null; return ggbApplet.getAllObjectNames(); })()';

  // ── 0己. ★★ 先把这个标签页**摆到「作图」工位**，并且**读回来核**（2026-10-06 夜补）──
  //
  //   为什么非补这一格不可（这一趟就是这么红的）：
  //   这个隔离 profile 里同时开着**十几个**同源的 8138 标签页（历次探针留下的），
  //   而工位是**跨刷新存在 `mathroot_work` + 每个标签页各自记在内存里**的。
  //   上面选标签页那段取的是**第一个**能认的 —— 挑中的那一页当场是 `vary`（命题），
  //   于是 1丙「清完还停在『作图』工位」读到「命题」就红了。
  //   ★ 红的是**我写的那句前提**，不是产品：`js/main.js:925` 那颗 ⟳ 走的是
  //     `SR.chat.reset(work, {wipe:true})`，它**一个字都不改工位**（那条路我核过）。
  //   同族老账：[[scanner-numbers-are-not-what-they-claim]] 里「19 个同源页里挑错」。
  //   ⇒ 两条治法一起上：① 量之前把工位**摆正并核回来**；② 断言改成
  //     「清空**不改**工位」（把一个**没量过的前提**换成一个当场量得到的等式）。
  const 摆 = await ev('(function(){ SR.main.applyWork("draw"); return 1 })()');
  await sleep(900);
  const 摆回 = await ev('JSON.stringify({ getWork: SR.chat.getWork(), 亮: (function(){var b=document.querySelector("#works .workbtn.on");return b?b.textContent.trim():null})(), dataWork: document.body.getAttribute("data-work") })');
  判('0己 ★ 量之前先把这一页摆到「作图」并核回来（不然量的是别人那页）',
    String(摆回).indexOf('"getWork":"draw"') >= 0 && String(摆回).indexOf('作图') >= 0, String(摆回));
  if (String(摆回).indexOf('"getWork":"draw"') < 0) {
    console.error('★ 摆不进「作图」工位（' + 摆回 + '）—— 下面每一格量的都不是作图，本趟作废。');
    w.close(); await 关掉自己(); process.exit(2);
  }

  // ── 1. 按产品自己的路清空（#newbtn，不是 #清空 那个后门）──────────
  const 清前 = JSON.parse(await ev('JSON.stringify({账本: SR.memo.turns().length, 板: (function(){ var n = ' + 取板 + '; return n ? n.length : null })(), 工位亮: (function(){var b=document.querySelector("#works .workbtn.on");return b?b.textContent.trim():null})()})'));
  const nb = JSON.parse(await ev('(function(){ var b=document.getElementById("newbtn"); if(!b) return JSON.stringify({err:"没有 #newbtn"}); var r=b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), aria:b.getAttribute("aria-label"), 命中:(function(e){return e?(e.tagName+"|"+(e.id||e.className)):null})(document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)))}) })()'));
  if (nb.err) { console.error('★ ' + nb.err); w.close(); await 关掉自己(); process.exit(2); }
  await 发('Input.dispatchMouseEvent', { type: 'mousePressed', x: nb.x, y: nb.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(60);
  await 发('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nb.x, y: nb.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(2500);
  const 清后 = JSON.parse(await ev('JSON.stringify({账本: SR.memo.turns().length, 板: (function(){ var n = ' + 取板 + '; return n ? n.length : null })(), 气泡: document.querySelectorAll(".msg").length, 工位亮: (document.querySelector("#works .workbtn.on")||{}).textContent})'));
  console.log('\n清空前：' + JSON.stringify(清前) + '  清空后：' + JSON.stringify(清后) + '  （点的 aria=' + nb.aria + '，命中=' + nb.命中 + '）');
  判('1甲 按「清空」真把账本清了（说明这一下落在产品那颗按钮上，不是空点）', 清后.账本 < 清前.账本 || 清后.账本 <= 1, 清前.账本 + ' → ' + 清后.账本);
  判('1乙 清空后画板是干净的（这一轮建出来的对象才认得出来）', 清后.板 === 0, '板上 ' + 清后.板 + ' 个对象');
  // ★ 写成一个**当场量得到的等式**（清前 vs 清后），不写成"清完还停在作图"——
  //   后者把"清前是作图"这件事当成了不用量的前提，而这一趟正好就栽在那句前提上。
  判('1丙 ★ 清空**不改**工位（清前清后是同一个）', 清后.工位亮 === 清前.工位亮,
    JSON.stringify(清前.工位亮) + ' → ' + JSON.stringify(清后.工位亮));

  // ── 2. 像老师那样敲字 + 回车 ────────────────────────────────────
  await ev('(function(){ var i=document.getElementById("input"); i.focus(); i.value=""; i.dispatchEvent(new Event("input",{bubbles:true})); return true })()');
  await 发('Input.insertText', { text: 话 });                     // 真·插入，会触发 input 事件
  await sleep(300);
  await 发('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await 发('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  console.log('\n敲进去并回车了，等它答…');

  // ── 3. 等这一轮答完 ─────────────────────────────────────────────
  let 答完了 = false, 次 = 0;
  while (次++ < 120) {                                            // 最多 60 秒
    await sleep(500);
    const 忙 = await ev('(SR.chat && SR.chat.isAsking) ? SR.chat.isAsking() : "没有 isAsking"');
    if (忙 === false) { 答完了 = true; break; }
  }
  await sleep(2500);                                              // 收尾那几笔（画板排版那串 0/800/…ms）
  判('2甲 这一轮真的答完了（不是卡在半路）', 答完了, 答完了 ? 'isAsking 回到 false' : '★ 60 秒还没答完');

  // ── 4. 老师看见了什么 ───────────────────────────────────────────
  const 屏 = JSON.parse(await ev(`(function(){
    var us = document.querySelectorAll('.msg.user'), as = document.querySelectorAll('.msg.assistant');
    var 末 = as[as.length-1];
    var st = document.getElementById('status');
    return JSON.stringify({
      用户气泡: us.length, 助手气泡: as.length,
      我的原话: us.length ? (us[us.length-1].textContent||'').trim().slice(0,60) : null,
      末条助手: 末 ? (末.textContent||'').replace(/\\s+/g,' ').trim().slice(0,180) : null,
      末条底下有几颗按钮: 末 ? 末.querySelectorAll('.copybar .copybtn').length : null,
      状态条: st ? (st.textContent||'').trim() : '(没有 #status)'
    }) })()`));
  console.log('\n屏幕上：' + JSON.stringify(屏, null, 1).replace(/\n/g, '\n  '));

  // ── 5. 提示词那一格：卡真贴上了吗 ───────────────────────────────
  // ★★ 读**产品自己按轮记的那份账**（`SR.flow.list()`，每趟 ask 一个 round，
  //   `prompt` 那步的 `out` 就是**真发出去的那一整段 system**），不去挂 `SR.api.ask` 的钩子。
  //   为什么非这样不可（第 2 趟栽的两下，一下比一下阴）：
  //     ① `SR.api.lastSystem` **只有一个槽**。这一轮要是碰上了**自修**
  //        （`js/chat.js` 的 试自修→去问），那第二趟会被再调一次 ask，槽就被覆盖：
  //        门对老师原话认出来的是 ["立体几何（三维画板）","三视图、展开图"]，
  //        而"真贴进 system 的"读出来是 ["动点题里一定要用到的几句话"] ——
  //        两张单子对不上，看着像"门贴错了卡"，其实是**我量的是另一轮**。
  //     ② 我先前那个钩子是在 `原.apply(...)` **同步返回之后**抄 `lastSystem` 的。
  //        可 `ask` 是 `async`，而 `SR.api.lastSystem = sysText` 排在 **682/699 两处
  //        `await` 之后**——抄的时候那件事**还没发生**，读回来 `卡=[]`、`sys长=0`，
  //        **长得跟"门根本没贴卡"一模一样**。又一次"尺子读在事情发生之前"。
  //   （同族：[[scanner-numbers-are-not-what-they-claim]] 里"按秒表读状态"那几条。）
  const 轮 = JSON.parse(await ev(`(function(){
    if (!SR.flow || !SR.flow.list) return JSON.stringify([{ 没账本: 'SR.flow.list 不在' }]);
    return JSON.stringify(SR.flow.list().map(function (r) {
      var p = null;
      for (var i = 0; i < r.steps.length; i++) if (r.steps[i].id === 'prompt') p = r.steps[i];
      var s = String((p && p.out) || '');
      return { n: r.n, work: r.work, text: String(r.text || '').replace(/\\s+/g, ' ').slice(0, 70),
               sys长: s.length, 有prompt步: !!p,
               卡: SR.drawkb.卡.filter(function (c) { return s.indexOf(c.体) >= 0; }).map(function (c) { return c.名; }) };
    }));
  })()`));
  const 门 = await ev(`JSON.stringify(SR.drawkb.翻(${JSON.stringify(话)}).map(function(c){return c.名}))`);
  console.log('\n这一轮一共发了 ' + 轮.length + ' 趟（产品自己按轮记的账）：');
  轮.forEach((r, i) => console.log('  第' + (i + 1) + '趟 work=' + r.work + '  「' + r.text + '」  → 卡=' + JSON.stringify(r.卡)
    + '  system ' + r.sys长 + ' 字' + (r.有prompt步 === false ? '  ★这一轮根本没有 prompt 步（读不到，不等于没贴）' : '')
    + (r.没账本 ? '  ★' + r.没账本 : '')));
  console.log('   门对**老师原话**认出来的卡：' + 门);

  // ★ 期望卡传 '-' 表示"这一句本来就该一张都不翻"（瞎问那一趟）。两边的判据不一样：
  //   该翻的看"在不在"，不该翻的看"是不是空的"——用同一个断言糊两件事就成了恒真。
  const 该不翻 = 期望卡 === '-';
  // ★ 读不到账本时**不许**退化成"卡=[]"——那会跟"门没贴卡"长得一样。
  //   所以缺账本时断言直接判红，读数写"读不到"，不写空数组。
  const 读不到 = !轮.length || !!轮[0].没账本 || 轮[0].有prompt步 === false;
  const 首趟 = 轮[0] || { 卡: [], sys长: 0, text: '(没记到)' };
  const 首趟卡 = 读不到 ? '★读不到（不是"没贴卡"）' : JSON.stringify(首趟.卡);
  if (该不翻) {
    // ★ 这两格都要 `!读不到` 打头：读不到时 首趟.卡 是空数组，
    //   不设这道闸的话"这一句该一张都不翻"会被**空读数**判成绿——最阴的那种假绿。
    判('3甲 这一句本来就该一张卡都不翻（门在真页面上也得是紧的）', !读不到 && 首趟卡 === '[]', 首趟卡);
    判('3乙 首趟 system 就是折后那版 base（没多贴东西）', !读不到 && 首趟.sys长 > 19000 && 首趟.sys长 < 21000, 首趟.sys长 + ' 字');
    判('3丙 门认出来的也是空', 门 === '[]', 门);
  } else {
    判('3甲 首趟（老师那一句）真贴上了「' + 期望卡 + '」那张卡', !读不到 && 首趟.卡.indexOf(期望卡) >= 0, 首趟卡);
    判('3乙 首趟总长确实降下来了（19.5k + 一两张卡）', !读不到 && 首趟.sys长 > 19000 && 首趟.sys长 < 26000, 首趟.sys长 + ' 字');
    判('3丙 门的输入是**老师这句原话**（不是被 history 顶掉的那份）', JSON.parse(门).indexOf(期望卡) >= 0, 门);
  }
  // ★ 自修那一趟是**另一趟**，它的门认的是它自己那段修理指令——单列出来，不混进上面。
  if (轮.length > 1) {
    console.log('   ★ 第2趟起是自修（`js/chat.js` 的 去问）：它喂给门的 text 是**它自己那段修理指令**，');
    console.log('     不是老师原话 ⇒ 认出来的卡**可以跟首趟不一样**。这是"量的是哪一轮"的问题，不是门贴错了。');
  }

  // ── 6. 板子上真有东西吗（说了话 ≠ 画了图）──────────────────────
  const 板 = JSON.parse(await ev('JSON.stringify(' + 取板 + ')'));
  console.log('\n板上对象：' + (板 ? 板.length + ' 个 ' + JSON.stringify(板.slice(0, 14)) : '★ ggbApplet 读不到'));
  // ★ 两挡的期望**相反**：该画的看"有没有"，瞎问的看"是不是空的"。
  //   写成一句"板上得有东西"会怎样：瞎问那一趟板子干干净净，**反过来被判红** ——
  //   而"红的样子"跟"产品真没画"一模一样。这跟上面 3甲 是同一个道理，两边都得分开写。
  if (该不翻) {
    判('4甲 瞎问这一趟板子**干干净净**（没画 = 对；跟这一轮"没翻卡"对得上）', Array.isArray(板) && 板.length === 0, 板 ? 板.length + ' 个对象' : '读不到');
  } else {
    判('4甲 画板真建出对象了（模型说了话 ≠ 图上真有了）', Array.isArray(板) && 板.length > 0, 板 ? 板.length + ' 个' : '读不到');
  }

  // ── 7. 全场没有报错 ─────────────────────────────────────────────
  console.log('\n控制台 warning/error（不分来源，看个全貌）：' + (控制台.length ? '\n  ' + 控制台.join('\n  ') : '（没有）'));
  console.log('★★ 我们自己的报错（8138 上的文件，判红就看这一栏）：' + (报错.length ? '\n  ' + 报错.join('\n  ') : '（没有）'));
  console.log('★ 外来的（GeoGebra 的 web3d、智谱限流、CDN —— 单列，不冒充"我们坏了"）：' + (外方.length ? '\n  ' + 外方.join('\n  ') : '（没有）'));
  判('5甲 这一整趟**我们自己的**没报错', 报错.length === 0, 报错.length ? 报错.join('；') : '一个都没有');
  判('5乙 我们自己的文件没有 4xx/5xx', 缺.length === 0, 缺.length ? 缺.join('；') : '一个都没有');

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  w.close(); await 关掉自己();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

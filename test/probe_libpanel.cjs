// 量「资料库」面板（js/libui.js + index.html 的 #libp + css 的 #libp*）。
//
// ★★ 这条探针要证的**最要紧那件事**，不是"面板长得对"，而是：
//    · 它**开机和开面板都不发请求**（挂了监听、不干活）；
//    · 「拿原件」把**这一条**的 key 送出去（不是别人的、不是标题）；
//    · 失败那几种**分得开**（云上挂了 / 库里真没有 / 本机 CORS 挡着）——
//      这三样从外面看都是"名单空着"，糊成一句话就没法查了。
//
// ⚠ 探针纪律（跟 probe_ggbcmds_live.cjs 同一套，别动）：
//   · 浏览器必须**开着窗口**（不带 --headless），用隔离档案 test/_chrome，绝不碰他桌面那个 Chrome；
//   · 每次都要**硬重载**（`Page.reload {ignoreCache:true}`）——
//     dev server 会给 js 发 `no-store`（见 test/serve.cjs），但硬重载这个动作本身要留着；
//   · ⚠⚠ **本探针不碰 `Network.setCacheDisabled`**（2026-10-06 夜实测它会让 `window.ggbApplet`
//     永远停在 undefined，见 probe_ggbcmds_live.cjs 顶上那段）。这一版不量画板，
//     但不能靠"我这次用不上"过日子——留着那行，下一个人复制这份探针去量画板就中招。
//     这一版要计请求数，走的是**包一层 `window.fetch`**，跟 Network 域没关系。
//   · 读数一律从 SR 里读、从真 DOM 里读，不猜。
//
// ★★ 群 7 是**反例**（这份探针里唯一有点讲究的地方）。理由跟 test/_自检_围栏.cjs 顶上那段一样：
//   只会变绿的尺子不算尺子。而这一版有个特别容易假绿的地方——
//   **按钮上那些监听是渲染时绑上去的**，光把 `SR.LIBUI` 换掉，已经画出来的那颗按钮
//   还绑着**旧函数**。所以造坏必须走 `__装版()`：先把那几颗节点 clone 掉换新
//   （旧监听整批丢），再装新源码、再 init。
//   ⚠ 换完必须**读回来核**（新源码里塞了一句 `SR.LIBUI.__坏 = '①'`，读不到就是没装上，
//     这一轮读数作废）——"编辑打空、验的却是没改过的那份"这一族栽过多次。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0, 判错 = [];
const 判 = (名, 真, 值) => {
  if (真) { 绿++; console.log('  ✅ ' + 名 + (值 !== undefined ? '   ' + JSON.stringify(值) : '')) }
  else { 红++; 判错.push(名); console.log('  ❌ ' + 名 + (值 !== undefined ? '   ' + JSON.stringify(值) : '')) }
};

// ---- 页面侧那几件工具（一次注入，反复用）----
const 页面工具 = `
window.__换节点 = function(ids){
  ids.forEach(function(id){
    var o = document.getElementById(id); if (!o) return;
    var c = o.cloneNode(true); c.setAttribute('data-换过','1');
    o.parentNode.replaceChild(c, o);
  });
};
window.__装版 = function(src, mark){
  // ① 先把那几颗节点换新 —— 旧监听是绑在**旧节点**上的，不换掉的话，
  //    坏版本装了也没用：点下去响的还是好版本那一颗（假绿）。
  window.__换节点(['libbtn','libp-x','libp-go','libp-all','libp-q']);
  // ② 装新源码。★ 源码最后一句是 SR.LIBUI = (…)()，从参数进来的 SR 就是 window.SR。
  //    ⚠ 这段是**模板字符串里的字**：注释里一个反引号都不许有，有就当场掐断外面那个模板。
  //      2026-10-07 写这一行的时候当场又踩了一次（在那句"不许有反引号"的警告里写了反引号）。
  var f = new Function('SR','document','location',
    src + '\\n; if (SR.LIBUI) SR.LIBUI.__坏 = ' + JSON.stringify(mark || '') + ';');
  f(SR, document, location);
  if (!SR.LIBUI) return '__没装上';
  SR.LIBUI.init();
  return SR.LIBUI.__坏;      // ★ 读回来核
};
window.__搜 = function(词){
  var q = document.getElementById('libp-q');
  q.value = 词;
  document.getElementById('libp-go').click();
  return 1;
};
window.__列 = function(){ document.getElementById('libp-all').click(); return 1 };
window.__note = function(){ var n = document.getElementById('libp-note'); return n ? n.textContent : null };
window.__行 = function(){
  var out = [];
  document.querySelectorAll('#libp-hits .libp-hit').forEach(function(b){
    var g = b.querySelector('.libp-get');
    out.push({
      分: (b.querySelector('.libp-score') || {}).textContent || '',
      名: (b.querySelector('.libp-name') || {}).textContent || '',
      地: (b.querySelector('.libp-where') || {}).textContent || '',
      缺: (b.querySelector('.libp-nokey') || {}).textContent || '',
      摘: (b.querySelector('.libp-snip') || {}).textContent || '',
      有钮: !!g
    });
  });
  return out;
};
// ★★ 计请求数：包一层 fetch。**计数的是"浏览器真发出去的 fetch"**，
//   跟桩装没装无关——桩接管的调用根本走不到这儿，这正好用来证明"桩真的接管了"。
window.__计数 = 0;
if (!window.__包过) {
  window.__包过 = true;
  var 原fetch = window.fetch;
  window.fetch = function(){ window.__计数++; return 原fetch.apply(this, arguments) };
}
// ★ 桩：**照着产品的合同演**（[[scanner-numbers-are-not-what-they-claim]]：
//   "桩不照产品合同演→一个病根长出三件'产品坏了'"）。
//   合同两条：① **永不 reject**，失败是「ok:false + why」；② 成功那一发带 ok:true。
//   ⚠ 少一条都会长出假红：只 resolve 不给 onChunk 那个病根就是这么来的。
window.__桩 = function(答){
  window.__调 = { reslib: [], list: 0, sign: [] };
  SR.gate.reslib = function(q, k){ window.__调.reslib.push([q, k]);
    return Promise.resolve((答.reslib || []).shift() || { ok:false, why:'桩没给这一档' }) };
  SR.gate.libList = function(){ window.__调.list++;
    return Promise.resolve((答.list || []).shift() || { ok:false, why:'桩没给这一档' }) };
  SR.gate.libSign = function(key, sec){ window.__调.sign.push([key, sec]);
    return Promise.resolve((答.sign || []).shift() || { ok:false, why:'桩没给这一档' }) };
  return 1;
};
// ★ 只拦**锚点**的 click（按钮是 <button>，不受影响）——量的就是"它真去下了"。
window.__锚 = [];
(function(){ if (window.__锚包过) return; window.__锚包过 = true;
  var 原click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    window.__锚.push({ 址: this.getAttribute('href'), 名: this.getAttribute('download') });
    return 原click.apply(this, arguments);
  };
})();
window.__开 = function(){ var b = document.getElementById('libbtn'); if (!b) return '__没按钮'; b.click(); return 1 };
window.__书开着 = function(){ var p = document.getElementById('libp');
  return !!p && p.getClientRects().length > 0 };
window.__尺开着 = function(){ var p = document.getElementById('tplp');
  return !!p && p.getClientRects().length > 0 };
window.__焦点 = function(){ return document.activeElement ? document.activeElement.id : '' };
// ★★ 派在 **body** 上，不派在 document 上 —— 这一点必须这么写，不然 1.5 会假红：
//   按键的真实现场是"事件从焦点元素冒泡到 document"。可如果直接把事件派给 document，
//   那 document 就**既是目标又是监听者**，按 DOM 规矩，目标节点上的监听是**按注册顺序**
//   一起响的（capture 那一位这时候不作数）。drawui 先注册、我后注册，
//   于是变成"它先关 📐、我再看到 📐 已经没了 → 把 📚 也一起关掉"——
//   而那正是我写 capture 要躲开的那件事，量出来却像"capture 没生效"。
//   派在 body 上就回到真路径：document 的 capture 先响，bubble 后响。
window.__esc = function(){ document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); return 1 };
`;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => {
    let o; try { o = JSON.parse(m); } catch (e) { return }
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] }
  });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  // 把这张标签页提到最前。★ 1.1 量的是"光标落在搜索框里"，而后台标签页里
  //   `focus()` 不一定落到 `document.activeElement` 上 —— 不提到前面，
  //   那一条会红成"产品没给我对焦"，其实是我根本没让这张页有焦点。
  await send('Page.bringToFront', {});
  // ⚠ 这行**故意没有** `Network.setCacheDisabled`，理由见文件顶上。别顺手加回来。
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300);
    return R && R.result ? R.result.value : null
  };
  // ★★ 判据一律 `=== true`（[[scanner-numbers-are-not-what-they-claim]]：
  //   真值字符串当循环条件 —— `'THROW: …'` 是真值，会当场放行）。
  const 等真 = async (式, 秒, 步) => { const n = Math.round(秒 * 1000 / (步 || 300)); for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 300); await sleep(步 || 300) } return -1 };
  // ★ 拍下来是为了**用眼睛看版面**：分数那一列对齐没对齐、摘要那一行截断得难不难看、
  //   一千多行的名单有没有把对话区顶到天上去。这些是断言量不出来的。
  const 拍 = async 名 => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r && r.result && r.result.data) {
      fs.mkdirSync(path.join(__dirname, '_shots'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '_shots', 名), Buffer.from(r.result.data, 'base64'));
      return 名
    }
    return '(没拍到)'
  };

  // ★★ 2026-10-07：这一段原来是"脚本解析到了就算开机"的弱条件，实测它在 **162ms**
  //   就成立 —— 而 `boot()` 那一串末尾的 `SR.LIBUI.init()` / `applyWork()`
  //   （main.js:1027 / 1029）都还没跑。于是：
  //     · 0.1/0.2 量的是**还没画出来的那条栏**（`#toolrail` 在 html 里写着 `hidden`，
  //       是 `paintToolrail()` 把它放出来的）→ 两条红，红的不是产品；
  //     · 1.1 点的那颗 📚 **监听还没绑上** → 面板不开 → 一条红；
  //     · 而紧跟着的 1.2「再点一次收起」**假绿**：它本来就关着、aria 本来就是 "0"。
  //   这是"按秒表读状态，把还没开机读成报错了"那一族（[[scanner-numbers-are-not-what-they-claim]]）。
  //   ⇒ 换成**开机那一串真走完了**的信号。挑 `data-toolrail="1"` 不是随手挑的：
  //     它由 `paintToolrail()` 写，而 paintToolrail 在 `applyWork()` 里调，
  //     `SR.LIBUI.init()` 正好压在 applyWork **前一行** ——
  //     所以"栏画出来了"这一条同时担保了"资料库面板的监听已经挂上"，
  //     不用再给 libui 加一个只有探针用得上的就绪旗标。
  const 开完机了 = '(function(){ try {'
    + ' if (document.readyState !== "complete" || !document.body) return false;'
    + ' if (document.body.getAttribute("data-toolrail") !== "1") return false;'
    + ' var rail = document.getElementById("toolrail"), b = document.getElementById("libbtn");'
    + ' if (!rail || rail.hidden || rail.getClientRects().length === 0) return false;'
    + ' if (!b || b.hidden || b.getClientRects().length === 0) return false;'
    + ' return !!(typeof SR !== "undefined" && SR.LIBUI && SR.api && SR.WORKS'
    + '   && document.querySelectorAll("#works .workbtn").length >= 6'
    + '   && !!document.getElementById("input") && !!document.getElementById("libp"));'
    + ' } catch(e){ return false } })()';

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=libpanel&t=' + Date.now() });
  // ★ 重载那条竞态：`Page.reload` 一发出去，第一个 evaluate 可能落在**正在解析、
  //   连 body 都还没有**的那一份上 —— 0.1 那回就是这么抛的
  //   「Cannot read properties of null (reading 'getAttribute')」（它读的是 document.body）。
  //   办法：先在**当前这份**文档上盖个记号，重载后**等这个记号消失** ——
  //   记号没了才说明已经换成新文档，而不是"旧的还在、读数照样有"。
  const 甲 = await 等真('(function(){ return document.readyState === "complete" && !!document.body })()', 40, 300);
  if (甲 < 0) { console.log('★ 第一趟就没加载完，本次不作数'); ws.close(); process.exit(3) }
  await q('window.__甲版 = 1');
  // ★ 盖完**读回来核**：记号没盖上（比如文档刚好又换了）就不能拿"记号没了"当证据。
  if (await q('window.__甲版') !== 1) { console.log('★ 记号没盖上，"换没换文档"就无从谈起了，本次不作数'); ws.close(); process.exit(3) }
  await send('Page.reload', { ignoreCache: true });
  const 换了 = await 等真('(function(){ try { return typeof window.__甲版 === "undefined"'
    + ' && document.readyState === "complete" && !!document.body } catch(e){ return false } })()', 40, 300);
  if (换了 < 0) { console.log('★ 重载之后没等到新文档，本次不作数'); ws.close(); process.exit(3) }
  const 起 = await 等真(开完机了, 40, 300);
  console.log('换文档 ' + 换了 + 'ms / 等开机 ' + 起 + 'ms');
  if (起 < 0) { console.log('★ 没开完机（或者 js/libui.js 没装上），本次不作数'); ws.close(); process.exit(3) }
  await q(页面工具);
  await sleep(300);
  // ★ 注入完再核一遍：注入不该把页面弄回"没开完机"的样子（核不动就说明上面那一条绿是碰巧）。
  if (await 等真(开完机了, 10, 300) < 0) { console.log('★ 注入之后页面不成开机态了，本次不作数'); ws.close(); process.exit(3) }

  // ─────────────────────────────────────────────
  console.log('\n════════ 0. 入口：左边那条栏里的 📚 ════════');
  const 栏 = await q(`(function(){
    var rail = document.getElementById('toolrail');
    var bs = rail ? rail.querySelectorAll('.railtool') : [];
    var 看 = [];
    for (var i=0;i<bs.length;i++) 看.push({ id: bs[i].id, 看得见: bs[i].getClientRects().length > 0 });
    return { 条在: !!rail && rail.getClientRects().length > 0, 件数: bs.length, 看: 看,
             data_toolrail: document.body.getAttribute('data-toolrail'), 工位: document.body.getAttribute('data-work') };
  })()`);
  判('0.1 栏里有 2 件（📐 + 📚），两件都看得见',
    栏.件数 === 2 && 栏.看.every(x => x.看得见) && 栏.条在, 栏);
  await q(`(function(){ SR.main.applyWork('material'); return 1 })()`); await sleep(800);
  const 组 = await q(`(function(){
    var bs = document.querySelectorAll('#toolrail .railtool'), 看 = [];
    for (var i=0;i<bs.length;i++) 看.push(bs[i].getClientRects().length > 0);
    return { 工位: document.body.getAttribute('data-work'), 都看得见: 看.length===2 && 看[0] && 看[1] };
  })()`);
  判('0.2 [对照] 切到**组卷**工位，📚 照旧看得见（它没写 data-only；写了就会在这儿消失）',
    组.工位 === 'material' && 组.都看得见 === true, 组);

  // ─────────────────────────────────────────────
  console.log('\n════════ 1. 开关（好版本，先量 —— 后面要换版，换完 Esc 监听会累积）════════');
  await q(`(function(){ if (SR.DRAWUI) SR.DRAWUI.关(); SR.LIBUI.关(); return 1 })()`); await sleep(200);
  await q('window.__开()'); await sleep(400);
  const 开1 = await q(`(function(){ return { 开: window.__书开着(), aria: document.getElementById('libbtn').getAttribute('aria-expanded'),
    焦点: window.__焦点() } })()`);
  判('1.1 点 📚 → 面板开、aria-expanded=1、光标已经落在搜索框里（老师点开就能打字）',
    开1.开 === true && 开1.aria === '1' && 开1.焦点 === 'libp-q', 开1);
  await q('window.__开()'); await sleep(400);
  判('1.2 再点一次 📚 → 收，aria-expanded=0',
    (await q('window.__书开着()')) === false
    && (await q(`document.getElementById('libbtn').getAttribute('aria-expanded')`)) === '0');

  await q('window.__开()'); await sleep(300);
  await q('window.__esc()'); await sleep(300);
  判('1.3 开着的时候按 Esc → 收（跟 📐 那条一个规矩）', (await q('window.__书开着()')) === false);

  await q('window.__esc()'); await sleep(150);
  await q(`(function(){ document.getElementById('drawtplbtn').click(); return 1 })()`); await sleep(400);
  await q('window.__开()'); await sleep(400);
  const 两层 = await q(`(function(){ return { 模板开: window.__尺开着(), 资料开: window.__书开着() } })()`);
  判('1.4 [前置] 两个面板能同时开着（作图模板开 → 再开资料库）',
    两层.模板开 === true && 两层.资料开 === true, 两层);
  await q('window.__esc()'); await sleep(400);
  const 一层 = await q(`(function(){ return { 模板开: window.__尺开着(), 资料开: window.__书开着() } })()`);
  判('1.5 ★ [Esc 只收一层] 一次 Esc 只关掉作图模板，资料库**还开着**',
    一层.模板开 === false && 一层.资料开 === true, 一层);
  await q('window.__esc()'); await sleep(400);
  判('1.6 再按一次 Esc → 资料库也收了', (await q('window.__书开着()')) === false);
  await q(`(function(){ if (SR.DRAWUI) SR.DRAWUI.关(); SR.LIBUI.关(); return 1 })()`); await sleep(300);
  await q('window.__开()'); await sleep(400);
  const 反前置 = await q(`(function(){ var p = document.getElementById('tplp');
    return { 模板没开: !p || p.hidden === true, 资料开: window.__书开着() } })()`);
  await q('window.__esc()'); await sleep(400);
  判('1.7 [对照] 📐 没开的时候按 Esc，📚 照样当场关（证明 1.5 不是"Esc 根本不管用"）',
    反前置.模板没开 === true && 反前置.资料开 === true
    && (await q('window.__书开着()')) === false, 反前置);

  // ─────────────────────────────────────────────
  console.log('\n════════ 2. 开机 / 开面板 / 空查询 —— 一次请求都不许发 ════════');
  // ★ 计数从这一刻起。开机那一趟已经在上面跑完了，所以这里量的是
  //   "开面板 + 空框点按钮"这一步——那正是这一条要保的东西。
  const 零0 = await q(`(function(){ window.__计数 = 0; window.__开(); return 1 })()`);
  await sleep(900);
  const 零1 = await q('window.__计数');
  const 二一开 = await q('window.__书开着()');
  判('2.1 点开 📚（面板真的开了）→ 计数仍然是 0', 零1 === 0 && 二一开 === true,
    { 计数: 零1, 开了: 二一开 });
  await q('window.__搜("")'); await sleep(700);
  const 空 = await q(`(function(){ return { 计数: window.__计数, note: window.__note() } })()`);
  判('2.2 空着框点「翻一翻」→ 不发请求，并且当场说清楚该填什么',
    空.计数 === 0 && 空.note === '先写一句关键词 —— 两三个词最好。', 空);

  // ★★ 尺子的对照：证明"计数 0"不是一把死的尺子。
  await q(`(function(){ window.fetch(location.href); return 1 })()`); await sleep(700);
  判('2.3 [尺子对照] 手动发一发 fetch → 计数变 1（0 是量出来的，不是这把尺子不会动）',
    (await q('window.__计数')) === 1);

  // ─────────────────────────────────────────────
  console.log('\n════════ 5. 本机那一发**真**请求（现场读数，只报不判）════════');
  // ★★ 2026-10-07 改过，原话是「这一组不装桩，量的就是本机那条查实过的 CORS」。
  //   实测那个前提**今天不成立**：从 localhost:8138 打真 gate，fetch 是**成立**的
  //   （拿到 HTTP 443、正文空、`SR.gate` 那层回 resolve）—— 那是**云函数网关那头挂了**，
  //   不是浏览器拦的。判据：**fetch 被拒**才是浏览器拦的；成立就是放行了。
  //   ⚠ 别拿 `headers.get('access-control-allow-origin')` 去判 —— ACAO **不在 CORS 安全清单里**，
  //     它在了 JS 也读不到，一律回 null，读成"响应里没这个头"就把结论带反了（我当场栽了一次）。
  //   ⇒ 于是这一段拆成两半：**前半只报现场**（环境会变，拿它当判据就是让平台的病冒充产品的病）；
  //     **后半把三种失败喂给产品**（5b），量的才是"这套说法分不分得开"。
  await q(`(function(){ window.__计数 = 0; window.__搜("一元二次方程 判别式"); return 1 })()`);
  const 真发 = await 等真('window.__计数 >= 1', 12, 300);
  判('5.1 [真发] 有词点「翻一翻」→ 真发了一发 fetch（证明按钮真接到了 SR.gate）', 真发 >= 0);
  const 现场 = await q(`(async function(){
    try { var j = await SR.gate.reslib('一元二次方程 判别式', 3);
          return { 形状: 'resolve', ok: !!(j && j.ok), why: (j && j.why) || '', status: (j && j.status) || 0 };
    } catch(e) { return { 形状: 'reject', 拒因: ((e && e.name) + '：' + (e && e.message)) } }
  })()`);
  console.log('  ▸ 现场读数（**不作判据**）：' + JSON.stringify(现场));
  console.log('    ★ 形状=resolve 且带 status ⇒ **CORS 放行了**（被浏览器拦的话，SR.gate 那层 catch 会回「连不上云函数」）。');

  // ─────────────────────────────────────────────
  console.log('\n════════ 5b. 三种失败**喂给产品**：说法要分得开（这一段才是判据）════════');
  // ★ 为什么要喂：本机现在**撞不出** CORS 那个形状（见上），可"补不补那句缘由"是**产品自己的决定**，
  //   它该被测到，而且该**不管云函数活着还是挂着**都测得到。喂形状正好量这个决定。
  // ★ 每一档之前先拿一个**哨兵**把读数条占住：这样"等到达标"不会栽在**上一档留下的稳值**上
  //   （[[scanner-numbers-are-not-what-they-claim]]：「等稳」会栽在稳的错值上）。
  await q(页面工具);
  const 形 = [
    { 名: '本机 CORS 那一形状',
      答: { ok: false, why: '连不上云函数：Failed to fetch' },
      该有: ['连不上云函数', '只有线上那一页通'], 该无: [] },
    { 名: '云上回的不是 JSON',
      答: { ok: false, why: '云函数回的不是 JSON（HTTP 443）' },
      该有: ['云函数回的不是 JSON', 'HTTP 443'], 该无: ['只有线上那一页通', '连不上云函数'] },
    { 名: '云上没给理由',
      答: { ok: false },
      该有: ['云上没答上来'], 该无: ['只有线上那一页通'] }
  ];
  for (let i = 0; i < 形.length; i++) {
    const f = 形[i];
    await q('window.__桩(' + JSON.stringify({ reslib: [{ ok: false, why: '__哨兵__' }] }) + ')');
    await q(`(function(){ window.__搜("哨兵"); return 1 })()`);
    await sleep(400);
    const 哨 = await q('window.__note()');
    await q('window.__桩(' + JSON.stringify({ reslib: [f.答] }) + ')');
    await q(`(function(){ window.__搜("一元二次方程 判别式"); return 1 })()`);
    // ★ 等的是"哨兵**没了**"，不是"等到达标"——后者会被上一档的稳值骗过去。
    await 等真('(function(){ var n = window.__note(); return !!(n && n.indexOf("__哨兵__") < 0) })()', 12, 300);
    const 话 = await q('window.__note()');
    const 缺 = f.该有.filter(w => String(话 || '').indexOf(w) < 0);
    const 混 = f.该无.filter(w => String(话 || '').indexOf(w) >= 0);
    判('5b.' + (i + 1) + ' ' + f.名 + ' → 说的是**这一档**自己的理由（该有的都到、别档的一句都不许混进来）',
      缺.length === 0 && 混.length === 0 && String(话 || '').indexOf('__哨兵__') < 0,
      { 话: 话, 缺: 缺, 混进来: 混, 哨兵: 哨 });
  }

  // ─────────────────────────────────────────────
  console.log('\n════════ 3./4./6. 装桩：搜、拿原件、列桶 ════════');
  const 桩答 = {
    reslib: [
      // ① 正常一发：两条命中，**第二条故意没有 key**（量的就是"没原件名要说出来"）
      { ok: true, rows: 7706, hits: [
        // ★★ `doc`/`title` 跟 `key` **必须长得不一样**，这不是装饰。
        //   库里真是这样：`title` 是**整个文件路径**（条条开头都重复一遍 `[宜兴东氿中学]`，
        //   见 js/flow.js 的 shortName 那段），而 `key` 是桶里那个对象名。
        //   第一版把它们写成了同一个串 —— 于是反例② 把 `h.key` 换成 `h.title` 之后
        //   **送出去的还是那个值**，"这把尺子量到了那个 bug"当场变成假绿。
        //   同族教训：两个量其实是同一个值，差分之一照就分不出来。
        { id: 1, doc: '[宜兴东氿中学]/00-备用/江苏中考/2024南通中考数学.pdf',
          title: '[宜兴东氿中学]/00-备用/江苏中考/2024南通中考数学.pdf',
          shelf: '中考卷', page: 7,
          key: '00-备用/江苏中考/2024南通中考数学.pdf',
          score: 12.34,
          body: '2024年南通市中考数学试卷\n一、选择题（本大题共10小题，每小题3分，共30分）\n1．下列各数中，最小的数是（　）' },
        { id: 2, doc: '02-东氿自家学案/一元二次方程判别式.docx', shelf: '学案', page: 2,
          title: '02-东氿自家学案/一元二次方程判别式.docx',
          score: 9.5, body: '判别式 Δ=b²-4ac 的三种情形' }
      ] },
      // ② 云上答了、但一条都没有 → **不许**混进 CORS 那句
      { ok: true, rows: 7706, hits: [] }
    ],
    list: [
      { ok: true, n: 3, bucket: 'materials', items: [
        { key: '_56fe_/_4e0a_\\第2章小结.docx', name: '图/七上/第2章小结.docx', size: 201144 },
        { key: 'a/b/课例.docx', name: 'a/b/课例.docx', size: 5120 },
        { key: 'c/图.png', name: 'c/图.png', size: 800 }
      ] }
    ],
    sign: [
      { ok: true, url: 'https://x.example/signed?sig=abc', expires: 600 },
      { ok: false, why: '云存储库的钥匙没配：gate 的环境变量里没有 CLOUDBASE_APIKEY' }
    ]
  };
  await q(`window.__桩(${JSON.stringify(桩答)})`);
  await q(`(function(){ window.__计数 = 0; window.__搜("一元二次方程 判别式"); return 1 })()`);
  const 等行 = await 等真(`document.querySelectorAll('#libp-hits .libp-hit').length === 2`, 8, 300);
  const 搜行 = await q(`(function(){ return { 行: window.__行(), note: window.__note(), 计数: window.__计数,
    词: window.__调.reslib[0][0], k: window.__调.reslib[0][1] } })()`);
  判('3.1 桩真的接管了：真 fetch 计数**没涨**（涨了就说明测的是网络不是桩）', 搜行.计数 === 0, 搜行.计数);
  判('3.2 搜的词一字不差地送出去了（不是空的、不是上一次那个）',
    搜行.词 === '一元二次方程 判别式' && 搜行.k === 8, { 词: 搜行.词, k: 搜行.k });
  判('3.3 桩给了 2 条 → 画了 2 行', 等行 >= 0 && 搜行.行.length === 2, 搜行.行.length);
  判('3.4 第 1 行：分数 / 短名 / "书架 · 第几页" 三样都对',
    搜行.行[0] && 搜行.行[0].分 === '12.34' && 搜行.行[0].名 === '2024南通中考数学.pdf'
    && 搜行.行[0].地 === '中考卷 · 第 7 页', 搜行.行[0]);
  判('3.5 第 1 行底下垫的是**正文头一行**（那是标题，比从中间切一段好认）',
    搜行.行[0] && 搜行.行[0].摘.indexOf('2024年南通市中考数学试卷') === 0, 搜行.行[0] && 搜行.行[0].摘.slice(0, 40));
  // ⚠ 这一条读的是 `libp-nokey`（这一行**自己**那格），不是 `libp-where` ——
  //   一开始读的是后者，读回来的是"学案 · 第 2 页"（同一个行里**前面**那一格），
  //   报成红。产品是对的，是这把尺子指错了地方（"整节断言量的是同一个隐藏元素"那一族）。
  判('3.6 有 key 的那条给按钮，**没有 key 的那条不给按钮、并且当场说明为什么**',
    搜行.行[0].有钮 === true && 搜行.行[1].有钮 === false
    && 搜行.行[1].缺 === '（这条没带原件名，拿不了）'
    && 搜行.行[0].缺 === '', { 一钮: 搜行.行[0].有钮, 二钮: 搜行.行[1].有钮, 二的缺格: 搜行.行[1].缺 });
  判('3.7 读数条：条数 + 库里总块数，都对上',
    搜行.note === '翻到 2 条（库里共 7706 块），按分数排。', 搜行.note);
  console.log('   截图 ' + await 拍('资料库_搜到两条.png'));

  console.log('\n──────── 4. 拿原件 ────────');
  判('4.1 [尺子对照] 还没点之前，一个下载都没发生（下面那条绿不是恒绿的）',
    (await q('window.__锚.length')) === 0);
  await q(`(function(){ var b = document.querySelectorAll('#libp-hits .libp-hit')[0].querySelector('.libp-get');
    b.click(); return 1 })()`);
  const 签完 = await 等真('window.__调.sign.length >= 1', 6, 200);
  const 锚 = await q('window.__锚');
  const 键 = await q('window.__调.sign[0][0]');
  判('4.2 ★ 送出去的 key 是**这一条**的（不是标题、不是别人的那一条）',
    签完 >= 0 && 键 === '00-备用/江苏中考/2024南通中考数学.pdf', 键);
  判('4.3 真去下了：造了一颗锚点、地址是签出来的那个、文件名是这份材料的名字',
    锚.length === 1 && 锚[0].址 === 'https://x.example/signed?sig=abc'
    && 锚[0].名 === '2024南通中考数学.pdf', 锚);
  const 签话 = await q('window.__note()');
  判('4.4 签完那句话**接着**在读数条后面，没把"翻到 2 条"顶掉',
    签话 === '翻到 2 条（库里共 7706 块），按分数排。 ｜ 这份的下载地址已经给了浏览器（600 秒内有效）', 签话);
  判('4.5 按钮签的时候禁用、签完复原（老师不会连点出两份）',
    (await q(`document.querySelectorAll('#libp-hits .libp-hit')[0].querySelector('.libp-get').textContent`)) === '拿原件'
    && (await q(`document.querySelectorAll('#libp-hits .libp-hit')[0].querySelector('.libp-get').disabled`)) === false);
  // 钥匙没配那一档
  await q(`(function(){ var b = document.querySelectorAll('#libp-hits .libp-hit')[0].querySelector('.libp-get');
    b.click(); return 1 })()`); await sleep(700);
  const 钥话 = await q('window.__note()');
  判('4.6 钥匙没配那一档：**响亮地报**（"拿不下来 + 云上原话"），而且不造假下载',
    钥话.indexOf('拿不下来') >= 0 && 钥话.indexOf('CLOUDBASE_APIKEY') >= 0
    && (await q('window.__锚.length')) === 1, 钥话);

  console.log('\n──────── 5b. 「云上答了但一条都没有」跟上面那三档分得开 ────────');
  await q(`(function(){ window.__搜("一个库里绝对没有的词"); return 1 })()`); await sleep(700);
  const 无 = await q('window.__note()');
  判('5.4 库里真没有 → 说"没翻到对得上的"，而且**不许**混进本机那句 CORS',
    无 === '「一个库里绝对没有的词」在库里没翻到对得上的。换个词试试 —— 库里题名多半带着章节号。'
    && 无.indexOf('只有线上那一页通') < 0 && 无.indexOf('连不上云函数') < 0, 无);
  判('5.5 这一档把名单清空了（没有上一次那两条挂在那儿）',
    (await q(`document.querySelectorAll('#libp-hits .libp-hit').length`)) === 0);

  console.log('\n──────── 6. 「库里有什么」列桶 ────────');
  await q('window.__列()');
  await 等真(`document.querySelectorAll('#libp-hits .libp-hit').length === 3`, 8, 300);
  const 列 = await q(`(function(){ return { 行: window.__行(), note: window.__note() } })()`);
  判('6.1 桶里 3 个 → 画了 3 行，每行都有「拿原件」',
    列.行.length === 3 && 列.行.every(x => x.有钮 === true), 列.行.length);
  判('6.2 ★ 名字用的是云上还原过的 `name`（人读的），**不是**桶里那个转义过的 key',
    列.行[0].名 === '图/七上/第2章小结.docx', 列.行[0].名);
  判('6.3 转义过的样子（`_56fe_` 那种）一个都不许出现在屏幕上',
    JSON.stringify(列.行).indexOf('_56fe_') < 0, '');
  判('6.4 大小换算成人读的（201144 → 196 KB）', 列.行[0].地 === '196 KB', 列.行[0].地);
  判('6.5 读数条说清了"原件数"和"正文块数"是两回事，而且**没有 markdown 星号漏出来**',
    列.note.indexOf('桶里一共 3 个原件') === 0 && 列.note.indexOf('**') < 0, 列.note);
  console.log('   截图 ' + await 拍('资料库_列桶.png'));

  // ─────────────────────────────────────────────
  console.log('\n════════ 7. 反例（当场从现源码里造坏；装坏了读回来核）════════');
  const 现源 = fs.readFileSync(path.join(__dirname, '..', 'js', 'libui.js'), 'utf8');
  const 病例 = [
    { 名: '① 那颗 📚 没接线（点了什么也不发生）',
      前: "if (b) b.addEventListener('click', 切);",
      换: "if (b) b.addEventListener('click', function(){});",
      该红: '点开' },
    { 名: '② 「拿原件」把标题当成 key 送出去',
      前: 'function () { 拿(h.key, 短名(h), b) });',
      换: 'function () { 拿(h.title, 短名(h), b) });',
      该红: 'key' },
    { 名: '③ 本机那句 CORS 缘由被删掉（失败只剩一句含糊的）',
      前: 'if (本机() && /连不上云函数|Failed to fetch/i.test(why)) {',
      换: 'if (false) {',
      该红: 'CORS' }
  ];

  for (let i = 0; i < 病例.length; i++) {
    const b = 病例[i];
    const 标 = String(i + 1);
    if (现源.indexOf(b.前) < 0) {
      console.log('  ⚠ 反例造不出来：' + b.名 + ' —— 源码里找不到 `' + b.前 + '`');
      判错.push('反例' + 标 + ' 造不出来'); 红++;
      continue;
    }
    const 坏 = 现源.replace(b.前, b.换);
    if (坏 === 现源 || 坏.indexOf(b.前) >= 0) {
      console.log('  ⚠ 反例造不出来：' + b.名 + ' —— 替换没落到地方');
      判错.push('反例' + 标 + ' 替换没落地'); 红++;
      continue;
    }
    const 装上 = await q(`window.__装版(${JSON.stringify(坏)}, "坏${标}")`);
    if (装上 !== '坏' + 标) {
      console.log('  ⚠ 反例装不上：' + b.名 + ' —— 读回来是 ' + JSON.stringify(装上) + '，这一轮不作数');
      判错.push('反例' + 标 + ' 没装上'); 红++;
      continue;
    }
    // 装载之后再布一次桩（新一版的 init 会把节点换掉，但 SR.gate 上的桩还在）
    if (b.该红 === '点开') {
      await q(`(function(){ SR.LIBUI.关(); window.__开(); return 1 })()`); await sleep(500);
      const 还开 = await q('window.__书开着()');
      判('7.' + 标 + ' ✔ 反例成立：' + b.名 + ' → 点 📚 **打不开**（量到了那个 bug）', 还开 === false, { 面板开: 还开 });
      // ★ 病症要**干净**：坏的只是"接线"那一根，面板本体还在 —— 直接调开() 照样开得起来。
      const 直开 = await q(`(function(){ SR.LIBUI.开(); return window.__书开着() })()`);
      判('7.' + 标 + ' [干净] 直接调 SR.LIBUI.开() 照样开 → 坏的只是点击那一根线，不是整个面板',
        直开 === true, 直开);
      await q('SR.LIBUI.关()');
    } else if (b.该红 === 'key') {
      // ★★ 桩要**重新布一次**。上面群 4 已经把它那两条答案各用掉一条（`shift()` 取走的），
      //   不重布的话这一发拿到的是"桩没给这一档"→ 连锚点都不会造出来 →
      //   那条"[干净]"会红成"产品坏了"，而产品好好的。**这是这把尺子自己的账**：
      //   桩是消费型的，谁在它后面再用它，谁就得自己重新装一遍。
      await q(`window.__桩(${JSON.stringify(桩答)})`);
      await q(`(function(){ window.__搜("一元二次方程 判别式"); return 1 })()`);
      await 等真(`document.querySelectorAll('#libp-hits .libp-hit').length === 2`, 8, 300);
      await q(`(function(){ window.__锚 = [];
        document.querySelectorAll('#libp-hits .libp-hit')[0].querySelector('.libp-get').click(); return 1 })()`);
      await sleep(800);
      const 坏键 = await q('window.__调.sign[0] && window.__调.sign[0][0]');
      判('7.' + 标 + ' ✔ 反例成立：' + b.名 + ' → 送出去的不是 key（量到了那个 bug）',
        坏键 !== '00-备用/江苏中考/2024南通中考数学.pdf', 坏键);
      const 名对 = await q('window.__锚[0] && window.__锚[0].名');
      判('7.' + 标 + ' [干净] 同一发里，下载的文件名照旧是对的 → 坏的只是"送哪个字段"',
        名对 === '2024南通中考数学.pdf', 名对);
    } else {
      // ★ 这一档原来要**真发一发**（`location.reload()` 拆桩、走真 SR.gate，赌"本机会被 CORS 拦"）。
      //   2026-10-07 实测那个赌注没了（见上面群 5 那段）⇒ 改成**把 CORS 那一形状喂进去**。
      //   量的还是同一个决定（要不要补那句缘由），但不管云函数活着还是挂着，这一条都成立。
      const CORS形 = JSON.stringify({ reslib: [{ ok: false, why: '连不上云函数：Failed to fetch' }] });
      await q(页面工具);
      await q(`window.__装版(${JSON.stringify(坏)}, "坏${标}")`);
      await q('window.__桩(' + CORS形 + ')');
      await q(`(function(){ window.__搜("一元二次方程 判别式"); return 1 })()`);
      await 等真('(function(){ var n = window.__note(); return !!(n && n.indexOf("没翻成") === 0) })()', 12, 300);
      const 坏话 = await q('window.__note()');
      判('7.' + 标 + ' ✔ 反例成立：' + b.名 + ' → 那句缘由没了（量到了那个 bug）',
        坏话.indexOf('只有线上那一页通') < 0 && 坏话.indexOf('连不上云函数') >= 0, 坏话);
      // ★★ 对照组：**同一个形状、源码一个字没动** → 那句话必须在。
      //   少了这一条，"坏话里没有那句缘由"就分不清是**删出来的**还是**形状本来就不长它**
      //   —— 我刚在 5.2/5.3 上栽的正是这个（红的样子跟产品坏了长得一样）。
      await q(`window.__装版(${JSON.stringify(现源)}, "原")`);
      await q('window.__桩(' + CORS形 + ')');
      await q(`(function(){ window.__搜("一元二次方程 判别式"); return 1 })()`);
      await 等真('(function(){ var n = window.__note(); return !!(n && n.indexOf("没翻成") === 0) })()', 12, 300);
      const 净话 = await q('window.__note()');
      判('7.' + 标 + ' [干净] 同一形状、源码没动 → 那句缘由在（证明上面那条红是删出来的）',
        String(净话 || '').indexOf('只有线上那一页通') >= 0, 净话);
    }
  }

  console.log('\n──────── 绿 ' + 绿 + ' / 红 ' + 红 + ' ────────');
  if (判错.length) console.log('★ 下面这些不对：\n   ' + 判错.join('\n   '));
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });

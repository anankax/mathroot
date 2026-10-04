// 动点动图：**点下去到底动不动**。
//
// 孔老师两遍叮嘱里都点了这一条——「尤其是作图什么的，要保证出图顺畅」、
// 「尤其是动点动图，要看使用起来是否可行」。所以这把尺子量的不是"按钮在不在"，
// 是**后果**：滑块 t 和点 P 的坐标，过一段时间读两次，**真的不一样了没有**。
//
// ★ 为什么不能拿"▶ 播放 这个按钮冒出来了"当结论：
//   按钮在 = `hooks.playState` 那条链通了；点下去动不动 = 另一件事。
//   两件事中间还隔着 `api.setAnimating(name,true)` + `api.startAnimation()`——
//   GeoGebra 那边名字对不上、对象不是滑块、`t` 是常量而不是 Slider……都会让
//   **按钮亮着、点了没反应**。屏幕上"能播"和"其实没播"长得一模一样。
//   这一仓库栽过的那一族，全都是这个形状。
//
// ★ 还有一条**对照**，少了它前面那个"动"不算数：
//   点之前也得读两次，那两次**必须一样**。不然"读两次不一样"可能来自别处
//   （画板正在补画、动画自己跑了、我读的是别人），跟按钮有没有被点没关系。
//
// 用法：node test/probe_anim.cjs [页面地址]
// 前提：**可见窗口**的探针 Chrome 在 9222（别加 --headless=new，他要看得见）；本地服务 8138。
// 退出码：0 = 动点这条路走得通；1 = 有断言红了；3 = 仪器不对（页面没起来）。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PAGE = process.argv[2] || 'http://localhost:8138/index.html';
const T = 'probe_anim_' + Date.now();

// 一道真卷子上的动点题：数轴上 A(-6)、B(6)，P 从 A 出发每秒 2 个单位向 B，
// Q 从 B 出发每秒 1 个单位向 A。t 是时间滑块，t=4 时两点相遇（-6+2t = 6-t）。
// 命令分三块：**建对象** / **藏滑块** / **挂播放键**。
// ★ `#播放 t` 必须是**最后一行**：board.js 里它是逐条执行的（每条间隔 SR.GGB_CMD_DELAY），
//   早读一步 `canPlay()` 就是假——上一趟已经栽过这一次（见 test/_live_anim.cjs 顶上）。
const CMDS = [
  '#清空',
  't=Slider(0,6,0.05)',
  'A=(-6,0)', 'B=(6,0)', 'sAB=Segment(A,B)',
  'P=(-6+2*t,0)', 'Q=(6-t,0)',
  'sAP=Segment(A,P)', 'sBQ=Segment(B,Q)',
  '#隐藏 t',
  '#播放 t'
];
const 该建的 = ['A', 'B', 'P', 'Q', 't', 'sAB', 'sAP', 'sBQ'];

let 绿 = 0, 红 = 0, 仪器不对 = false;
function 判(名, ok, 值) {
  if (ok) { 绿++; console.log('  ✓ ' + 名 + (值 !== undefined ? '  → ' + JSON.stringify(值) : '')); }
  else { 红++; console.log('  ✗ ' + 名 + '  → ' + JSON.stringify(值)); }
}

const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
  r.on('error', rej); r.end();
});
const closeTab = id => new Promise(res => {
  http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res);
});

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200);
    return R && R.result ? R.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  console.log('\n动点动图 · 真跑一道题 → ' + PAGE + '\n');

  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.board&&SR.tabs)')) break; await wait(500); }

  // ---- 0. 仪器自检：页面起来了没有、画板的把手是什么类型 ----
  // ★ `SR.board.applet` 是个**函数**（board.js 交出来的口子），不是对象。
  //   上一趟就是把它当对象用，报 `getXcoord is not a function`——
  //   那读数看着像"画板没有这个方法"，其实是我问错了人。
  const 仪器 = await q('(function(){var o={page:!!(window.SR&&SR.board&&SR.tabs),'
    + 'appletType:typeof (window.SR&&SR.board&&SR.board.applet),'
    + 'ready:!!(SR.board&&SR.board.isReady&&SR.board.isReady())};'
    + 'try{o.方法=(function(){var a=SR.board.applet();if(!a)return"(还没建出来)";var s=[];'
    + '["getValue","getXcoord","setAnimating","startAnimation","getObjectNames","exists"].forEach(function(k){if(typeof a[k]==="function")s.push(k)});'
    + 'return s.join(" ")})();}catch(e){o.方法="取不到:"+e.message}'
    + 'return o;})()');
  console.log('— 仪器 —');
  console.log('  画板把手 applet 的类型 : ' + 仪器.appletType + '（该是 function）');
  console.log('  它交出来的对象有哪些方法 : ' + 仪器.方法);
  if (!仪器.page || 仪器.appletType !== 'function') {
    console.log('\n★ 仪器不对，先别往下判：页面没起来，或 SR.board.applet 不是那个函数。');
    console.log('  （服务在 8138 吗？Chrome 9222 是这个 profile 吗？）');
    await closeTab(t.id); ws.close(); process.exit(3);
  }
  // 画板本体：慢网那一档 applet 会比页面晚得多，等够（board.js 的 waitGGB 最多等 30 秒）
  let 板子等 = null;
  for (let i = 0; i < 40; i++) {
    if (await q('(function(){try{var a=SR.board.applet();return !!(a&&a.getValue&&a.getXcoord&&a.setAnimating)}catch(e){return false}})()') === true) { 板子等 = i; break; }
    await wait(1000);
  }
  判('画板本体建出来了（有 getValue / getXcoord / setAnimating）', 板子等 !== null,
    { 等了: 板子等 === null ? '40 秒还没起' : (板子等 + 's') });
  if (板子等 === null) { await closeTab(t.id); ws.close(); process.exit(1); }

  // ---- 1. 喂一道真题，走出图那条真路 ----
  // ★ 走 `SR.tabs.drawHere`（产品自己那条路），不自己拼 fence —— 拼 fence 等于绕开
  //   render.js 的围栏解析、board 的逐条执行，那条链断了这把尺子照样绿。
  console.log('\n— 出图（一条链真喂进去）—');
  const 起 = Date.now();
  await q('SR.tabs.drawHere(' + JSON.stringify(CMDS) + ',' + JSON.stringify('动点：数轴上相向而行') + ')');
  // ★★ 2026-10-04：这里原来有两处**量错了东西**，第一次跑就是被它们骗的（记在下面）：
  //
  //   ① 判"画完了没有"用的 `SR.board.isBusy()`：它在第 0.5 秒就已经是假了——
  //      因为**活还没排上来**。isBusy 假有两种意思：「画完了」和「还没开工」，
  //      屏幕和读数上长得一模一样。这是这一仓库的老病（拿"还没开机"当"报错了"）。
  //      11 条 × 550ms 本该六秒多，它报 0.5s —— 那个数本身就说明它量的不是这件事。
  //   ② 判"对象建全了没有"问的是 `a.getObjectNames`，而**画板根本没交出这个方法**
  //      （上面仪器那行打出来的方法清单里没有它：getValue/getXcoord/setAnimating/
  //       startAnimation/exists）。取不到 → 我那个 `:[]` 兜底把**"我问错了人"**
  //      变成了**"板上是空的"**——红的样子跟"图没画出来"一模一样，而图明明画出来了
  //      （后头 t/P/Q 都读得到、按钮也亮着）。**兜底值必须长成"我不知道"，不能长成
  //      "产品是空的"**，否则每次取不到都在替产品认一个它没犯的错。
  //
  //   治法：问一个它**确实有**的方法，而且问的就是那句话本身——`exists(名字)`。
  //   然后**等对象真的都在**（那才叫画完），等不到才判红。
  let 画完 = null, 缺 = 该建的.slice();
  for (let i = 0; i < 40; i++) {
    缺 = await q('(function(){try{var a=SR.board.applet();if(!a||!a.exists)return ["(画板没有 exists 这个方法)"];'
      + 'return ' + JSON.stringify(该建的) + '.filter(function(n){try{return !a.exists(n)}catch(e){return true}});}'
      + 'catch(e){return ["取不到:"+e.message]}})()');
    if (Array.isArray(缺) && 缺.length === 0) { 画完 = (Date.now() - 起) / 1000; break; }
    await wait(500);
  }
  判('这条链真画完了（等的是对象真的都在，不是等 isBusy 变假）', 画完 !== null,
    { 耗时: 画完 === null ? '20 秒还没齐' : (画完.toFixed(1) + 's'), 仍缺: 画完 === null ? 缺 : undefined });
  判('该建的对象一个不少（' + 该建的.join('/') + '）', Array.isArray(缺) && 缺.length === 0, { 缺: 缺 });

  // ---- 2. `#播放 t` 那条链通到底了没有 ----
  console.log('\n— 播放键（#播放 那条链）—');
  判('画板自己说"现在有东西可播"（canPlay）', await q('!!SR.board.canPlay()') === true);
  const 钮 = await q('(function(){var b=document.getElementById("btn-play");if(!b)return {在:false};'
    + 'var r=b.getBoundingClientRect();'
    + 'return {在:true, 真的看得见:b.getClientRects().length>0, 占位:Math.round(r.width)+"x"+Math.round(r.height),'
    + '文案:(b.textContent||"").trim()};})()');
  // ★ 量 getClientRects().length，**不量 getComputedStyle().display**——
  //   藏的是它的爹、孩子照样报 flex，这是这个仓库的老账。
  判('▶ 播放那个按钮真的画在屏幕上（不是"在 DOM 里"）', !!钮.真的看得见, 钮);

  // ---- 3. 读一个数：t 的值、P 的横坐标 ----
  const 读 = async () => await q('(function(){try{var a=SR.board.applet();'
    + 'return {t:a.getValue("t"), Px:a.getXcoord("P"), Qx:a.getXcoord("Q")};}catch(e){return "取不到:"+e.message}})()');

  // ---- 4. ★ 对照：**没点之前**读两次，必须一样 ----
  //   少了这一条，下面"读两次不一样"就不能归功给按钮。
  const 静1 = await 读(); await wait(1600); const 静2 = await 读();
  const 静住 = JSON.stringify(静1) === JSON.stringify(静2);
  console.log('  点之前 第1次 : ' + JSON.stringify(静1));
  console.log('  点之前 第2次 : ' + JSON.stringify(静2));
  判('★对照：**没点播放键**的时候，读数一动不动（不然下面那个"动"不算数）', 静住, { 一: 静1, 二: 静2 });

  // ---- 5. 点 ▶，看它真走不走 ----
  console.log('\n— 点 ▶ 之后 —');
  await q('document.getElementById("btn-play").click()');
  const 序 = [];
  for (let i = 0; i < 5; i++) { await wait(900); 序.push(await 读()); }
  序.forEach((x, i) => console.log('  +' + ((i + 1) * 0.9).toFixed(1) + 's : ' + JSON.stringify(x)));
  const t序 = 序.map(x => (x && typeof x.t === 'number') ? x.t : null);
  const 走没 = t序.every(v => typeof v === 'number') && t序.some((v, i) => i > 0 && v !== t序[i - 1]);
  const Px序 = 序.map(x => (x && typeof x.Px === 'number') ? x.Px : null);
  const P动没 = Px序.every(v => typeof v === 'number') && Px序.some((v, i) => i > 0 && v !== Px序[i - 1]);

  判('滑块 t 自己在走（点下去 P 才会动，t 是那个因）', 走没, { t序列: t序 });
  判('★ 点 P 真的在数轴上挪（这是"动点动图"这句话本身）', P动没, { Px序列: Px序 });
  // 图形得跟着动：P 动了，Q 也该动（Q=6-t）——两个点一起被同一个 t 推着走
  const Qx序 = 序.map(x => (x && typeof x.Qx === 'number') ? x.Qx : null);
  判('另一个动点 Q 也跟着同一个 t 在走', Qx序.every(v => typeof v === 'number') && Qx序.some((v, i) => i > 0 && v !== Qx序[i - 1]), { Qx序列: Qx序 });
  // t 只该往一个方向走（Slider(0,6)：从 0 涨到 6 就停），读到回退说明读的是别的东西
  const 单增 = t序.every((v, i) => i === 0 || v >= t序[i - 1]);
  判('t 是顺着走的（没有来回跳——跳说明我读到了别的东西或它到顶了又回绕）', 单增, t序);

  // ---- 6. 点 ⏸，看它真停不停 ----
  console.log('\n— 点 ⏸ 之后 —');
  await q('document.getElementById("btn-play").click()');
  await wait(400);
  const 停1 = await 读(); await wait(1600); const 停2 = await 读();
  console.log('  停之后 第1次 : ' + JSON.stringify(停1));
  console.log('  停之后 第2次 : ' + JSON.stringify(停2));
  判('★ 再点一下它真的停下来（按钮是个开关，不是单程）',
    JSON.stringify(停1) === JSON.stringify(停2), { 一: 停1, 二: 停2 });

  // ---- 7. 两条档：**板子藏着的**和**摊在老师眼前的** ----
  //
  // ★ 为什么非要分开量这两档：`board.js:cmdDelay()` 是**两个数**——
  //   板上有人看（`onScreen()`）走 `SR.GGB_CMD_DELAY`=550ms/条，图**一点点长出来**；
  //   板子在抽屉里没人看走 `SR.GGB_CMD_DELAY_OFFSCREEN`=30ms/条，一口气画完。
  //   上面那一整轮（"耗时 0.5s"）走的其实是**快档**——量到的是没人看的那条路。
  //   可老师真正盯着看的是**慢档**：他就是在那一档里看着图一句一句长出来。
  //   只量快档 ＝ 把"给人看的那一遍"整条漏掉了。
  //   （0.5 秒那个数当时让我起过疑：11 条 × 550ms 本该六秒多。数是对的，
  //     **它量的不是我以为的那件事**——又一条记进那一族。）
  //
  // 量法：喂同一条短链，记「第一个对象出现」到「最后一个对象出现」的间隔。
  //   慢档该是**秒级**，快档该是**毫秒级**。两条都要量，不然分不出哪条是哪条。
  console.log('\n— 两档出图速度（图是"一点点长"还是"一口气"）—');
  const 短链 = ['#清空', 'u=Slider(0,4,0.1)', 'M=(u,0)', 'N=(u+1,0)', '#播放 u'];
  const 量一趟 = async () => {
    const t0 = Date.now();
    await q('SR.tabs.drawHere(' + JSON.stringify(短链) + ',' + JSON.stringify('两档计时') + ')');
    let 见M = null, 见N = null;
    for (let i = 0; i < 150; i++) {
      const o = await q('(function(){try{var a=SR.board.applet();if(!a||!a.exists)return null;'
        + 'return {m:a.exists("M"),n:a.exists("N")};}catch(e){return null}})()');
      if (o) {
        if (o.m && 见M === null) 见M = Date.now() - t0;
        if (o.n && 见N === null) { 见N = Date.now() - t0; break; }
      }
      await wait(100);
    }
    return { M: 见M, N: 见N, 全程: 见N === null ? null : (见N / 1000) };
  };

  await q('SR.main.closeDrawer()'); await wait(400);
  const 快档 = await 量一趟();
  await q('SR.main.openDrawer()');  await wait(600);
  判('抽屉真的打开了（不然下面那条量的还是快档）', await q(
    '(function(){var d=document.getElementById("drawer");'
    + 'return !!d && d.getAttribute("data-drawer")==="open" && d.getClientRects().length>0;})()') === true);
  const 慢档 = await 量一趟();

  // ★★ 判据里**不写死毫秒数**——写死的数会骗人两次：产品真改了节奏它照旧判绿，
  //   而卡死了它也可能因为"够慢了"判绿。直接把页面上那个常量读回来当标尺。
  //   （第一版我手写了个 1200ms，结果实测 1108ms 判红——**那个 1108 是对的**：
  //     M 是第 3 条，前面压着 `#清空` 和 `u=Slider` 两条，2×550=1100。
  //     红的是我的算术，不是产品。）
  const 步长 = await q('(function(){return (window.SR&&SR.GGB_CMD_DELAY)||null})()');
  const 间隔 = (typeof 慢档.M === 'number' && typeof 慢档.N === 'number') ? (慢档.N - 慢档.M) : null;
  console.log('  板子藏着（没人看）: M ' + 快档.M + 'ms → N ' + 快档.N + 'ms');
  console.log('  板子摊开（老师看）: M ' + 慢档.M + 'ms → N ' + 慢档.N + 'ms'
    + '（M→N 隔了 ' + 间隔 + 'ms；页面上那条常量 SR.GGB_CMD_DELAY = ' + 步长 + 'ms）');

  // ★ 两条判据成对，缺一条就成了"无论哪档都判绿"：
  //   光验慢档够慢 → 永远慢也算过（卡死了也算"在慢慢长"）；
  //   光验快档够快 → 永远快也算过（慢档那条路根本没走）。
  // 最直接的那一条是**相邻两条命令之间的间隔**：它就是"图一点点长出来"这件事本身。
  // 取样间隔 100ms，所以给宽一点的上界。
  判('★ 摊开那一档是**一条条长出来**的（相邻两条命令隔着一个 GGB_CMD_DELAY）',
    typeof 间隔 === 'number' && typeof 步长 === 'number' && 间隔 >= 步长 * 0.8 && 间隔 <= 步长 * 5,
    { 实测间隔: 间隔, 该是: 步长 });
  判('★ 摊开那一档不是"一口气"（全程要够长，要能看见它长）',
    typeof 慢档.N === 'number' && typeof 步长 === 'number' && 慢档.N >= 步长 * 1.5,
    { 全程: 慢档.N, 下界: Math.round(步长 * 1.5) });
  判('★ 藏着那一档是**一口气**画完的（没人看就别慢慢放）',
    typeof 快档.N === 'number' && typeof 步长 === 'number' && 快档.N <= 步长, { 全程: 快档.N, 上界: 步长 });
  判('两档确实是两个数（不是被同一个常量焊死的）',
    typeof 慢档.N === 'number' && typeof 快档.N === 'number' && 慢档.N > 快档.N * 2,
    { 慢: 慢档.N, 快: 快档.N });

  // ---- 8. 摊开之后，动点还动得起来吗（在老师眼前那一档再点一次） ----
  await wait(300);
  const 摊着钮 = await q('(function(){var b=document.getElementById("btn-play");return b?b.getClientRects().length:0})()');
  判('摊开那一档也生成了播放键，而且看得见', 摊着钮 > 0, { 盒子数: 摊着钮 });
  if (摊着钮 > 0) {
    const 读u = async () => await q('(function(){try{return SR.board.applet().getValue("u")}catch(e){return "取不到:"+e.message}})()');
    const u1 = await 读u();
    await q('document.getElementById("btn-play").click()');
    await wait(1400);
    const u2 = await 读u(); await wait(1200); const u3 = await 读u();
    console.log('  u 的读数 : ' + JSON.stringify([u1, u2, u3]));
    判('★ 摊在老师眼前那一档，点 ▶ 也真的动（不是只有藏着那条路能动）',
      typeof u1 === 'number' && typeof u3 === 'number' && u3 !== u1, { u: [u1, u2, u3] });
    // ★ 趁着抽屉开着、点还在走，留一张给孔老师看的图：他"使用起来可不可行"
    //   这件事，最后是要**眼睛**过的，不是看这二十行绿。
    const fs0 = require('fs');
    const 边 = await send('Page.captureScreenshot', { format: 'png' });
    try { fs0.writeFileSync(path.join(__dirname, '_shot', 'anim-摊开在眼前.png'), Buffer.from(边.result.data, 'base64')); } catch (e) {}
    await q('SR.board.stopPlay()');
  }

  // ---- 9. ★ 红验：把播放那条链**弄哑**，同一把尺子必须报"不动" ----
  //
  // 一把尺子如果无论产品死没死都报绿，它就不是尺子。上面那些"✓ 点 P 真的在挪"
  // 只有在**真坏了它会变红**的前提下才算数。所以这一节主动制造故障：
  // 把 `SR.board.togglePlay` 换成一个空函数（按钮还在、还能点，只是点下去什么都不做——
  // 这正是"看起来能播"和"其实没播"长得一样的那一档），再用**同一条量法**去读。
  // 该红的地方红出来了，上面那些绿才值钱。
  //
  // ★ 只在**这一个标签页**里改（没碰任何文件），读之前先存一份原函数，读完立刻换回来。
  //   不这么做就等于往产品里塞了个假状态还不收拾——那是"写用户状态却不还原"那一族。
  console.log('\n— 红验：把播放弄哑，尺子该报"不动" —');
  await q('SR.main.closeDrawer()'); await wait(300);
  await q('SR.tabs.drawHere(' + JSON.stringify(短链) + ',' + JSON.stringify('红验') + ')');
  for (let i = 0; i < 40; i++) {
    if (await q('(function(){try{return SR.board.applet().exists("N")}catch(e){return false}})()') === true) break;
    await wait(200);
  }
  await wait(300);
  const u真1 = await q('(function(){try{return SR.board.applet().getValue("u")}catch(e){return null}})()');
  const 换回 = await q('(function(){window.__真toggle = SR.board.togglePlay;'
    + 'SR.board.togglePlay = function(){}; return typeof SR.board.togglePlay;})()');
  await q('document.getElementById("btn-play").click()');
  await wait(1400);
  const u假 = await q('(function(){try{return SR.board.applet().getValue("u")}catch(e){return null}})()');
  await wait(1200);
  const u假2 = await q('(function(){try{return SR.board.applet().getValue("u")}catch(e){return null}})()');
  const 还原了 = await q('(function(){if(window.__真toggle){SR.board.togglePlay = window.__真toggle; delete window.__真toggle;}'
    + 'return typeof SR.board.togglePlay;})()');
  console.log('  弄哑之前 u = ' + JSON.stringify(u真1) + '；点了播放之后 u = ' + JSON.stringify([u假, u假2]));
  判('★ 弄哑之后同一把尺子**确实读到"不动"**（读到动了说明上面那些绿是白给的）',
    typeof u真1 === 'number' && u假 === u真1 && u假2 === u真1, { 前: u真1, 后: [u假, u假2] });
  判('红验只动了这一个标签页，而且已经把 togglePlay 换回原样（没留假状态）',
     typeof u真1 === 'number' && 还原了 === 'function' && 换回 === 'function', { 还原后类型: 还原了 });

  const r = await send('Page.captureScreenshot', { format: 'png' });
  const fs = require('fs');
  const 出 = path.join(__dirname, '_shot', 'anim-动点.png');
  try { fs.writeFileSync(出, Buffer.from(r.result.data, 'base64')); console.log('\n截图 → ' + 出); } catch (e) {}

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  console.log('（标签页**不关**，你可以自己点那个 ▶ 播放 看：' + PAGE + '）');
  ws.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(2); });

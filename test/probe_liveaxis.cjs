// **线上那一页**的数轴：单位长度是不是 1（横轴**和**纵轴都要）。
//
// 为什么单开一把：孔老师两次来问的都是这一条——
//   「为什么你的数轴单位长度不是1，不应该把1、-1这些也给标出来么，为啥只有2、4、6什么的」。
//   本机改了不算数，**线上那一版才是他用来评判的那一版**。
//
// ─────────────────────────────────────────────────────────────────────────
// ★ 这把尺子怎么定下来的（2026-10-04，绕了四个弯，全记下来，别再走回去）
//
// 第一弯：一开始读 `getGraphicsOptions(1)` → 返回 `{}`（一个 axis 键都没有）。
//   看着像"产品没设"，其实是**这个口读不出来**。换成读 getXML 里的
//   `<axis id="0" ... tickDistance="1"/>` 才读得到数。
//
// 第二弯：读到 1 之后我加了条正控——亲手 `setAxisSteps(2,2)` 再读，预期 2。**红了**。
//   我判成"getXML 是载入时的旧快照"。⚠ **这个判断是错的**：我先做过一次
//   `setCoordSystem(-7,7,-3,3)`，读数没动就当成佐证——可那次视野范围**压根没变**，
//   一个动不了的判别动作什么也证明不了。换个会变的量一验就翻案：视野拉宽十倍，
//   XML 的 `scale` 从 35.57 掉到 3.557（正好十分之一）→ **getXML 是活读数**。
//
// 第三弯：既然 XML 是活的，tickDistance 恒为 1 就只剩一个解释——**参数传错了**。
//   真签名是 `setAxisSteps(viewNo, xStep, yStep)` **三个**参数，而 board.js 的
//   `setDefaultView` 里写的是两参 `setAxisSteps(1, 1)`：视图 1、x 步长 1、
//   y 步长 undefined → **纵轴 tickDistance = NaN**。那个"1"只是横轴的，跟产品喊没喊无关；
//   正控红得有理。我探针里的 `setAxisSteps(2,2)` 同样错位（说的是"改 2 号视图"）。
//   ⚠ 这一族（参数写错不报错、只静默换了个量法）本会话已经第二次。
//
// 第四弯：NaN 的**后果**不是"数字是 NaN"，是画出来什么样。板子在 DOM 里待在屏幕外
//   （抽屉关着时 x 永远等于视口宽 +24），截屏截不到——得走 applet 自己渲染，
//   用产品现成的 `SR.board.toPNG()`。实测：NaN 时纵轴标 2,4,6,…（每 2 一个），
//   补上 y 步长 1 之后 1,2,3,…（每 1 一个）。**正是他抱怨的那个症状，跑到纵轴上了。**
//   图片留在 test/_shot/y-现状NaN.png 与 y-补上1.png。
//
// 第五弯：**修完推上去，尺子当场又报红，而线上其实是好的**。因为等待信号选错了：
//   原来拿「`SR.board.applet()` 上有 `getAllObjectNames`」当"装完机"，
//   +2s 就开量 —— 那会儿 applet 只是个半装配的壳，`appletOnLoad`（`setDefaultView`
//   在里面）还没跑：横轴恰好是默认值 1，纵轴还是没配过的 NaN。
//   **又一次把"还没开机"读成了"报错了"**。等真能读要 +23.9s（`setCacheDisabled`
//   逼着 GeoGebra 那一大包重下），那时读到的就是 1/1，之后 12 秒一动不动。
//   治法：等**产品自己**的装完机信号 `SR.board.isReady()`（board.js:1519 `ready = true`
//   写在 appletOnLoad 里，跟 board.js:1527 的 `setDefaultView()` 同一个同步回调）。
//   ⚠ 绝不许拿"tickDistance 不是 NaN"当等待条件——那是**待断言的那个量**，断言会恒绿。
//
// 第六弯：光靠"它在已经修好的线上是绿的"证明不了它能抓 bug（也可能恒绿）。
//   所以每一步都**当场做反例**：亲手按老写法 `setAxisSteps(1,1)` 调一次，
//   纵轴必须读得出 NaN；反例成立，上面的主断言才有意义。
//
// ★ 现在这把尺子这么定：
//   ① 运行时从线上页面读 x/y 两条 tickDistance（活读数，第二弯验过它会动）；
//   ② 两条都必须是"1" —— NaN 也算红（NaN !== "1"），这样第四弯那个 bug 复发就抓得到；
//   ③ 正控：**三参**改成 (1,3,3) 必须读出 3，再还原 (1,1,1) —— 直路，不跟产品抢视图；
//   ④ 再从**线上那份 board.js 源码**里抠出 niceStep，喂线上量到的每单位像素；
//   ⑤ 对照：旧的 50 死阈值喂同一个数必须给 2 —— 他截图上那三个数就是这么来的。
//   ⚠ 抠源码失败一律判红，**不许悄悄拿我脑子里那份规则顶上**。
//
// 用法：node test/probe_liveaxis.cjs [url]     （不传 = 线上；可传 http://localhost:8138/ 先量本机）
// 前提：**可见窗口**的探针 Chrome 在 9222（别加 --headless=new，他要看得见）。
// 退出码：0 = 线上正常；2 = 有断言红了。
const path = require('path'), http = require('http'), https = require('https');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const 线上 = process.argv[2] || 'https://anankax.github.io/mathroot/';
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 取线上某个文件（绕缓存）。用来拿"线上那份 board.js"的原文。
// ⚠ https 站得用 https 模块，`http.get` 会直接抛 ERR_INVALID_PROTOCOL。
function 取线上文件(u) {
  return new Promise((res, rej) => {
    const mod = u.slice(0, 6) === 'https:' ? https : http;
    const r = mod.get(u + (u.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now(), x => {
      if (x.statusCode !== 200) { rej(new Error('HTTP ' + x.statusCode)); x.resume(); return; }
      let d = ''; x.setEncoding('utf8'); x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej);
  });
}

let 绿 = 0, 红 = 0;
function 判(名, ok, 值) {
  if (ok) { 绿++; console.log('  ✓ ' + 名 + (值 !== undefined ? '  → ' + JSON.stringify(值) : '')); }
  else { 红++; console.log('  ✗ ' + 名 + '  → ' + JSON.stringify(值)); }
}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); const v = r.result && r.result.result ? r.result.result.value : null; return v === undefined ? null : v; };

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 线上 });

  console.log('线上数轴核对 → ' + 线上);

  // ★ 句柄取**产品自己驱动的那一块**（SR.board.applet()），不取 `window.ggbApplet`
  //   ——页面上的 applet 不止一块时，那个全局指向谁不好说。
  //   ⚠ 必须**自带括号**：句柄表达式结尾是 `||null`，直接接 `.方法()` 会被 `||`
  //     抢走优先级、静默什么都不做（2026-10-04 在这把尺子的"还原"那行上真栽过一次）。
  const 句柄 = "((window.SR&&SR.board&&SR.board.applet&&SR.board.applet())||null)";
  // ★ 第五弯（2026-10-04 推完之后当场又栽的）：等信号的选错，红就成了假的。
  //   我原来拿「`SR.board.applet()` 上有 `getAllObjectNames`」当"装完机"，
  //   于是 +2s 就开量——可那会儿 applet 只是个**半装配**的壳，`appletOnLoad`
  //   （`setDefaultView` 在里面）还没跑：横轴恰好是默认值 1，纵轴还是没配过的 NaN。
  //   线上**已经修好**了，尺子却报"线上纵轴 NaN"——又一次把"还没开机"读成"报错了"。
  //   实测：等真能读（+23.9s，`setCacheDisabled` 逼着 GeoGebra 那一大包重下）时，
  //   读到的就是 1/1，之后 12 秒一动不动。
  //   治法：等**产品自己**的装完机信号 `SR.board.isReady()`——
  //   它写在 `appletOnLoad` 里（board.js:1519 `ready = true`），跟 `setDefaultView()`
  //   （board.js:1527）同一个同步回调，所以外部轮询只可能在两件事都做完之后才看见它。
  //   ⚠ 绝不许拿"tickDistance 不是 NaN"当等待条件——那是**待断言的那个量**，
  //     拿它等待＝断言恒绿。
  let 到了 = false;
  for (let i = 0; i < 120; i++) {
    const g = await ev("(function(){try{return !!(window.SR&&SR.board&&SR.board.isReady&&SR.board.isReady());}catch(e){return false;}})()");
    if (g === true) { 到了 = true; console.log('  · 产品报"装完机了"（SR.board.isReady）：+' + (i + 1) + 's'); break; }
    await sleep(1000);
  }
  判('线上板子装完机了（SR.board.isReady() 为真）', 到了);
  if (!到了) { ws.close(); await put('/json/close/' + t.id); process.exit(2); }
  await sleep(400);

  // ── ①② 两条轴的刻度间距（主断言） ────────────────────────────────────
  const 读刻度 = "(function(){try{var x=String(" + 句柄 + ".getXML());"
    + "var f=function(i){var m=new RegExp('<axis\\\\s+id=\"'+i+'\"[^>]*tickDistance=\"([^\"]+)\"').exec(x);return m?m[1]:null;};"
    + "var c=/<coordSystem\\b[^>]*?\\bscale=\"([^\"]+)\"/.exec(x);"
    + "return {x轴:f(0),y轴:f(1),scale:c?Number(c[1]):null};}catch(e){return{错:String(e)};}})()";
  const 甲 = await ev(读刻度);
  判('★ 线上横轴刻度间距 = 1（单位长度就是 1）', 甲 && 甲.x轴 === '1', 甲 && { x轴: 甲.x轴, scale: 甲.scale });
  判('★ 线上纵轴刻度间距 = 1（NaN 也算红：那是 setAxisSteps 少传一个参数的后果）', 甲 && 甲.y轴 === '1', 甲 && { y轴: 甲.y轴 });
  if (!(甲 && 甲.scale > 0)) { ws.close(); await put('/json/close/' + t.id); process.exit(2); }
  const 每单位 = 甲.scale;
  console.log('  · 线上每单位 ' + 每单位.toFixed(2) + ' 像素');

  // ── ③ 反例：亲手把老写法复现一遍，证明上面那条断言**看得见**这个 bug ────
  //   为什么非做不可：上面"纵轴 = 1"那条，光看它在**已经修好的**线上是绿的，
  //   证明不了它能抓到 bug —— 它可能无论怎样都报绿。而且"当时线上是红的"是
  //   一次性记忆，修完就没了，下次谁也不敢再信这条尺子。
  //   所以每次跑都**当场**把 `setAxisSteps(1,1)`（老代码那个两参写法）调一次，
  //   它必须把纵轴写成 NaN —— 反例成立了，主断言才有意义。
  const 设 = a => ev("(function(){try{" + 句柄 + ".setAxisSteps(" + a + ");}catch(e){}return 1;})()");
  await 设('1,1'); await sleep(600);
  const 反 = await ev(读刻度);
  判('★ 反例：按老写法 setAxisSteps(1,1) 调一次，纵轴**必须**读得出 NaN（证明主断言看得见这个 bug）',
    反 && 反.y轴 === 'NaN', 反 && { x轴: 反.x轴, y轴: 反.y轴 });
  await 设('1,1,1'); await sleep(600);
  const 复 = await ev(读刻度);
  判('★ 还原成三参 (1,1,1) 之后又回到 1/1（不把反例留在页面上）',
    复 && 复.x轴 === '1' && 复.y轴 === '1', 复 && { x轴: 复.x轴, y轴: 复.y轴 });

  // ── ③b 正控：三参改写必须读得出变化（不是恒读 1） ─────────────────────
  //   ⚠ 第一版这里是 `setAxisSteps(2,2)` —— 少一个参数、第一个还填成了视图号，
  //     语法不报错、行为静默无效，于是正控"红了"，被我误判成"读数不活"。
  await 设('1,3,3'); await sleep(600);
  const 乙 = await ev(读刻度);
  判('★ 正控：三参改成 (1,3,3) 之后读得出 3（不是恒读 1）', 乙 && 乙.x轴 === '3' && 乙.y轴 === '3', 乙 && { x轴: 乙.x轴, y轴: 乙.y轴 });
  await 设('1,1,1'); await sleep(600);
  const 丙 = await ev(读刻度);
  判('★ 还原成 (1,1,1) 之后两条又是 1（不留改动）', 丙 && 丙.x轴 === '1' && 丙.y轴 === '1', 丙 && { x轴: 丙.x轴, y轴: 丙.y轴 });

  // ── ④ 从**线上那份 board.js** 里抠出 niceStep，在 Node 里跑它 ─────────
  const 源 = await 取线上文件(线上.replace(/\/$/, '') + '/js/board.js');
  const m = /function\s+niceStep\s*\(([^)]*)\)\s*\{([\s\S]{0,800}?)\n\s{0,4}\}/.exec(源);
  const 抠到了 = !!(m && /需要/.test(m[2]) && /pxPerUnit/.test(m[2]));
  判('★ 从线上 board.js 里抠出 niceStep（抠不出来就是红，不拿我脑子里那份顶）', 抠到了, { 线上源码字节: 源.length, 命中: !!m });
  if (!抠到了) { console.log('  · 命中片段：' + JSON.stringify(String(m && m[0]).slice(0, 200))); ws.close(); await put('/json/close/' + t.id); process.exit(2); }
  const niceStep = new Function(m[1], m[2]);
  // 调用点给"最宽几位"算出来的是几：视野 ±7 → String(Math.ceil(7)).length + (xMin<0?1:0) = 2。
  // ⚠ 别把期望值钉成 niceStep(每单位, 1)：那是"-6"这种情况，它给 0.5 —— 比 1 **更细**，
  //   方向也是对的（每个整数反而更密），只是不对应他看见的那张图。钉住两条即可：
  //   最宽两位必须是 1；最宽一位必须 ≤1（永远不许比 1 粗）。
  const s2 = niceStep(每单位, 2), s1 = niceStep(每单位, 1);
  判('★ 线上这份 niceStep，喂线上的 ' + 每单位.toFixed(2) + 'px → 步长 = 1（单位长度就是 1）', s2 === 1, { 最宽两位: s2 });
  判('★ 再窄的标签也不许比 1 粗（越细越安全）', s1 <= 1, { 最宽一位: s1 });
  // 对照：同一条 niceStep 喂更宽的视野，必须给得比 1 粗——证明这条尺子会随输入变。
  const 宽 = niceStep(每单位 * 0.3, 1);
  判('★ 对照：视野更宽时它给得出更粗的步长（这条尺子会变，不是恒读 1）', 宽 !== 1, { ['喂 ' + (每单位 * 0.3).toFixed(2) + 'px']: 宽 });

  // ── ⑤ 对照：**旧的 50 死阈值**喂线上这个数，必须给 2 ────────────────
  //    旧代码（改动前）：c 里第一个满足 pxPerUnit*c >= 50 的。他截图上的 2、4、6 就是这么来的。
  const 旧规则 = px => { const c = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; for (const v of c) if (px * v >= 50) return v; return 10000; };
  判('★ 对照：旧的 50 死阈值喂同一个数 → 2（正好复现他截图上的 2、4、6）', 旧规则(每单位) === 2, { ['旧规则(' + 每单位.toFixed(2) + ')']: 旧规则(每单位) });

  // ── ⑥ 板子不是空壳：真建两个点，读回来 ──────────────────────────────
  const 建 = await ev("(function(){try{var a=" + 句柄 + ";"
    + "a.evalCommand('A=(-2,0)');a.evalCommand('B=(3,0)');"
    + "return a.getAllObjectNames().slice();}catch(e){return {错:String(e)};}})()");
  判('★ 线上板子真能建对象（不是空壳）', Array.isArray(建) && 建.indexOf('A') >= 0 && 建.indexOf('B') >= 0, 建);

  // ── ⑦ 反例：页面上不该有异常 ────────────────────────────────────────
  const 台 = await ev('(function(){return (window.__errs||[]).length;})()');
  判('线上这一页没有报错（__errs 计数）', 台 === 0 || 台 === null, { __errs: 台 });

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  ws.close();
  await put('/json/close/' + t.id);
  process.exit(红 ? 2 : 0);
})().catch(async e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

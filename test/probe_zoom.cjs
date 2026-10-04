// 尺子：2026-10-04 孔老师那一整句话，到底做出来了没有。
//
//   「这什么意思，咋是这个图。而且放大的窗口还没有平面和3d两种模式了。
//     也不能放大缩小。没有geogebra的功能在里面，这怎么行呢。」
//
// 拆成四格，一格对一句：
//   ① 放大缩小        —— 「也不能放大缩小」
//   ② 大窗带着工具条  —— 「没有平面和3d两种模式了」「没有geogebra的功能在里面」
//   ③ 大窗里那块板居中 —— 上一轮他说「为啥放大以后不是居中的，是歪的」
//   ④ 冻出来的图是平面的 —— 「这什么意思，咋是这个图」
//
// ★★ ④ 这一格的关键：**判据不能是"图上看着像不像平面"**（那要靠眼睛，而眼睛
//   正是这次没看出来的那个器官——孔老师是拿截图来问我的）。所以量的是**病因本身**：
//   "拍这张照片的那一瞬，板停在几维"。做法是在探针这一侧给 `SR.board.shoot`
//   套一层壳，把 `SR.board.is3D()` 记下来 —— 只包探针、不动产品源码。
//   它量的正是那句话的因果变量：**图长什么样，取决于按快门时板在几维**。
//   ★ 配一条**红验**（第 ④b 格）：照**改之前的老写法**（板停在三维、直接 run + shoot）
//     再拍一张，那一次的读数**必须**是 true。不红一遍的话，这把尺子只是
//     "在坏产品上也是绿的"，等于没量（记忆里那条：红过才算数）。
//
// ★ ① 为什么读 `invXscale` 而不是看 `zoomBy` 的返回值：这个仓库里
//   "返回 false"**不一定**等于没生效（board.js 里 `#隐藏坐标轴` 那一段）。读回来的
//   `invXscale`（一个像素代表多少个单位）才是"画面真的放大了没有"。
//   ⚠ 它是**一个 JSON 字符串**，得 `JSON.parse` —— 直接点属性拿到 undefined，
//     而 undefined 参与算术不报错，会把新取景算成 NaN（这次实测踩到的就是它）。
//
// ★ "看得见吗"一律走 `getClientRects().length`，不走 `getComputedStyle().display`：
//   藏起来的可能是它的**父级**，孩子照样报 flex（踩过，记忆 46 号那一族）。
//
// 用法：node test/probe_zoom.cjs
//   前置：Chrome 在 9222（**要看得见**，不许 --headless）、serve 在 8138。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 过 = 0, 败 = 0;
const 判 = (名, ok, 附) => { console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (附 ? '　' + 附 : '')); ok ? 过++ : 败++ };

// 种进 memo 的那一条：正文里带一道 ```ggb 围栏，命令是一串**平面**作图
//（线段 + 中点，就是孔老师截图里那一句）。整条里一个"三维"的迹象都没有。
const 假的回复 = [
  '先画一条线段 AB，再取它的中点。',
  '',
  '```ggb',
  '#清空',
  'A=(0,0)',
  'B=(3,0)',
  's=线段(A,B)',
  'm=中点(A,B)',
  '```'
].join('\n');

const 那几行 = ['#清空', 'A=(0,0)', 'B=(3,0)', 's=线段(A,B)', 'm=中点(A,B)'];

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};

  // ★ 一只**耳朵**：把页面里抛出来的异常全收下来，末尾**断言为 0**。
  //   这次改的是三处主干（main.js 搬家的主子、board.js 的视角、css 的层），
  //   死了个把函数是最可能的坏法，而那种异常不会经由 `Runtime.evaluate` 回来。
  const 页面异常 = [];
  ws.on('message', m => {
    const o = JSON.parse(m);
    if (o.method === 'Runtime.exceptionThrown') {
      const d = (o.params && o.params.exceptionDetails) || {};
      const 详 = (d.exception && d.exception.description) || d.text || '';
      页面异常.push(String(详).split('\n')[0].slice(0, 160));
    }
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] }
  });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  // ★ 硬重载 + 禁缓存：同域普通导航会吃缓存，把**改之前**那份 JS 当改之后的量
  //   （记忆里那条：核"改动生效没生效"必须先硬重载）。
  await send('Network.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });

  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    return R && R.result ? R.result.value : null;
  };
  const 等真 = async (式, 秒, 步) => {
    const n = Math.round(秒 * 1000 / (步 || 200));
    for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 200); await sleep(步 || 200) }
    return -1;
  };
  const 到 = async (式, 秒, 步) => {
    const 截 = Date.now() + (秒 || 10) * 1000;
    while (Date.now() < 截) { const v = await q(式); if (v) return v; await sleep(步 || 300) }
    return null;
  };

  // 印刻度：一个像素代表几个单位。**小 = 放大**（同一个屏幕宽度里装下的单位更少）。
  const 读数 = "(function(){try{var p=JSON.parse(window.ggbApplet.getViewProperties(1));return {inv:p.invXscale,xMin:p.xMin,宽:p.width}}catch(e){return null}})()";

  // ── 种对话，重开页 ────────────────────────────────────────────────────
  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=zoomseed&t=' + Date.now() });
  await 等真('!!(window.SR&&SR.board&&SR.board.isReady()===true)', 60, 500);
  await sleep(400);
  const 种了 = await q(`(function(){
    SR.memo.clear();
    SR.memo.pushTurn('u', '画一条线段 AB，取中点。', 'draw');
    SR.memo.pushTurn('a', ${JSON.stringify(假的回复)}, 'draw');
    SR.memo.flush();
    return { 轮数: SR.memo.log().length };
  })()`);
  console.log('\n（种一条带 ```ggb 的对话：' + JSON.stringify(种了) + '，然后硬重开。）');

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=zoomrun&t=' + Date.now() });
  const 就绪 = await 等真('!!(window.SR&&SR.board&&SR.board.isReady()===true)', 90, 500);
  判('尺子够得着画板（够不着底下全不用量了）', 就绪 >= 0, '等了 ' + 就绪 + 'ms');
  判('★ 这一版的代码真的在页面上（`SR.board.zoomBy` 出得来 —— 没重载到旧的那份）',
     await q('typeof SR.board.zoomBy === "function"'));
  判('★ 这一版的代码真的在页面上（`SR.board.ensureView` 出得来）',
     await q('typeof SR.board.ensureView === "function"'));
  await send('Page.bringToFront', {});
  await sleep(600);

  // ═══ ① 放大缩小 ═══════════════════════════════════════════════════════
  console.log('\n① 放大缩小（「也不能放大缩小」）');
  await q('(function(){SR.board.setView("2d");return 1})()');
  await sleep(500);
  const z0 = await q(读数);
  await q('(function(){document.getElementById("zoom-in").click();return 1})()');
  await sleep(500);
  const z1 = await q(读数);
  await q('(function(){document.getElementById("zoom-out").click();return 1})()');
  await sleep(500);
  const z2 = await q(读数);
  await q('(function(){document.getElementById("zoom-out").click();return 1})()');
  await sleep(500);
  const z3 = await q(读数);
  console.log('  （一格 = ' + (z0 && z0.inv.toPrecision ? z0.inv.toPrecision(4) : z0 && z0.inv)
    + ' 单位/像素，四步读数：' + [z0, z1, z2, z3].map(v => v ? v.inv.toPrecision(4) : 'null').join(' → ') + '）');

  判('「＋」真把画面放大了（一格代表的单位变**少**）',
     !!(z0 && z1 && z1.inv < z0.inv * 0.95), z0 && z1 ? (z0.inv / z1.inv).toFixed(3) + ' 倍' : '读数没拿到');
  判('「−」真把画面缩小回去（一步退回原来的刻度）',
     !!(z1 && z2 && Math.abs(z2.inv - z0.inv) < z0.inv * 1e-6),
     z1 && z2 ? Math.abs(z2.inv - z0.inv).toExponential(2) : '读数没拿到');
  判('「−」接着按还能再缩（不是按一下就到底）',
     !!(z2 && z3 && z3.inv > z2.inv * 1.05), z2 && z3 ? (z3.inv / z2.inv).toFixed(3) + ' 倍' : '读数没拿到');
  判('缩放围着**画布中心**（xMin 不许原地不动 —— 原地不动就是"围着原点缩"，那是另一种行为）',
     !!(z0 && z1 && z1.xMin > z0.xMin), z0 && z1 ? 'xMin ' + z0.xMin.toFixed(3) + ' → ' + z1.xMin.toFixed(3) : '');
  // 收回来，后面的格子要在默认取景上跑
  await q('(function(){document.getElementById("zoom-out").click();document.getElementById("zoom-out").click();return 1})()');
  await sleep(400);

  // ═══ ② 大窗里有没有那一条工具条 ═══════════════════════════════════════
  console.log('\n② 大窗把整块画板搬过来了没有（「没有平面和3d两种模式了」「没有geogebra的功能在里面」）');
  const 抽屉宽 = await q('Math.round(document.querySelector(".boardwrap").getBoundingClientRect().width)');
  // 开大窗**之前**先数一遍抽屉的孩子。收回来之后要跟这个数**对得上**——
  // `#drawer` 是个正经的侧栏，本来就有十几个孩子，把它跟某个拍脑袋的常数比
  // 是没有意义的（我第一版写的就是 `<= 3`，于是产品是好的、尺子红了）。
  const 抽屉原孩子 = await q('document.getElementById("drawer") ? document.getElementById("drawer").childNodes.length : -1');
  const 抽屉原注释 = await q('(function(){var d=document.getElementById("drawer");if(!d)return -1;var n=0;for(var i=0;i<d.childNodes.length;i++)if(d.childNodes[i].nodeType===8)n++;return n})()');
  await q('(function(){SR.main.openBigFig();return 1})()');
  await sleep(900);
  const 大窗 = await q(`(function(){
    var f = document.getElementById('bigfig'), bar = document.querySelector('.boardbar'),
        sw = document.querySelector('.viewsw button[data-view="3d"]'),
        zi = document.getElementById('zoom-in'), bw = document.querySelector('.boardwrap');
    var 在里头 = function(el){ return !!(el && f.contains(el)) };
    return {
      板在窗里: 在里头(bw),
      工具条在窗里: 在里头(bar),
      三维键在窗里: 在里头(sw),
      缩放键在窗里: 在里头(zi),
      工具条看得见: !!(bar && bar.getClientRects().length),
      三维键看得见: !!(sw && sw.getClientRects().length),
      缩放键看得见: !!(zi && zi.getClientRects().length),
      存图键看得见: !!(document.getElementById('btn-png') && document.getElementById('btn-png').getClientRects().length),
      抽屉那格还在: !!(document.querySelector('.board') ),
      板宽: Math.round(bw ? bw.getBoundingClientRect().width : 0)
    };
  })()`);
  console.log('  （' + JSON.stringify(大窗) + '，抽屉里那块是 ' + 抽屉宽 + 'px 宽）');
  判('★ 搬的是 `.boardbox` 整个盒子：工具条（平面/三维/导图+播放/重画/清空/存图）跟过去了',
     大窗 && 大窗.工具条在窗里 && 大窗.工具条看得见);
  判('★「三维」那颗键在大窗里**看得见**（不是"存在、可点、唯独不可见"）', 大窗 && 大窗.三维键看得见);
  判('★「存图」在大窗里看得见', 大窗 && 大窗.存图键看得见);
  判('★ 放上去的 `#zoom-in` 也跟着搬进来了、看得见', 大窗 && 大窗.缩放键在窗里 && 大窗.缩放键看得见);
  判('★ 大窗里那块板真的撑开了（宽 > 抽屉里的宽，不是缩在左上角一小块）',
     大窗 && 大窗.板宽 > 抽屉宽 + 100, 大窗 ? 大窗.板宽 + ' vs ' + 抽屉宽 : '');

  // ═══ ③ 大窗里居中不居中 ═══════════════════════════════════════════════
  console.log('\n③ 大窗里那块板居中不居中（「为啥放大以后不是居中的，是歪的」）');
  await q('(function(){SR.board.refit();return 1})()');
  await sleep(900);
  const 居中 = await q(`(function(){
    var g = document.getElementById('ggb'), cv = document.querySelector('#ggb canvas');
    if (!g || !cv) return null;
    var gr = g.getBoundingClientRect(), cr = cv.getBoundingClientRect(), cs = getComputedStyle(g);
    var 内容左 = gr.left + (parseFloat(cs.paddingLeft) || 0);
    var 内容右 = gr.right - (parseFloat(cs.paddingRight) || 0);
    return { 左: Math.round(cr.left - 内容左), 右: Math.round(内容右 - cr.right),
             画布宽: Math.round(cr.width), 宿主内容宽: Math.round(内容右 - 内容左) };
  })()`);
  console.log('  （' + JSON.stringify(居中) + '）');
  判('★ 画布在宿主里**居中**（左右留白之差 ≤ 6px）',
     居中 && Math.abs(居中.左 - 居中.右) <= 6);
  判('★ 画布没戳出宿主（右边留白不许是负的）', 居中 && 居中.右 >= -2);
  判('★ 画布真的跟着大窗长大了（> 900px，不是还按抽屉那个尺寸画）', 居中 && 居中.画布宽 > 900);

  await q('(function(){SR.main.closeBigFig();return 1})()');
  await sleep(700);
  // ⚠ 第一次写这把尺子时这里选的是 `.board` —— **页面上没有这个类**
  //   （`.boardbox` 的爹是 `<aside class="drawer" id="drawer">`）。
  //   `querySelector` 返回 null、`contains` 就报 false，于是**产品是好的、尺子红了**。
  //   同族：长期假红 —— 红的样子跟产品坏了长得一模一样。现在按 id 取。
  const 收回来 = await q(`(function(){
    var bar = document.querySelector('.boardbar'), d = document.getElementById('drawer'),
        f = document.getElementById('bigfig');
    return { 工具条回抽屉: !!(bar && d && d.contains(bar)),
             工具条还在窗里: !!(bar && f && f.contains(bar)),
             工具条看得见: !!(bar && bar.getClientRects().length),
             抽屉里孩子数: d ? d.childNodes.length : -1,
             抽屉里注释数: (function(){ if(!d) return -1; var n=0; for(var i=0;i<d.childNodes.length;i++) if(d.childNodes[i].nodeType===8) n++; return n; })() };
  })()`);
  console.log('  （' + JSON.stringify(收回来) + '）');
  判('★ 收回来之后工具条回到抽屉那一栏里（不是把整块板留在大窗里）',
     收回来 && 收回来.工具条回抽屉 && !收回来.工具条还在窗里 && 收回来.工具条看得见);
  // ★ 顺带把"原位那个书签收干净了没有"也量一眼：注释节点留着不占位、看不见，
  //   可**攒起来**会让 `.drawer` 每开一次大窗多一个孩子（同族：写死的件数）。
  判('★ 原位那格跟开大窗之前**长得一模一样**（书签收干净了，没多出孩子）',
     收回来 && 收回来.抽屉里孩子数 === 抽屉原孩子,
     '开窗之前 ' + 抽屉原孩子 + ' 个，收回来 ' + (收回来 ? 收回来.抽屉里孩子数 : '?') + ' 个');
  判('★ 原位一格注释都没留下（书签是 `createComment` 造的，收不干净就攒在这儿）',
     收回来 && 收回来.抽屉里注释数 === 抽屉原注释,
     '开窗前 ' + 抽屉原注释 + ' 个，收回来 ' + (收回来 ? 收回来.抽屉里注释数 : '?') + ' 个');

  // ═══ ④ 冻出来的图是平面的 ═════════════════════════════════════════════
  console.log('\n④ 冻出来的那张图是平面的（「这什么意思，咋是这个图」）');
  //
  // ★ 这一格要**重新开一次页**，而且一开就把大窗开上。
  //   原因是一个实测的时序：重开之后"补图"那一队自己就会把图冻出来（我第一版
  //   写这把尺子时量到 `.figph` 是 0、`.figimg` 已经是 1），而它冻的时候板还是
  //   平面的 —— 那就**永远量不到孔老师那一刻**（板停在三维）。
  //   而 `补图` 有一条"板正摆在老师眼前就让路"的闸（chat.js 的 `板在眼前()`），
  //   所以把大窗赶在板就绪之前开上，图就停在占位上，谁冻、什么时候冻由我说了算。
  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=zoomfig&t=' + Date.now() });
  await 等真('!!(window.SR && SR.main && SR.main.openBigFig)', 30, 100);
  await q('(function(){try{SR.main.openBigFig()}catch(e){}return 1})()');
  await 等真('!!(window.SR&&SR.board&&SR.board.isReady()===true)', 90, 500);
  await sleep(1200);

  const 占位 = await q('document.querySelectorAll(".figph").length');
  判('尺子自检：占位**还在**（大窗赶在补图之前开上了 —— 不在的话这一格什么都没量到）',
     占位 > 0, '占位 ' + 占位 + " 个，真图 " + (await q('document.querySelectorAll(".figimg").length')) + ' 张');
  // ★ 大窗**不许关**。关掉它，`板在眼前()` 立刻变假，"补图"那一队就会自己
  //   把板借走冻一次图，顺手把板**还成它借走时的样子（平面）** —— 我下一句
  //   `setView("3d")` 就被它覆盖掉，于是"前置：板确实在三维"那一格红了。
  //   那是**我自己把测试条件拆了**，不是产品的问题。开着它，补图就一直让路，
  //   板停在三维、占位留着，谁冻由我说了算。
  判('尺子自检：大窗开着（补图才肯让路，板才归我摆布）',
     await q('SR.main.bigFigOpen() === true'));

  // 给 `SR.board.shoot` 套一层壳，把**按快门那一瞬**板在几维记下来。
  // ⚠ 只包探针这一侧，产品源码一个字不动。
  await q(`(function(){
    window.__拍拍 = [];
    if (!window.__shoot原) window.__shoot原 = SR.board.shoot;
    SR.board.shoot = function(cb){ window.__拍拍.push({ 板在几维: SR.board.is3D() }); return window.__shoot原.apply(this, arguments); };
    return 1;
  })()`);

  // ★ 先把板**故意弄成三维**——这正是孔老师截图那一刻板的状态。
  await q('(function(){SR.board.setView("3d");return 1})()');
  await sleep(900);
  判('（前置）板确实被弄到三维上了 —— 不成立的话下面那一格是废话',
     await q('SR.board.is3D() === true'));

  if (占位 > 0) {
    await q('(function(){document.querySelector(".figph").click();return 1})()');
    await sleep(1500);
    // 借板 → 画 → 截图 → 还板，这一趟实测十几秒
    const 成了 = await 到('document.querySelectorAll(".figimg").length', 60, 1000);
    判('图冻出来了（真图出现了 —— 不然底下"拍的时候是平面"这格没得量）', !!成了);
    const 拍拍 = await q('JSON.stringify(window.__拍拍)');
    console.log('  （按快门那一刻记下的：' + 拍拍 + '）');
    const 记录 = JSON.parse(拍拍 || '[]');
    判('★★ 拍这张照片的时候，板是**平面**的（图是平面的 ⇒ 跟那几句命令说的东西一致）',
       记录.length > 0 && 记录.every(r => r.板在几维 === false));
    判('★ 拍完把老师的板**原样还回去了**（他还停在三维上，借板没顺手改他的视角）',
       await q('SR.board.is3D() === true'));
  } else {
    判('★★ 拍这张照片的时候，板是**平面**的', false, '这一格没量到，别当它绿');
  }

  // ★★ 红验：照**改之前的老写法**再拍一张（板停在三维、直接 run + shoot）。
  //   这一次的读数**必须**是 true。不红一遍，上面那格绿了也说明不了尺子认得出好坏
  //   （记忆里那条：这把尺子在坏产品上红过，才算数）。
  await q('(function(){window.__拍拍 = [];SR.board.run(' + JSON.stringify(那几行) + ');return 1})()');
  await sleep(3500);
  await q('(function(){SR.board.shoot(function(){});return 1})()');
  await sleep(3500);
  const 老写法 = JSON.parse(await q('JSON.stringify(window.__拍拍)') || '[]');
  console.log('  （老写法那一次的读数：' + JSON.stringify(老写法) + '）');
  判('★★ 红验：老写法（板停在三维直接拍）这一格**读得出三维** —— 这把尺子在坏产品上会红',
     老写法.length > 0 && 老写法.every(r => r.板在几维 === true));

  // 收尾：把壳摘掉，别影响后面别的探针
  await q('(function(){if(window.__shoot原){SR.board.shoot = window.__shoot原;}return 1})()');

  console.log('\n（页面异常 ' + 页面异常.length + ' 条）');
  页面异常.slice(0, 5).forEach(e => console.log('   ⚠ ' + e));
  判('★ 整场下来页面一条异常都没抛', 页面异常.length === 0);

  console.log('\n' + 过 + ' 绿 / ' + 败 + ' 红\n');
  await send('Page.close', {}).catch(() => {});
  ws.close();
  process.exit(败 ? 2 : 0);
})().catch(e => { console.error('炸了：' + (e && e.stack || e)); process.exit(3); });

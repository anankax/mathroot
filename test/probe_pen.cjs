// 画笔 + 缩放按钮让位 —— 一把尺子量两件事。
//
// ★★ 这把尺子的要害：**"画上去了"必须量画布上的像素，不能量它自报的账。**
//    `__栈().length === 1` 说的是"它记了一笔"，不等于"屏幕上看得见"。
//    同族的坑（scanner-numbers-are-not-what-they-claim）：数字没错，错的是它量的那个东西。
//    所以下面每一条"有笔迹/没笔迹"都走 `getImageData` 数不透明像素。
//
// ★★ 第二条要害：**"按钮按不到"要量鼠标落点归谁（elementFromPoint），
//    不能量 `disabled`。** 孔老师要的是"画的时候不会误触"——
//    那件事发生在**命中测试**这一层，按钮是不是灰的根本不相关。
//    （而且 `elementFromPoint` 会跳过 `pointer-events:none` 的元素，
//      正好一次把"画笔关着时这层不吃鼠标"也量了。）
//
// ★ 红验（反例做进来，不是嘴上说）：
//    · 笔**关着**的时候照原样划一道 —— 墨必须是 0。不然"画得出来"那条可能只是
//      量到了前一条的残留。
//    · 盒子相交那把尺子，先拿 `.InputPanel` 跟**它自己**比一次 —— 必须判成"相交"。
//      判不出相交的尺子，后面那些"不相交"全是假绿。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
function 判(名, 过, 读数) {
  if (过) { 绿++; console.log('  ✅ ' + 名 + (读数 !== undefined ? '   [' + 读数 + ']' : '')) }
  else { 红++; console.log('  ❌ ' + 名 + (读数 !== undefined ? '   [' + 读数 + ']' : '')) }
}

// 画布上的**不透明像素个数** —— "看得见吗"只有这一个真源
const 数墨 = `(function(){
  var c = document.getElementById('penlayer');
  if (!c) return -1;
  var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  var n = 0;
  for (var i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n })()`;

// 某个点上，鼠标到底落在谁身上
const 落点 = x => `(function(){
  var e = document.elementFromPoint(${x}, ${x});
  return e ? (e.id || e.className || e.tagName) : null })()`;
const 落点at = (x, y) => `(function(){
  var e = document.elementFromPoint(${x}, ${y});
  var 名 = e ? (e.id || String(e.className) || e.tagName) : null;
  var 家 = e;
  for (var i = 0; i < 4 && 家; i++) { if (家.id === 'pendock') return 'pendock:' + 名; 家 = 家.parentElement }
  return 名 })()`;

// 画笔那四颗，各自的中心点上鼠标归不归它。（第 2 节和第 8 节共用一份 —— 同一件事只留一把尺子）
const 四颗命中 = `(function(){
  var 出 = [];
  ['pen-toggle','pen-undo','pen-redo','pen-clear'].forEach(function(i){
    var e = document.getElementById(i); if (!e) { 出.push(i+'✗没这颗'); return }
    var b = e.getBoundingClientRect();
    var h = document.elementFromPoint(Math.round(b.left+b.width/2), Math.round(b.top+b.height/2));
    var 家 = h; var 命中 = false;
    for (var k=0;k<4&&家;k++){ if(家.id === i){ 命中 = true; break } 家 = 家.parentElement }
    出.push(i + (命中 ? '✓' : '✗'));
  });
  return 出 })()`;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const targetId = t.id;
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 400));
    return R && R.result ? R.result.value : null;
  };
  // 走**真实输入路径**（CDP 的鼠标事件会合成 pointerdown/move/up）——
  // 直接 constructEvent 派发测不出"真的拿鼠标画能不能画出来"
  const 划 = async 点集 => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 点集[0].x, y: 点集[0].y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i < 点集.length; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点集[i].x, y: 点集[i].y, button: 'left', buttons: 1 });
    }
    const 末 = 点集[点集.length - 1];
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 末.x, y: 末.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(160);
  };
  const 线 = (x1, y1, x2, y2, n) => { const a = []; n = n || 8; for (let i = 0; i <= n; i++) a.push({ x: Math.round(x1 + (x2 - x1) * i / n), y: Math.round(y1 + (y2 - y1) * i / n) }); return a };
  // ★★ 探针自己是个会动手的观众，会改被测对象的状态 —— 得自己收拾。
  //    具体：笔**关着**的时候划一道（红验那条），鼠标落在 `.drawerscrim` 上，
  //    按下抬起 = 点了一下遮罩 = **抽屉关了**，板子被 translateX 推到视口外，
  //    于是后面量 `.zoomctl` / `.InputPanel` 全量到屏幕外面去了 ——
  //    那几条"不相交"就成了白捡的（同族坑：比两个 0）。
  //    第 6 节那条护栏就是这么逮住它的。凡走过必恢复。
  const 保抽屉 = async () => {
    for (let i = 0; i < 4; i++) {
      const 开着 = await q(`(function(){
        var b = document.querySelector('.boardwrap').getBoundingClientRect();
        return !!(b.width && b.left >= 0 && b.left < innerWidth) })()`);
      if (开着 === true) return true;      // ★ 钉 === true，别让真值字符串混过去
      await q('(function(){ if(SR.main && SR.main.openDrawer) SR.main.openDrawer(); return 1 })()');
      await sleep(1800);
    }
    return false;
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=pen&t=' + Date.now() });
  for (let i = 0; i < 300; i++) { if (await q('!!(window.SR&&SR.board&&SR.board.isReady()===true)') === true) break; await sleep(500) }
  await sleep(3200);
  await q(`(function(){ if(SR.landing&&SR.landing.pick) SR.landing.pick('draw',true); return 1 })()`); await sleep(1200);
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 980, deviceScaleFactor: 1, mobile: false });
  await sleep(1600);
  await q('(function(){ if(SR.main && SR.main.openDrawer) SR.main.openDrawer(); return 1 })()');
  await sleep(3200);

  // ---- 0. 装上了没有 ----
  console.log('\n══ 0. 开机 ══');
  const 装 = await q(`(function(){ return {
    有: !!(window.SR && SR.pen),
    画布: !!document.getElementById('penlayer'),
    钮: ['pen-toggle','pen-undo','pen-redo','pen-clear'].filter(function(i){ return !!document.getElementById(i) }).length,
    父: (function(){ var c=document.getElementById('penlayer'); return c && c.parentElement ? c.parentElement.tagName : null })(),
    墨: ${数墨}
  } })()`);
  判('SR.pen 装上了', 装 && 装.有 === true);
  判('画布在', 装 && 装.画布 === true);
  判('四颗按钮都在（笔/撤/重/清）', 装 && 装.钮 === 4, 装 && 装.钮);
  判('画布挂在 <body> 底下（不是抽屉里）', 装 && 装.父 === 'BODY', 装 && 装.父);
  判('开机时画布是空的', 装 && 装.墨 === 0, 装 && 装.墨);

  const 视口 = await q('({w:innerWidth, h:innerHeight})');
  const 板 = await q(`(function(){ var b=document.querySelector('.boardwrap').getBoundingClientRect();
    return { x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2) } })()`);

  // ---- 1. "盖在最上面"：量命中，不量 z-index 数字 ----
  console.log('\n══ 1. 盖在最上面（量鼠标落点归谁）══');
  const 关时 = await q(落点at(板.x, 板.y));
  const 角4 = [await q(落点at(6, 6)), await q(落点at(视口.w - 6, 6)), await q(落点at(6, 视口.h - 6)), await q(落点at(视口.w - 6, 视口.h - 6))];
  判('笔关着：板中央的点归**板子**，不归画笔层', 关时 !== 'penlayer', 关时);
  判('笔关着：四个角一个都不归画笔层（整页没被锁）', 角4.every(v => v !== 'penlayer'), 角4.join(' / '));

  await q('SR.pen.__开关(true)');
  await sleep(180);
  const 开时中央 = await q(落点at(板.x, 板.y));
  const 开时角 = [await q(落点at(6, 6)), await q(落点at(视口.w - 6, 6)), await q(落点at(6, 视口.h - 6)), await q(落点at(视口.w - 6, 视口.h - 6))];
  判('笔开着：板中央那个点归画笔层了', 开时中央 === 'penlayer', 开时中央);
  判('笔开着：四个角全归画笔层（"整页随便画"落到了四角）', 开时角.every(v => v === 'penlayer'), 开时角.join(' / '));

  // ---- 2. 笔开着时别的按钮按不到，但画笔自己那四颗必须按得到 ----
  console.log('\n══ 2. 笔开着：别人按不到、自己按得到 ══');
  const 别人 = await q(`(function(){
    var 出 = [];
    ['btn-save','zoom-in','zoom-out','btn-clear'].forEach(function(i){
      var e = document.getElementById(i); if (!e) return;
      var b = e.getBoundingClientRect();
      if (!b.width || !b.height) return;
      var h = document.elementFromPoint(Math.round(b.left+b.width/2), Math.round(b.top+b.height/2));
      var 名 = h ? (h.id || String(h.className) || h.tagName) : null;
      var 家 = h; for (var k=0;k<4&&家;k++){ if(家.id==='pendock'){ 名='pendock:'+名; break } 家=家.parentElement }
      出.push(i + '→' + 名);
    });
    return 出 })()`);
  const 别人全归画布 = Array.isArray(别人) && 别人.length > 0 && 别人.every(s => /→penlayer$/.test(s));
  判('笔开着：板子上那几颗按钮一律按不到（落点全归画笔层）', 别人全归画布, (别人 || []).join('  '));

  const 自四 = await q(四颗命中);
  判('笔开着：画笔自己那四颗照样点得到（否则开得开、关不掉）',
    Array.isArray(自四) && 自四.every(s => /✓$/.test(s)), (自四 || []).join(' '));

  // ---- 3. 真的画得出线（量像素）----
  console.log('\n══ 3. 画得出线吗（数量画布上的像素，不数它自报的账）══');
  await q('SR.pen.__开关(false)'); await sleep(120);
  await 划(线(300, 300, 700, 300));
  const 关着划的墨 = await q(数墨);
  判('★红验：笔**关着**的时候照原样划一道 —— 墨必须是 0', 关着划的墨 === 0, '墨=' + 关着划的墨);
  // 上面那条红验顺手点了抽屉遮罩一下，抽屉关了 —— 收拾干净再往下走
  await 保抽屉();

  await q('SR.pen.__开关(true)'); await sleep(120);
  await 划(线(300, 300, 700, 300));
  const M1 = await q(数墨);
  判('笔开着：划一道，画布上有墨了', M1 > 0, '墨=' + M1);

  await 划(线(400, 200, 400, 500));
  const M2 = await q(数墨);
  判('再划一道，墨更多了（第二笔真的落上去了）', M2 > M1, '墨=' + M1 + '→' + M2);

  // ---- 4. 撤销 / 重做（全部用像素核）----
  console.log('\n══ 4. 撤销 / 重做 ══');
  await q('SR.pen.__撤销()'); await sleep(120);
  const 撤1 = await q(数墨);
  判('撤销一次 → 回到一笔的样子', 撤1 > 0 && 撤1 < M2, '墨=' + 撤1 + '（两笔时 ' + M2 + '）');
  await q('SR.pen.__撤销()'); await sleep(120);
  const 撤2 = await q(数墨);
  判('再撤销一次 → 空', 撤2 === 0, '墨=' + 撤2);
  await q('SR.pen.__撤销()'); await sleep(120);
  const 撤3 = await q(数墨);
  判('★红验：已经空了再撤销，还是空的（不炸、也不冒出东西）', 撤3 === 0, '墨=' + 撤3);

  await q('SR.pen.__重做()'); await sleep(120);
  const 重1 = await q(数墨);
  判('重做一次 → 第一笔回来了', 重1 > 0 && 重1 < M2, '墨=' + 重1);
  await q('SR.pen.__重做()'); await sleep(120);
  const 重2 = await q(数墨);
  判('再重做一次 → 两笔都回来了', 重2 > M1, '墨=' + 重2 + '（一笔时 ' + M1 + '）');

  // ---- 5. 清屏也能撤销（"操作肯定要能可逆"那条的核心）----
  console.log('\n══ 5. 清屏可逆 ══');
  await q(`(function(){ document.getElementById('pen-clear').click(); return 1 })()`);
  await sleep(160);
  const 清后 = await q(数墨);
  判('点「清」→ 画布空了（而且是真的按到按钮了：落点归它）', 清后 === 0, '墨=' + 清后);
  await q('SR.pen.__撤销()'); await sleep(160);
  const 清撤 = await q(数墨);
  判('★撤销一次 → 清屏前那两笔**全都**回来了', 清撤 > M1, '墨=' + 清撤 + '（清屏前 ' + M2 + '）');

  // 清屏之后接着画，新画的照样能撤
  await q(`(function(){ document.getElementById('pen-clear').click(); return 1 })()`);
  await sleep(140);
  await 划(线(800, 400, 900, 400));
  const 清后画 = await q(数墨);
  判('清屏之后还能接着画', 清后画 > 0, '墨=' + 清后画);
  await q('SR.pen.__撤销()'); await sleep(140);
  const 清后画撤 = await q(数墨);
  判('清屏之后新画的那一笔，撤销得掉（重做的坑挖对了）', 清后画撤 === 0, '墨=' + 清后画撤);

  // ---- 6. 原 bug：缩放按钮压着输入框 ----
  console.log('\n══ 6. 缩放按钮 / 画笔按钮 有没有压着 GeoGebra 那条输入框 ══');
  // 量布局之前先确保抽屉是开着的（关着的话板子在屏幕外，量什么都白搭）
  判('★护栏前置：量之前抽屉是开着的、板子在屏幕里', (await 保抽屉()) === true);
  const 盒 = await q(`(function(){
    var g = function(sel){ var e = document.querySelector(sel); if(!e) return null;
      var b = e.getBoundingClientRect(); if (!b.width || !b.height) return null;
      return { l:Math.round(b.left), t:Math.round(b.top), r:Math.round(b.right), bo:Math.round(b.bottom) } };
    return {
      inbar: g('#ggb .InputPanel') || g('#ggb .AlgebraInput'),
      zoom: g('.zoomctl'), dock: g('#pendock'), 板: g('.boardwrap'),
      视口: { w: innerWidth, h: innerHeight, sx: Math.round(scrollX), sy: Math.round(scrollY),
              滚: document.documentElement.scrollWidth, 客: document.documentElement.clientWidth },
      变量: getComputedStyle(document.documentElement).getPropertyValue('--ggb-inbar').trim() } })()`);
  const 交 = (a, b) => !!(a && b) && a.l < b.r && b.l < a.r && a.t < b.bo && b.t < a.bo;
  const 在屏里 = (b, v) => !!(b && v) && b.r > 0 && b.l < v.w && b.bo > 0 && b.t < v.h;
  // ★ 视口什么时候可能在操作途中漂掉，得看得见才敢信后面的数
  console.log('     视口 ' + JSON.stringify(盒.视口));
  console.log('     输入条 ' + JSON.stringify(盒.inbar) + '   缩放 ' + JSON.stringify(盒.zoom) +
              '   板子 ' + JSON.stringify(盒.板));
  // ★★ 防假绿第一道：**两个盒子都得真在屏幕里**。
  //    要是它俩都在屏幕外，"不相交"是白捡的 —— 量的是两个屏幕上根本没有的东西
  //    （同族坑：整节断言量的是同一个隐藏元素 / 比两个 0）。
  判('★护栏：输入条和缩放按钮都真在屏幕里（在屏外的话下面那条不相交毫无意义）',
    !!盒.视口 && 在屏里(盒.inbar, 盒.视口) && 在屏里(盒.zoom, 盒.视口),
    在屏里(盒.inbar, 盒.视口) + '/' + 在屏里(盒.zoom, 盒.视口));
  // ★★ 防假绿第二道：尺子得**判得出两个不同盒子的相交**。
  //    拿输入条跟它自己比只是恒真；拿缩放按钮跟**板子**比才有意义（按钮画在板子上，必须相交）。
  判('★尺子自检：缩放按钮跟**板子**比，必须判成相交（证明这把尺子能判出相交，不是恒判不相交）',
    交(盒.zoom, 盒.板) === true, 'zoom×board=' + 交(盒.zoom, 盒.板));
  判('尺子自检②：输入框跟它自己比也判相交（退化情形不翻车）',
    交(盒.inbar, 盒.inbar) === true, 盒.inbar ? 'ok' : '量不到输入条');
  判('量到了输入条（不是没量到就往下判）', !!盒.inbar, 盒.inbar ? JSON.stringify(盒.inbar) : 'null');
  判('缩放的「−／＋」不再压着输入条', !!盒.inbar && !交(盒.zoom, 盒.inbar), 盒.zoom ? JSON.stringify(盒.zoom) : 'null');
  判('右下角那四颗画笔按钮也不压着输入条', !!盒.inbar && !交(盒.dock, 盒.inbar), 盒.dock ? JSON.stringify(盒.dock) : 'null');
  console.log('     --ggb-inbar = ' + JSON.stringify(盒.变量));

  // ---- 8. 浮层之上：投影 / 放大看 ----
  // 背景：画笔原来排在 35/36，而「放大看」是 40、投影是 120 —— **两个都压着它**。
  //   孔老师 2026-10-05：「为啥投影模式用不了，画笔就应该是最高层。」
  //   改完要把这两层都量一遍才算数（只改投影那条，放大看会漏）。
  console.log('\n══ 8. 浮层之上：投影 / 放大看 ══');
  // ★ 判"浮层真的开了"必须量 display/visibility/getClientRects 三件，
  //   **不能量 rect** —— 藏着的元素 rect 照样是一组像模像样的数（#bigfig 关着的时候
  //   量出来就是 [259,36,1421,944]，跟开着时一模一样）。这是个现成的坑。
  const 可见 = id => q(`(function(){
    var e = document.getElementById(${JSON.stringify(id)}); if (!e) return null;
    var s = getComputedStyle(e);
    return { 显: s.display, 看: s.visibility, 框: e.getClientRects().length, 层: s.zIndex,
             活: (s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0) } })()`);


  // 8b 放大看（点页面上那颗真按钮，不是自己 setAttribute —— 那样量的是"产品里不存在的路"）
  const 点结果 = await q(`(function(){
    var b = null;
    Array.prototype.slice.call(document.querySelectorAll('button')).forEach(function (x) {
      if (!b && x.textContent.trim() === '放大看') b = x; });
    if (!b) return '没找到那颗按钮';
    b.click(); return '点了' })()`);
  await sleep(1400);
  const 大 = await 可见('bigfig');
  判('「放大看」真的开了（走的是页面上那颗按钮）', !!(大 && 大.活), 点结果 + ' → ' + JSON.stringify(大));
  if (大 && 大.活) {
    await q('SR.pen.__开关(true)'); await sleep(250);
    const 大角 = [await q(落点at(6, 6)), await q(落点at(视口.w - 6, 视口.h - 6))];
    判('★★放大看开着：画笔还在最上面', 大角.every(v => v === 'penlayer'), 大角.join(' / '));
    // 收场：先关笔再关窗（笔开着的时候关闭按钮是点不到的 —— 这正是"笔是工具"该有的样子）
    await q('SR.pen.__开关(false)'); await sleep(150);
    await q(`(function(){ var b=document.querySelector('.bigfigclose'); if(b) b.click(); return 1 })()`);
    await sleep(700);
  } else {
    判('★放大看这一节**没跑成**（窗没开起来）—— 记红，不当绿灯', false, 点结果);
  }

  // ---- 7. 截图留档 ----
  // ★ 故意画两处在**板子以外**：一句对话上圈个圈、顶栏上划一道。
  //   "整页随便画"是这一轮的核心，光在板子上画一条证明不了它。
  const 圈 = (cx, cy, r, n) => { const a = []; n = n || 26; for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2; a.push({ x: Math.round(cx + r * Math.cos(t)), y: Math.round(cy + r * Math.sin(t)) }) } return a };
  await q('SR.pen.__开关(true)'); await sleep(120);
  await 划(线(1200, 200, 1500, 420, 10));       // 板子上：红叉
  await 划(线(1250, 380, 1520, 200, 10));
  await 划(圈(905, 234, 105));                   // ★ 对话里那句"画线段 AB…"圈起来
  await 划(线(190, 118, 420, 118, 8));           // ★ 顶栏上划一道
  await sleep(300);
  const cr = await send('Page.captureScreenshot', { format: 'png' });
  if (cr && cr.result && cr.result.data) {
    fs.mkdirSync(path.join('test', '_shots'), { recursive: true });
    fs.writeFileSync(path.join('test', '_shots', '_画笔.png'), Buffer.from(cr.result.data, 'base64'));
    console.log('\n  截图 test/_shots/_画笔.png');
  }

  console.log('\n══════════════════════════════');
  console.log('  绿 ' + 绿 + ' · 红 ' + 红);
  console.log('══════════════════════════════');
  try { await put('/json/close/' + targetId) } catch (e) {}
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });

// 尺子：一张回复里有好几张冻图时，每张图**钉没钉在它自己那道变式下面**？
//
// 背景（2026-10-03 自己上网页走出来的）：
//   老师问「在数轴上表示 -2 和 3」，命题工位出了三个变式、每个后面跟一张数轴。
//   屏幕上却是"三段题面 + 答案"接"三张图"——三张图还长得差不多（都是数轴，
//   只差几个点）。谁是谁全靠数第几张。老师要的是"这一道题的图"，不是"第 2 张图"。
//
// ★ 为什么量的是**真存档**、不是现编的字符串：
//   `test/_shot/vfvis5-*.txt` 是模型当时的原文（8 份）。里面有个**当初没料到**的形状——
//   8 份里 7 份写了**两组**变式：【第一种·题里有图】三个（带围栏）+
//   【第二种·题里没图】三个（不带围栏）。第一版"后面第一个变式标题"的做法
//   在这 7 份里全错（会把最后一张图推到第二组头上）。换成现编的字符串就量不出这个。
//   （同族：[[scanner-numbers-are-not-what-they-claim]]——现编的输入只能量出你想到的那件事。）
//
// ★ 对照臂（红验）是**改动之前那条路**，同一份断言跑两遍：
//   `老做法` = "围栏后面第一个变式标题"（本文件里照抄了一份，就是改之前 js/chat.js 里的样子）。
//   跑出来的红说明这把尺子认得出差别；要是老做法也全绿，那这把尺子什么都没量。
//
// ★ 量的是**真函数**，不是我另抄一份：从 js/chat.js 里把
//   `RE_FENCE_GGB` … `placeFigures` 那一整段**源码抠出来**，在页面里 eval 进去。
//   抠不到就判"尺子坏"（exit 3）——改过函数名/挪过位置时，这里必须红，不能静默变绿。
//
// 用法：node test/probe_figplace.cjs
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- ① 从产品源码里抠出真函数 ----
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'chat.js'), 'utf8');
const A = SRC.indexOf('var RE_FENCE_GGB');
const Bm = SRC.indexOf('// 打包的账本', A);
if (A < 0 || Bm < 0 || SRC.indexOf('function placeFigures') < 0) {
  console.log('★★★ 抠不出 placeFigures —— js/chat.js 改过结构了。');
  console.log('    下面一条读数都别信，先把抠源码那两行对齐（找 var RE_FENCE_GGB / function placeFigures）。');
  process.exit(3);
}
const 真源码 = SRC.slice(A, Bm);
console.log('抠出真函数：' + 真源码.split('\n').length + ' 行（含 RE_FENCE_GGB / normHead / placeFigures）');

// ---- ② 两个对照臂 ----
//
//   ★ 这两个是这把尺子的**红验**：同一份断言在它们身上必须红，否则"新做法全绿"
//     说明不了任何事——一把永绿的尺子，和没量是一回事。
//
//   ★⚠ 头一版对照写的是"围栏后面第一个变式标题"，那是**我自己刚写的第一版实现**。
//     跑出来它和新版**一模一样 69/70**——因为"后面第一个标题"和"前面数了几个"
//     本来就是同一件事（第 k+1 个标题正是围栏后面那一个）。
//     等于拿新做法跟它自己比，那个"绿"什么都没证明。**真正的改动之前**是下面这条：
//
//   ① `没插` —— 改动之前产品就是这么干的：`attachFigure` 只做 `appendChild`，
//      所有图**全堆在正文末尾**，一步都不挪。这才是本轮的"之前"。
//   ② `差一格` —— 插在**再下一道**变式前面（差一格）。用来证明这把尺子
//      认得出"位置对不对"，不是只会认"动没动过"。
const 没插源码 = `
function placeFiguresNoop(bubble, raw, boxes) {
  return 0;   // 改动之前：appendChild 挂完就完了，没有"钉到它自己那道下面"这一步
}`;
const 差一格源码 = `
function placeFiguresOff1(bubble, raw, boxes) {
  // 把新做法整体抄一遍，只把序号 +1 —— 除了"差一格"它跟产品一字不差
  if (!bubble || !raw || !boxes || !boxes.length) return 0;
  var t = String(raw), ends = [], m, j;
  RE_FENCE_GGB.lastIndex = 0;
  while ((m = RE_FENCE_GGB.exec(t))) ends.push(m.index + m[0].length);
  var 位 = [];
  RE_VHEAD.lastIndex = 0;
  while ((m = RE_VHEAD.exec(t))) {
    if (normHead(m[0])) 位.push(m.index + m[0].indexOf('变'));
    if (RE_VHEAD.lastIndex === m.index) RE_VHEAD.lastIndex++;
  }
  var kids = bubble.children, domHeads = [];
  for (j = 0; j < kids.length; j++) {
    if (kids[j].classList && kids[j].classList.contains('figbox')) continue;
    if (RE_VBLOCK.test(normHead(kids[j].textContent))) domHeads.push(kids[j]);
  }
  var cb = bubble.querySelector('.copybar'), moved = 0;
  for (var i = 0; i < boxes.length; i++) {
    var box = boxes[i];
    if (!box || ends[i] == null) continue;
    var k = 1, h;
    for (h = 0; h < 位.length; h++) if (位[h] < ends[i]) k++;
    var anchor = domHeads[k];
    if (!anchor) { if (!cb) continue; anchor = cb; }
    bubble.insertBefore(box, anchor);
    moved++;
  }
  return moved;
}`;

// ---- ③ 存档 ----
const SHOT = path.join(__dirname, '_shot');
const 文件 = fs.readdirSync(SHOT).filter(f => /^vf.*-\d+\.txt$/.test(f)).sort();
if (!文件.length) { console.log('★ test/_shot 里没有 vf*.txt 存档，没得量。'); process.exit(3); }
console.log('存档 ' + 文件.length + ' 份');
console.log('');

(async () => {
  const tab = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) throw new Error('页面里炸了：' + String((ex.exception && ex.exception.description) || ex.text).slice(0, 500));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: 'http://localhost:8138/index.html?figplace=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.render&&SR.render.md)').catch(() => false)) break; await sleep(500); }
  if (!await ev('!!(window.SR&&SR.render&&SR.render.md)')) { console.log('★ 打不开 localhost:8138（SR.render.md 没就位）。先起 `node test/serve.cjs 8138`。'); process.exit(3); }

  // 把抠出来的两版函数在页面里装好，并自检"真装上了"
  const 装了 = await ev('(function(){try{\n' + 真源码 + '\n' + 没插源码 + '\n' + 差一格源码 + '\n'
    + 'window.__fig={新:placeFigures,没插:placeFiguresNoop,差一格:placeFiguresOff1};'
    + 'return {a:typeof placeFigures==="function",b:typeof placeFiguresNoop==="function",c:typeof placeFiguresOff1==="function"};}'
    + 'catch(e){return {炸了:String(e&&e.message||e)}}})()');
  if (!装了 || !装了.a || !装了.b || !装了.c) {
    console.log('★★ 函数没装进页面：' + JSON.stringify(装了) + ' —— 尺子坏，不算数。');
    process.exit(3);
  }
  console.log('函数已在页面里装好（产品版 + 两个对照臂）  ✓');
  console.log('');

  // ---- ④ 逐份存档量 ----
  //
  // ★★ 量之前先分两类，这是这轮踩出来的（第一版没分，报了 5 份假红）：
  //   模型写变式有**两种排法**——
  //     【A 类·分得开】变式之间**空一行**，marked 把每个标题渲染成**各自一块**；
  //     【B 类·挤一块】标题和答案**行挨着行**（`变式一\n解方程…\n答案：…\n变式二\n…`），
  //       marked 的 breaks:true 把这一整串收进**同一个 <p>**。
  //   挤一块的时候，"把图插在变式二下面"在 DOM 里**没有落脚点**——变式二不是一块，
  //   它只是那一大块文字中间的几个字。这时候"插在某某下面"这件事本身不可做，
  //   不是做法错。硬要做得去切开那个 <p>，是另一件事（风险另算）。
  //   所以尺子分两类量：A 类要求"各就各位"，B 类只要求"一张都不许丢、且排在按钮前面"。
  const 量 = (raw) => ev(`(function(){
    var R = window.SR.render, raw = ${JSON.stringify(raw)};
    var p = R.parseFences(raw, {});
    var vis = String(p.visible || '');
    var n = (p.ggb || []).length;
    var heads = [], m, re = /(^|\\n)[ \\t>*#]*变式[一二三四五六七八九十]+[^\\n]*/g, ends = [], reF = /\`\`\`[ \\t]*ggb[ \\t]*[^\\r\\n]*\\r?\\n[\\s\\S]*?\`\`\`/g;
    while ((m = reF.exec(raw))) ends.push(m.index + m[0].length);
    while ((m = re.exec(raw))) { var s = String(m[0]).replace(/[\\s*>#]+/g,''); if (s) heads.push({at: m.index + String(m[0]).indexOf('变')}); }
    // 原文里，每张图"前面已经有几道变式"—— 这就是它属于第几道题（0 基）
    var 应属 = ends.map(function(e){ var k = 0; for (var h = 0; h < heads.length; h++) if (heads[h].at < e) k++; return k; });

    function 跑(fn) {
      var b = document.createElement('div');
      b.className = 'bubble';
      b.innerHTML = R.md(vis);                       // 跟产品同一条渲染路
      var boxes = [];
      for (var i = 0; i < n; i++) {                   // 摆 n 块占位图（照 attachFigure 的样子）
        var x = document.createElement('div'); x.className = 'figbox'; b.appendChild(x); boxes.push(x);
      }
      var bar = document.createElement('div'); bar.className = 'copybar'; b.appendChild(bar);  // 照 attachCopy
      var moved = fn(b, raw, boxes);
      // 读回来：DOM 顺序里，每张图前面隔着几道"变式"标题；图还在不在；图在 bar 前面吗
      var kids = [].slice.call(b.children), 变式在DOM = [], 图位 = [], bar位 = -1;
      kids.forEach(function(el, i) {
        if (el.classList.contains('figbox')) 图位.push(i);
        else if (el.classList.contains('copybar')) bar位 = i;
        var t = String(el.textContent || '').replace(/[\\s*>#]+/g, '');
        if (/^变式[一二三四五六七八九十]/.test(t)) 变式在DOM.push(i);
      });
      var 隔着 = 图位.map(function(pos){ var c = 0; 变式在DOM.forEach(function(h){ if (h < pos) c++; }); return c; });
      // 快照：把气泡里每个孩子的开头写出来，给人眼看顺序
      var 顺序 = kids.map(function(el){
        if (el.classList.contains('figbox')) return '[图]';
        if (el.classList.contains('copybar')) return '[复制这段]';
        return (String(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 14) || '(空)');
      });
      return {对上了几处: 隔着, moved: moved, 丢图没: n - 图位.length, 图都在bar前: 图位.every(function(p){return bar位 < 0 || p < bar位;}), 顺序: 顺序};
    }
    // 分得开分不开：**摆图之前**，顶级块里有几块是以"变式X"开头的
    var probe = document.createElement('div'); probe.innerHTML = R.md(vis);
    var 顶级变式块 = 0;
    [].slice.call(probe.children).forEach(function(el){
      if (/^变式[一二三四五六七八九十]/.test(String(el.textContent||'').replace(/[\\s*>#]+/g,''))) 顶级变式块++;
    });
    return {围栏数: n, 原文变式数: heads.length, 顶级变式块: 顶级变式块,
            可分开: 顶级变式块 === heads.length && heads.length > 0,
            应属: 应属,
            新: 跑(window.__fig.新), 没插: 跑(window.__fig.没插), 差一格: 跑(window.__fig.差一格)};
  })()`);

  const A = { n: 0, 新绿: 0, 没插绿: 0, 差一格绿: 0, 例子: [], 新红例子: [] };
  const B = { n: 0, 丢图: 0, 图跑bar后面: 0, 例子: [] };
  for (const f of 文件) {
    const raw = fs.readFileSync(path.join(SHOT, f), 'utf8');
    let r;
    try { r = await 量(raw); } catch (e) { console.log('  ★ ' + f + ' 炸了：' + e.message); continue; }
    if (!r.围栏数) continue;                    // 一份图都没有的存档量不到东西
    // 判据只有一条：每张图**前面隔着几道变式**，正好等于它**应属的序号**
    const 判 = (o) => (o.对上了几处.length === r.应属.length && o.对上了几处.every((v, i) => v === r.应属[i]));
    if (r.可分开) {
      A.n++;
      if (判(r.新)) A.新绿++; else A.新红例子.push({ f, 应属: r.应属, 实际: r.新.对上了几处, 顺序: r.新.顺序.slice(0, 12) });
      if (判(r.没插)) A.没插绿++;
      else if (A.例子.length < 3) A.例子.push(f + ' 应属' + JSON.stringify(r.应属) + ' → 没插时' + JSON.stringify(r.没插.对上了几处));
      if (判(r.差一格)) A.差一格绿++;
    } else {
      B.n++;
      if (r.新.丢图没 > 0) B.丢图++;
      if (!r.新.图都在bar前) B.图跑bar后面++;
      if (!r.新.丢图没 && r.新.图都在bar前) continue;
      B.例子.push(f + ' 丢图' + r.新.丢图没 + ' 图在bar后:' + !r.新.图都在bar前);
    }
  }

  console.log('══════ 汇总 ══════');
  console.log('  有图可量的存档：' + (A.n + B.n) + ' 份');
  console.log('');
  console.log('  ── A 类：变式各占一块（图"该钉在哪"有落脚点） ' + A.n + ' 份');
  console.log('     ★ 新做法（数它前面有几道变式）：' + A.新绿 + '/' + A.n + ' 份各就各位');
  console.log('       对照①·没插（改动之前：图全堆在末尾）：' + A.没插绿 + '/' + A.n + '   ← 必须远低于新做法');
  console.log('       对照②·差一格（插在再下一道变式前面）：' + A.差一格绿 + '/' + A.n + '   ← 也得低，否则尺子只认"动没动过"');
  if (A.例子.length) console.log('       没插时错的样子：' + A.例子.join('  ／  '));
  A.新红例子.slice(0, 4).forEach(x => {
    console.log('       ✗ ' + x.f + '  应属' + JSON.stringify(x.应属) + ' 实际' + JSON.stringify(x.实际));
    console.log('          顺序 ' + JSON.stringify(x.顺序));
  });
  console.log('');
  console.log('  ── B 类：变式挤在同一个 <p> 里（"插在变式下面"在 DOM 里没有落脚点） ' + B.n + ' 份');
  console.log('     只要求：一张图都不许丢 + 都排在「复制这段」前面');
  console.log('     丢图的：' + B.丢图 + '   图跑到按钮后面的：' + B.图跑bar后面);
  B.例子.slice(0, 3).forEach(s => console.log('       ✗ ' + s));
  console.log('');

  let bad = 0;
  if (!A.n && !B.n) { console.log('★★ 没有一份存档里有围栏 —— 什么都没量到，不算绿。'); process.exit(3); }
  if (B.丢图) { console.log('★★ B 类里有图被弄丢了。'); bad = 1; }
  if (A.新红例子.length) { console.log('★★ A 类里有 ' + A.新红例子.length + ' 份没对上。'); bad = 1; }
  if (A.n && (A.没插绿 === A.n || A.差一格绿 === A.n)) {
    console.log('★★ 有对照臂在 A 类里也全绿 —— 说明这一版跟它做出来的结果没差别，');
    console.log('   那"新做法"这个改动根本没被这把尺子量到。判尺子坏，不算绿。');
    process.exit(3);
  }
  if (!bad) console.log('===== 钉图通过：A 类 ' + A.新绿 + '/' + A.n + ' 各就各位（没插 ' + A.没插绿 + '/' + A.n + '、差一格 ' + A.差一格绿 + '/' + A.n + '），B 类 ' + B.n + ' 份一张没丢 =====');
  await closeTab(tab.id); ws.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

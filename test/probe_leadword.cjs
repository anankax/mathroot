// 尺子：行首的引词「函数」「直线」，画板到底收不收？
//
// 背景（2026-10-03 跑 test/_sweep6.cjs vary 看见的）：
// 命题工位出「解方程 2x+3=7」的变式，模型回
//     函数 f(x) = 2x + b
//     交点(x轴,f)
// 冻出来是**一张空网格**，状态条写着「2 条画板没认」。老师要看的字。
//
// 根因（test/_q_trans.cjs 九种写法逐条实测出来的）：
// js/board.js 的 translateBare 要求中文命令名**紧跟 `(`/`[`** 才翻，
// 而提示词教模型写的正是「词 + 空格 + 式子」（prompt-vary.js:64-65）。
// 于是 `交点(…)` 翻得掉、`函数 f(x)=…` 一个字不翻，原样喂给只认英文的 GeoGebra。
//
// ★ 这把尺子量的是**板上真的建出东西了没有**（`getAllObjectNames()`），
//   不是"代码里加了条规则"。加了规则而板上还是空的，不算数。
//
// 对照（本文件里，就是唯一那条 ✗）：
//   把**改之前产品实际发出去的那串**（`函数 f(x) = 2x + 1` 原文）直接喂给 applet ——
//   它必须**仍然失败**。它要是成功了，说明这把尺子量到的变化跟这条改动无关。
//   ★ 这叫"一次都不做被怀疑动作的对照"：故障不是我注入的，是**改动之前的那条路**本身。
//
// 用法：node test/probe_leadword.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:8138/index.html';

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面里炸了：' + String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 400));
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable', {}); await send('Runtime.enable', {});
  // ★ 核"改动生效没生效"必须硬重载：同域普通导航会吃缓存，把已生效的写入误判成没生效。
  await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE + '?lw=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
  await sleep(1200);
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.board&&SR.board.applet&&SR.board.applet())').catch(() => false)) break; await sleep(1000); }
  await sleep(1500);

  // 装好"跑一段命令、等板上真的长出来"这件工具。
  await ev('window.__跑=function(lines){'
    + 'var box=document.getElementById("status"); if(box)box.textContent="";'
    + 'var a=SR.board.applet(); try{a.newConstruction();}catch(e){}'
    + 'SR.board.run(lines);'
    + 'var t0=performance.now();'
    + 'return new Promise(function(res){var iv=setInterval(function(){'
    + '  var n=[];try{n=a.getAllObjectNames()||[];}catch(e){}'
    + '  /* 跑够了就收：3.5 秒。★ 这里只能写块注释——整段注入的式子拼成**一行**，'
    + '     写 // 会把它后面到行尾（也就是整个桩）全吃掉，报 SyntaxError: Unexpected end of input。 */'
    + '  if(performance.now()-t0>3500){clearInterval(iv);'
    + '    res({板上:n,状态条:(document.getElementById("status")||{}).textContent||"",'
    + '        花了:Math.round(performance.now()-t0)});}'
    + '},250);});}; 1');

  const 结 = [];
  async function 一试(名, 行) {
    const r = await ev('__跑(' + JSON.stringify(行) + ')');
    结.push({ 名: 名, 行: 行, ...r });
    console.log('──── ' + 名 + ' ────');
    console.log('   发的 = ' + JSON.stringify(行));
    console.log('   板上 = ' + JSON.stringify(r.板上) + '   花了 ' + r.花了 + 'ms');
    console.log('   状态条 = 「' + r.状态条 + '」');
    return r;
  }

  const A = await 一试('甲：命题工位那一串（就是出空网格的那一串，把 b 换成 1）',
    ['#清空', '坐标系', '函数 f(x) = 2x + 1', '交点(x轴,f)']);
  const B = await 一试('乙：直线后面跟式子',
    ['#清空', '坐标系', '直线 y = 2x + 1']);

  // 丙：对照。**改之前产品实际发出去的就是这串原文** —— 必须仍然失败。
  const 丙 = await ev('(function(){var a=SR.board.applet();try{a.newConstruction();}catch(e){}'
    + 'var ok=false; try{ok=a.evalCommand("函数 f(x) = 2x + 1");}catch(e){}'
    + 'var n=[];try{n=a.getAllObjectNames()||[];}catch(e){}'
    + 'return JSON.stringify({收了:ok,板上:n});})()');
  console.log('\n──── 丙【对照】：改之前产品实际发出去的那串原文，直接喂 applet ────');
  console.log('   ' + 丙);

  // 丁：`直线(A,B)` 不许被误删（它带括号，该走 Line 那条老路）
  // ★ 判据量的是**对象类型**，不是名字。第一版写的是 `/line/i.test(名字)`，报了一条假红 ——
  //   GeoGebra 给直线自动起名是 `f`、`g` 这一串字母，**根本没有 `line1` 这个名字**。
  //   线其实建出来了（板上 A、B、f 三个），是尺子认错了人。
  //   （又一次：数字本身没错，错的是它量的那个东西。）
  const 丁 = await ev('(function(){var a=SR.board.applet();try{a.newConstruction();}catch(e){}'
    + 'SR.board.run(["#清空","坐标系","A=(1,1)","B=(3,2)","直线(A,B)"]);'
    + 'return new Promise(function(res){setTimeout(function(){'
    + '  var n=[];try{n=a.getAllObjectNames()||[];}catch(e){}'
    + '  var 型=[];'
    + '  n.forEach(function(k){var t="?";try{t=String(a.getObjectType(k));}catch(e){t="(取不到)";}'
    + '    型.push({名:k,型:t});});'
    + '  res({板上:n,类型:型,'
    + '       有直线:型.some(function(x){return /line/i.test(x.型);}),'
    + '       状态条:(document.getElementById("status")||{}).textContent||""});},3500);});})()');
  console.log('\n──── 丁：直线(A,B)（带括号的，不许被误删）────');
  console.log('   板上 = ' + JSON.stringify(丁.板上));
  console.log('   类型 = ' + JSON.stringify(丁.类型));

  // 戊：引号里的「函数」两个字不许被削
  const 戊 = await ev('(function(){var a=SR.board.applet();try{a.newConstruction();}catch(e){}'
    + 'SR.board.run(["#清空","坐标系","文本(\\"函数图像\\", (2,3))"]);'
    + 'return new Promise(function(res){setTimeout(function(){'
    + '  var n=[];try{n=a.getAllObjectNames()||[];}catch(e){}'
    + '  var txt="";try{ n.forEach(function(k){ if(/^text/i.test(k)) txt=String(a.getValueString? a.getValueString(k):""); }); }catch(e){}'
    + '  res({板上:n,文字:txt});},2500);});})()');
  console.log('\n──── 戊：引号里的「函数」不许被削 ────');
  console.log('   ' + JSON.stringify(戊));

  // ---- 判据 ----
  console.log('\n══ 判定 ══');
  const 条 = [];
  const 板上有函数 = (r) => (r.板上 || []).some(n => n === 'f');
  条.push(['【正主】「函数 f(x)=2x+1」现在建得出来（板上出现 f）', 板上有函数(A), JSON.stringify(A.板上)]);
  条.push(['【正主】「交点(x轴,f)」跟着也建出来了（板上多出一个点）',
    (A.板上 || []).length >= 2, JSON.stringify(A.板上)]);
  条.push(['【正主】状态条不再说「画板没认」', !/没认/.test(A.状态条 || ''), '「' + A.状态条 + '」']);
  条.push(['「直线 y=2x+1」建得出来', (B.板上 || []).length >= 1, JSON.stringify(B.板上)]);
  条.push(['「直线(A,B)」没被误删（它该走 Line 那条老路，板上得真有一根 line）',
    丁.有直线 === true, JSON.stringify(丁.类型)]);
  条.push(['引号里的「函数」两个字没被削',
    (戊.板上 || []).length >= 1, JSON.stringify(戊)]);
  // ★ 对照：改之前那条路必须**仍然失败**。它要是成功了，这尺子量的就不是这一下。
  const 丙o = JSON.parse(丙);
  条.push(['【对照】改之前的原文喂给 applet，仍然失败（板上还是空的）',
    丙o.收了 === false && (丙o.板上 || []).length === 0, JSON.stringify(丙o)]);

  let 红 = 0;
  for (const [名, ok, 值] of 条) { if (!ok) 红++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + '   【' + 值 + '】'); }
  console.log('\n' + (红 ? '★ 红了 ' + 红 + ' 条' : '★ 全绿：行首的「函数」「直线」不再是空网格'));
  await closeTab(t.id); ws.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

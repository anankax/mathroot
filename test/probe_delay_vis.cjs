// 尺子：板「在屏幕上」和「不在屏幕上」，发命令的节奏**真的一样吗**？
//
// 背景（test/_q_boardvis.cjs 量的前提）：新布局把画板收进了抽屉，抽屉一关，
// `#ggb canvas` 左边界 1475 > 视口 1440 ——整块板在屏幕外，老师一个像素都看不见。
// 可板还是每 550ms 发一条命令（"图一点点长出来"是给老师看的），
// 白等 3.3 秒；冻图那条路再借板重画一遍、又等一遍。实测收流后还要 6.2 秒图才出来。
//
// 改法（js/board.js 的 `onScreen()`）：看得见才慢慢长，看不见就一口气画完。
//
// ★ 这把尺子**不读代码的自述**。它把 applet 的 `evalCommand` 包一层记账，
//   量的是**每条命令真正落地的时刻**——产品自己说"我快了"不算数，命令得真的快。
//   另外并排量一遍 DOM（探针里另写一个同口径的实现），
//   两把尺子对不上就报错，而不是"以代码为准"。
//
// ★ 判"看不看得见"量 `getClientRects()` + 包围盒越没越过视口边界，
//   **绝不读 `getComputedStyle().display`**——藏起来的是它的**爹**（抽屉）。
//   两态下 `getClientRects().length` 都是 1，只有包围盒分得开。
//
// 红验就在同一个文件里，跑两态对照：关态必须**快**、开态必须**慢**。
// 两态一样 → 尺子没起作用（不是"合格"）。
//
// 用法：node test/probe_delay_vis.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:8138/index.html';

// 6 条命令 → 5 个间隔。看得见：5×550=2750ms；看不见：5×30=150ms。差一个数量级。
const 命令 = ['#清空', 'A=(0,0)', 'B=(1,0)', 'C=(2,0)', 'D=(3,0)', 'E=(4,0)'];

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
  await send('Network.setCacheDisabled', { cacheDisabled: true });   // ★ 核"改动生效没生效"必须硬重载
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE + '?dv=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
  await sleep(1200);
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.board&&SR.board.applet&&SR.board.applet())').catch(() => false)) break; await sleep(1000); }
  await sleep(1500);

  // ---- 页面里两把量具 ----
  // ① DOM 尺子（探针自己实现一遍，不调产品的 onScreen）
  await ev('window.__尺=function(){'
    + 'function r(el){if(!el)return{无:true};var rc=el.getClientRects().length;var b=el.getBoundingClientRect();'
    + 'return{rects:rc,宽:Math.round(b.width),高:Math.round(b.height),左:Math.round(b.left),右:Math.round(b.right),'
    + '在视口里:b.width>0&&b.height>0&&b.right>0&&b.left<innerWidth&&b.bottom>0&&b.top<innerHeight};}'
    + 'var d=document.getElementById("drawer");'
    + 'return{抽屉:d?d.getAttribute("data-drawer"):"(没有)",'
    + 'ggb:r(document.getElementById("ggb")),canvas:r(document.querySelector("#ggb canvas")),'
    + '代码说:!!SR.board.onScreen(),视口:innerWidth+"x"+innerHeight};}; 1');

  // ② 命令落地记账：把 evalCommand 包一层。**先断言包成功了**，包不上就不许下结论。
  const 包上 = await ev('(function(){'
    + 'var a=SR.board.applet();'
    + 'if(!a||typeof a.evalCommand!=="function")return{ok:false,why:"applet 没有 evalCommand"};'
    + 'if(window.__包过)return{ok:true,已包过:true};'
    + 'var orig=a.evalCommand; window.__t=[];'
    + 'var f=function(c){window.__t.push({c:String(c),t:performance.now()});return orig.apply(a,arguments);};'
    + 'a.evalCommand=f; window.__包过=(a.evalCommand===f);'
    + 'return{ok:window.__包过,why:window.__包过?"":"evalCommand 不可写"};})()');
  console.log('命令记账桩：' + JSON.stringify(包上));
  if (!包上 || !包上.ok) { console.log('★ 桩没装上 —— 量的是真 applet 那一轮，读数不算，停。'); await closeTab(t.id); ws.close(); process.exit(3); }

  // ③ 量一轮节奏：跑命令，量到第 5 个点出现为止
  await ev('window.__量=function(lines){'
    + 'var a=SR.board.applet(),t0=performance.now();window.__t=[];'
    + 'SR.board.run(lines);'
    + 'return new Promise(function(res){var 期望=lines.length-1;'
    + 'var iv=setInterval(function(){'
    + 'var k=0;try{k=(a.getAllObjectNames()||[]).length;}catch(e){}'
    + 'if(k>=期望||performance.now()-t0>9000){clearInterval(iv);'
    + 'var ts=window.__t.map(function(x){return Math.round(x.t-t0);});'
    + 'var g=[];for(var i=1;i<ts.length;i++)g.push(ts[i]-ts[i-1]);'
    + 'res({总耗时:Math.round(performance.now()-t0),点数:k,发出条数:ts.length,命令时刻:ts,间隔:g,'
    + '平均间隔:g.length?Math.round(g.reduce(function(p,c){return p+c;},0)/g.length):null});}'
    + '},25);});}; 1');

  async function 一轮(标签) {
    const 尺 = await ev('JSON.stringify(__尺())');
    const o = JSON.parse(尺);
    // 两把尺子对账
    const 一致 = (o.ggb && o.ggb.在视口里) === o.代码说;
    console.log('\n──── ' + 标签 + ' ────');
    console.log('  抽屉=' + o.抽屉 + '  ggb: rects=' + o.ggb.rects + ' 左=' + o.ggb.左 + ' 右=' + o.ggb.右 + '  在视口里=' + o.ggb.在视口里);
    console.log('  两把尺子一致=' + 一致 + '（DOM 量到 ' + o.ggb.在视口里 + '，SR.board.onScreen() 说 ' + o.代码说 + '）');
    const r = await ev('__量(' + JSON.stringify(命令) + ')');
    console.log('  命令时刻=' + JSON.stringify(r.命令时刻));
    console.log('  每条间隔=' + JSON.stringify(r.间隔) + '  平均=' + r.平均间隔 + 'ms');
    console.log('  整批画完=' + r.总耗时 + 'ms（' + r.点数 + ' 个点，记账 ' + r.发出条数 + ' 条）');
    return { 尺: o, 一致: 一致, 量: r, 在视口里: o.ggb.在视口里 };
  }

  const 关 = await 一轮('场景一：抽屉关着（老师刚打开网页时的默认态）');

  await ev('(function(){if(SR.main&&SR.main.openDrawer)SR.main.openDrawer();return 1})()');
  await sleep(900);   // 等那 0.22s 的滑出动画走完
  const 开 = await 一轮('场景二：抽屉拉开（老师正盯着画板）');

  // 场景三：抽屉**开着**的时候借板干活（就是冻图那条路）。
  //   这一遍画不是给老师看的，是给自己截图用的 → 必须也走快档。
  //   不这么做的话，板明明摊在老师眼前，他会看着**同一张图被慢慢画第二遍**：
  //   先看当场那遍（该看的），再看冻图那遍（白等，实测 2.9 秒）。
  const 借 = await ev('(function(){'
    + 'var t0=performance.now();window.__t=[];'
    + 'return new Promise(function(res){'
    + 'SR.board.offscreenJob(function(draw,finish){draw(' + JSON.stringify(命令) + ',finish);},function(r){'
    + 'var ts=window.__t.map(function(x){return Math.round(x.t-t0);});'
    + 'var g=[];for(var i=1;i<ts.length;i++)g.push(ts[i]-ts[i-1]);'
    + 'res({在视口里:!!SR.board.onScreen(),每条间隔:g,'
    + '平均:g.length?Math.round(g.reduce(function(p,c){return p+c;},0)/g.length):null,'
    + 'ok:r.ok,back:r.back,总耗时:Math.round(performance.now()-t0),发出条数:ts.length});});});})()');
  console.log('\n──── 场景三：抽屉开着 + 借板干活（冻图那条路）────');
  console.log('  板在视口里=' + 借.在视口里 + '（这一幕就是"老师看得见"）');
  console.log('  每条间隔=' + JSON.stringify(借.每条间隔) + '  平均=' + 借.平均 + 'ms');
  console.log('  整批=' + 借.总耗时 + 'ms  ok=' + 借.ok + ' back=' + 借.back + ' 记账=' + 借.发出条数 + ' 条');

  await ev('(function(){if(SR.main&&SR.main.closeDrawer)SR.main.closeDrawer();return 1})()');
  await sleep(900);
  const 再关 = await 一轮('场景四：再关上（回到默认态）');

  // ---- 判据 ----
  console.log('\n══ 判定 ══');
  const 条 = [];
  const 快 = 关.量.平均间隔, 慢 = 开.量.平均间隔, 再快 = 再关.量.平均间隔;
  const 灰区 = v => v >= 200 && v <= 400;
  条.push(['关着时必须快（<150ms）', 快 != null && 快 < 150, 快 + 'ms']);
  条.push(['拉开时必须慢（≈550ms）', 慢 != null && 慢 >= 450 && 慢 <= 650, 慢 + 'ms']);
  条.push(['再关上又变快（可逆）', 再快 != null && 再快 < 150, 再快 + 'ms']);
  条.push(['关着比拉开至少快 3 倍', (快 != null && 慢 != null) && 慢 / Math.max(快, 1) >= 3, '慢/快=' + (慢 && 快 ? (慢 / Math.max(快, 1)).toFixed(1) : '?') ]);
  条.push(['两把尺子两态都对得上', 关.一致 && 开.一致 && 再关.一致, '关=' + 关.一致 + ' 开=' + 开.一致 + ' 再关=' + 再关.一致]);
  条.push(['关态 ggb 确实在视口外', 关.在视口里 === false && 再关.在视口里 === false, '关=' + 关.在视口里 + ' 再关=' + 再关.在视口里]);
  条.push(['开态 ggb 确实在视口内', 开.在视口里 === true, String(开.在视口里)]);
  条.push(['两态隔开得干净（不在 200-400 灰区）', !灰区(快) && !灰区(慢) && !灰区(再快), 快 + '/' + 慢 + '/' + 再快]);
  // ★ 借板那条是最容易漏的一格：板**看得见**、可这一遍不是画给人看的。
  //   它要是跟着"看得见"那一档慢下来，老师就得多看一张图被画第二遍。
  条.push(['借板干活时，哪怕板看得见也走快档（<150ms）',
    借.在视口里 === true && 借.平均 != null && 借.平均 < 150, 借.平均 + 'ms（板在视口里=' + 借.在视口里 + '）']);
  条.push(['借板干完把板原样还回来了（back=true 且 ok=true）',
    借.ok === true && 借.back === true, 'ok=' + 借.ok + ' back=' + 借.back]);
   // ★ 这里**必须是 5，不是 6**。`#清空` 被 expand 成 `__NEW__`，在 `exec` 里走的是
  //   `api.newConstruction()` 那条早退分支，**根本不经过 `evalCommand`**，
  //   所以记账里永远看不到它。（第一版这把尺子写的就是 6，于是报了一条
  //   「一条命令丢了」的假红——数字没错，是它量的那个东西不是"发出去几条"。）
  //   量到的 5 条＝后面那 5 个点，正是我们要判节奏的那 5 个间隔。
  const 期望记账 = 5;
  条.push(['5 条点命令一条不少地发出去了（`#清空` 不走 evalCommand，见上）',
    关.量.发出条数 === 期望记账 && 开.量.发出条数 === 期望记账 && 再关.量.发出条数 === 期望记账,
    关.量.发出条数 + '/' + 开.量.发出条数 + '/' + 再关.量.发出条数 + '（期望 ' + 期望记账 + '）']);

  let 红 = 0;
  for (const [名, ok, 值] of 条) { if (!ok) 红++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + '   【' + 值 + '】'); }
  console.log('\n' + (红 ? '★ 红了 ' + 红 + ' 条' : '★ 全绿：板看不见时就真的不慢慢长了'));

  await closeTab(t.id); ws.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

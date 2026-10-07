// 持续用：2026-10-04 第三轮的三道修复 —— `正方形`补参、`备用写法`换语序、新加的那批中文名。
//
// ★ 为什么每一道都配一条**红验**（"不该被动的必须一动不动"）：
//   这三道全是"改写用户/模型写的式子"的活。改错了**不会报错**——式子还在、命令还跑、
//   只是画出来是另一个东西。绿的样子跟尺子坏了长得一模一样。
//   尤其 `备用写法`：它跑在"原样已经失败之后"，所以**只有在原样失败时才该出现**。
//   要是哪天判据翻过来（先试备用），`Line(P, c)` 会被 swap 成 `Line(c, P)` ——
//   把**本来是对的**改坏。这一条必须有人盯着。
//
// 判据照旧：不看报不报错，看**板上真建出了什么**。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200));
    return R && R.result ? R.result.value : null
  };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 40; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});

  let 坏 = 0;
  const 试 = async (标, 行, 看, 该在, 该类型) => {
    await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(250);
    await q('window.__行=' + JSON.stringify(行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let i = 0; i < 20; i++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(320);
    const 没 = await q('SR.board.failed()') || [];
    const 名 = await q('(function(){try{var a=ggbApplet.getAllObjectNames(),o={};for(var i=0;i<a.length;i++){o[a[i]]=ggbApplet.getObjectType(a[i])+(ggbApplet.isDefined(a[i])?"":"(空壳)")}return o}catch(e){return {炸:String(e)}}})()') || {};
    const 有 = Object.prototype.hasOwnProperty.call(名, 看);
    const 型 = 有 ? 名[看] : null;
    // ⚠ 类型可以是**一串**：`Polygon(A,B,4)`（正四边形）板子报 `polygon`，
    //   而 `Polygon(A,B,C,D)`（四顶点）报的是 `quadrilateral` —— 同一个命令、两种报法。
    //   ★ 第一版我把这俩当成一种了，于是"四顶点不补参"那条**假红**了一次。
    //     假红比假绿好些，但它照样会让人去改**本来就对**的实现，所以照样算错。
    const 型s = !该类型 ? [] : (Array.isArray(该类型) ? 该类型 : [该类型]);
    const 型对 = !型s.length || 型s.some(x => String(型).indexOf(x) === 0);
    const 对 = (有 === 该在) && (该在 === false || 型对);
    if (!对) 坏++;
    console.log('  ' + (对 ? '✓' : '✗') + '  ' + 标);
    console.log('      要找「' + 看 + '」→ ' + (有 ? '在（' + 型 + '）' : '不在') + '（该' + (该在 ? '在' : '不在') + (该类型 ? '、类型 ' + 该类型 : '') + '）');
    console.log('      板上 ' + JSON.stringify(名) + (没.length ? '\n      没认 ' + JSON.stringify(没) : ''));
  };

  console.log('══ 甲、正方形补参：`正方形(A,B)` 该变成 `Polygon(A,B,4)` ══');
  await 试('两个顶点 → 补上 ,4', ['#清空', 'A=(0,0)', 'B=(2,0)', 's=正方形(A,B)'], 's', true, 'polygon');
  // ★ 红验：四个顶点给全的**不许补**（多补一个 ,4 会整条废掉）
  await 试('★红验：四个顶点给全 → **不补**', ['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(2,2)', 'D=(0,2)', 's=正方形(A,B,C,D)'], 's', true, ['quadrilateral', 'polygon']);
  // ★ 坐标元组那两个也要接住。★ 为什么非接不可：不接的话它会掉进 translateBare 变成
  //   `Polygon((0,0),(2,0))` —— **那个也"成功"**，建出来却是个两条边的退化多边形。
  //   "成了、但成了个不是正方形的东西"比失败还难发现。红验就钉这一点：不许是 2 个顶点的。
  await 试('坐标元组 → 也要补上 ,4（不许变成退化多边形）',
    ['#清空', 's=正方形((0,0),(2,0))', 'g=多边形((0,0),(2,0))'], 's', true, 'polygon');
  // ⚠ 第一版这条我写得不对：我写 `s=正方形((0,0),(2,0),(3,3))` 然后断言"s 不在"，
  //   可它**在**——板子建出一个 `triangle`。这**完全是该有的行为**：
  //   修正方形（两参）没碰它 ✓，translateBare 把名字换成 `Polygon` ✓，
  //   三个点本来就是三角形 ✓。屏幕上那个三角形，正是模型那句话要的东西。
  //   ★ 要验的是"补参那一支**没**插手"，而这**在板子上量不出来**（三角形和"补错参的四边形"
  //     是两样东西，可我只写了一条断言）。原子的断言是**字符串级**的，见 probe_square_unit.cjs。
  //   这条留在板子上，改成如实记录它到底建出了什么。
  await 试('三个点 → 该是个三角形（补参那一支不许插手）',
    ['#清空', 's=正方形((0,0),(2,0),(3,3))'], 's', true, 'triangle');

  console.log('\n══ 乙、备用写法：语序反了才救，本来就对的**一动不动** ══');
  await 试('平行线(点, 线) 本来就对 → 不该被换', ['#清空', 'A=(0,0)', 'B=(2,0)', 'c=线段(A,B)', 'P=(1,3)', 'l=平行线(P,c)'], 'l', true, 'line');
  await 试('★平行线(线, 点) 语序反了 → 该救回来', ['#清空', 'A=(0,0)', 'B=(2,0)', 'c=线段(A,B)', 'P=(1,3)', 'l=平行线(c,P)'], 'l', true, 'line');
  await 试('垂线(点, 线) 本来就对', ['#清空', 'A=(0,0)', 'B=(2,0)', 'c=线段(A,B)', 'P=(1,3)', 'l=垂线(P,c)'], 'l', true, 'line');
  await 试('★垂线(线, 点) 语序反了 → 该救回来', ['#清空', 'A=(0,0)', 'B=(2,0)', 'c=线段(A,B)', 'P=(1,3)', 'l=垂线(c,P)'], 'l', true, 'line');
  // ★ 红验：**不该救的别乱救** —— 两个圆换语序也是错的，救不活，就该老实报"没认"
  await 试('★红验：两个圆的语序反了 → 救不了，该老实没认', ['#清空', 'O=(0,0)', 'A=(2,0)', 'B=(3,0)', 'z=交点(A,O,1)'], 'z', false);

  console.log('\n══ 丙、新加的中文名：模型写课本词，画板该收得下 ══');
  await 试('中位数(数据)', ['#清空', 'L={1,2,2,3,5,9}', 'm=中位数(L)'], 'm', true, 'numeric');
  await 试('平均数(数据)', ['#清空', 'L={1,2,2,3,5,9}', 'm=平均数(L)'], 'm', true, 'numeric');
  await 试('下四分位数(数据)', ['#清空', 'L={1,2,3,4,5,6,7,8}', 'm=下四分位数(L)'], 'm', true, 'numeric');
  // ⚠ 第一版这条我写成"不找名字"，可板子会给没起名的对象**自动起名**（`f`），
  //   于是"找到了 → 判我错"。★ 名字得自己给：`q=折线(...)`。
  await 试('折线({(1,1),(2,3),(3,2)}) —— 折线统计图唯一画得出来的一条路',
    ['#清空', 'q=折线({(1,1),(2,3),(3,2)})'], 'q', true, 'polyline');
  await 试('★展开图(正方体, 1) —— 两参形式', ['#清空', '#三维', 'A=(0,0,0)', 'B=(2,0,0)', 'c=正方体(A,B)', '展开图(c, 1)'], 'n1', false);

  console.log('\n' + (坏 ? '✗ 有 ' + 坏 + ' 条不对' : '✅ 全过（含 ' + 4 + ' 条红验）'));
  ws.close(); await put('/json/close/' + t.id);
  process.exit(坏 ? 4 : 0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

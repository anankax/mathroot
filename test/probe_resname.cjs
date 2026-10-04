// 持续用：**x／y／z 当对象名**时，画板会自作主张改名 —— 产品有没有把这个读对。
//
// ★ 这一条的来龙去脉（为什么非得留一把尺子）：
//   `y=2x+1` 是一条**合法的**式子，板子收得下，可它建出来的东西**不叫 y，叫 f**
//   （x/y/z 是坐标轴自己的名字）。`试一次` 那一版按"名字在不在"判，
//   于是判成"没认" → 状态条报一句假话 ＋ 补过照着又画一遍 ＝ **两条重叠的线**。
//   量出来的读数长这样：`["f:line","g:line"]` —— 看着像"画了两条"，其实是"同一条画了两次"。
//   ★★ 所以这一道的主断言不是"命令成没成"，是 **恰好一条**。
//     见 [[scanner-numbers-are-not-what-they-claim]]：「成了、可成了两份」跟"没成"是两码事。
//
// ⚠ 判据挑**会变的那个量**：不看报不报错，数次线（type === 'line'）的**条数**。
//   而"条数"这把尺子自己也得能分辨 1 和 2 —— 见乙那条红验。
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
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200));
    return R && R.result ? R.result.value : null
  };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 40; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});

  let 坏 = 0;
  // 一把尺子：走产品自己的 draw()，把"没认"和"板上每一件"都端出来
  const 量 = async (行) => {
    await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(280);
    await q('window.__行=' + JSON.stringify(行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let i = 0; i < 20; i++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(340);
    const 没 = await q('SR.board.failed()') || [];
    const 名 = await q('(function(){try{var a=ggbApplet.getAllObjectNames(),o=[];for(var i=0;i<a.length;i++){var n=a[i];o.push(n+":"+ggbApplet.getObjectType(n)+(ggbApplet.isDefined(n)?"":"★空壳"))}return o}catch(e){return["炸"]}})()') || [];
    const 数 = k => 名.filter(s => s.split(':')[1] === k).length;
    return { 没, 名, 数 };
  };
  const 该 = (标, 对, 补 = '') => { if (!对) 坏++; console.log('  ' + (对 ? '✓' : '✗') + '  ' + 标 + (补 ? '   ' + 补 : '')) };

  console.log('══ 甲、`y=2x+1`：合法式子，板子改名成 f —— 该画出来、且**只画一条** ══');
  {
    const r = await 量(['#清空', 'y=2x+1']);
    console.log('      板上 ' + JSON.stringify(r.名));
    该('`y=2x+1` 不报没认（上一版这里会报假话）', r.没.length === 0, r.没.length ? '没认 ' + JSON.stringify(r.没) : '');
    该('线**恰好 1 条**（不是 2 —— 2 就是被补过画了两遍）', r.数('line') === 1, '数到 ' + r.数('line') + ' 条');
  }

  console.log('\n══ 乙、★红验：这把"数条数"的尺子自己得能分辨 1 和 2 ══');
  {
    // ★ 为什么要这一节：甲那条断言"恰好 1"，而**我是照着 1 去写的**。
    //   万一 数('line') 永远返回 0 或 1（比如类型名压根不叫 line），甲会照样绿——
    //   绿的样子跟尺子坏了长得一模一样。这里当场喂给它两条线，看它读不读得出 2。
    // ⚠ 第一版我喂的是 `k=线((0,0),(1,1))` —— 板上一件没多（`线` 这个名字不在 CMD_MAP 里，
    //   这条"反例"自己都没落地），于是它不但没验成尺子，还差点被当成"实现坏了"。
    //   ★ 反例必须是一条**板上真认的**写法，否则它证明的是"喂的东西不行"，不是"尺子能分辨"。
    const r = await 量(['#清空', 'A=(0,0)', 'B=(1,1)', 'y=2x+1', 'k=Line(A,B)']);
    console.log('      板上 ' + JSON.stringify(r.名));
    该('两条线 → 该数到 2', r.数('line') === 2, '数到 ' + r.数('line') + ' 条');
  }

  console.log('\n══ 丙、`x=3` 竖直线 / 丁、`z=2` 3D 水平面 ══');
  {
    const r = await 量(['#清空', 'x=3']);
    console.log('      [x=3] 板上 ' + JSON.stringify(r.名));
    该('`x=3` 不报没认', r.没.length === 0, r.没.length ? '没认 ' + JSON.stringify(r.没) : '');
    该('`x=3` 线恰好 1 条', r.数('line') === 1, '数到 ' + r.数('line') + ' 条');
    const r2 = await 量(['#清空', '#三维', 'z=2']);
    console.log('      [z=2] 板上 ' + JSON.stringify(r2.名));
    该('`z=2` 不报没认', r2.没.length === 0, r2.没.length ? '没认 ' + JSON.stringify(r2.没) : '');
    该('`z=2` 面恰好 1 张', r2.数('plane') === 1, '数到 ' + r2.数('plane') + ' 张');
  }

  console.log('\n══ 戊、对照：老写法一点没变 ══');
  {
    const r = await 量(['#清空', 'A=(0,0)', 'B=(2,0)', 'g=线段(A,B)']);
    该('`A=(0,0)` + 线段 照旧，无没认', r.没.length === 0 && r.数('point') === 2 && r.数('segment') === 1,
      JSON.stringify(r.名));
  }

  console.log('\n══ 己、★红验：真失败的**还得报**（新分支不许把闸门放宽）══');
  {
    const r = await 量(['#清空', 'Q=不存在的命令X(A,B)']);
    console.log('      板上 ' + JSON.stringify(r.名));
    该('认不出的命令 → 照样进"没认"', r.没.length === 1, JSON.stringify(r.没));
    该('且板上一件不多', r.名.length === 0, JSON.stringify(r.名));
  }

  console.log('\n══ 庚、★红验：`x=圆(A,B)` 那种 —— 圆该**恰好 1 个**，不许被画两遍 ══');
  {
    const r = await 量(['#清空', 'A=(0,0)', 'B=(2,0)', 'x=圆(A,B)']);
    console.log('      板上 ' + JSON.stringify(r.名));
    该('圆恰好 1 个', r.数('circle') === 1, '数到 ' + r.数('circle') + ' 个');
  }

  console.log('\n' + (坏 ? '✗ 有 ' + 坏 + ' 条不对' : '✅ 全过（含 2 条红验）'));
  ws.close(); await put('/json/close/' + t.id);
  process.exit(坏 ? 4 : 0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

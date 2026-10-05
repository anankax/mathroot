// 验 `修正角度顺序`（js/board.js）这把修尺。
//
// ★★ 它治的是实测出来的病（test/_angle_why.cjs 三格）：
//     `角(A,B,C)` 中间那个字母才是顶点，而且 A→B→C 的**绕行方向**反了，
//     引擎给的是 360 减掉要的那个角（实测 302.01°）。
//     两样都是**字母位置**的事，跟模型会不会数学无关。
//
// ★★ 判据钉死成"板上那个 α 到底多少度"＋"它最后建出来的命令原文长什么样"，
//    不许用一句"看着像角"糊过去。**读命令原文这一条是关键**：
//     光看 α 是 60° 分不清是"我改对了"还是"模型本来写对了"。
//
// ★★ 后两条是**反例**，专门证明它**不该改的时候一个字都没改**——
//    没有射线证据（三角形上标内角）那条路必须原样放行。
//    这一条是给自己上的闸：一把"什么都敢改"的修尺，比不改更危险
//     （改出一个**看着挺对的锐角、顶点却在别的点上**，老师会当成对的用下去）。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 值) => { if (真) { 绿++; console.log('  OK  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } else { 红++; console.log('  XX  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } };
const 近 = (a, b, 容) => Math.abs(a - b) <= (容 === undefined ? 1.5 : 容);

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 250));
    return R && R.result ? R.result.value : null };
  const 等真 = async (式, 秒, 步) => { const n = Math.round(秒 * 1000 / (步 || 400)); for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 400); await sleep(步 || 400) } return -1 };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=anglefix&t=' + Date.now() });
  const 起 = await 等真('!!(window.SR && SR.board && SR.board.isReady() === true)', 150, 500);
  console.log('等画板就绪 ' + 起 + 'ms');
  if (起 < 0) { console.log('★ 画板没起来，本次一个读数都不作数'); ws.close(); process.exit(3) }
  await sleep(3000);

  // 板上那个角对象：名字、度数、**以及它最终建出来时的命令原文**
  const 读角 = `(function(){ var a = SR.board.applet(); if(!a) return null;
    var 出 = [];
    (a.getAllObjectNames()||[]).forEach(function(n){
      var ty=''; try{ty=a.getObjectType(n)}catch(e){}
      if (String(ty).indexOf('angle') !== 0) return;
      var v=''; try{ v = a.getValueString(n) }catch(e){ v='?' }
      var cs=''; try{ cs = a.getCommandString(n) }catch(e){ cs='?' }
      // ★★ 度数**只能从显示串上取**（就是 getValueString 那串「α = 60.02°」）。
      //   头一版我读的是 getValue(n) —— 那对 Angle 返回的是**弧度**（60.02° = 1.047），
      //   我却当度数用了，于是六条红里三条报"度数 1.05"。
      //   老账：读数没错，错的是它量的那个东西。
      var d = NaN, mm = /(-?[\\d.]+)\\s*°/.exec(String(v));
      if (mm) d = parseFloat(mm[1]);
      出.push({ 名:n, 度数:Math.round(d*100)/100, 显示:v, 命令:cs }) });
    return 出 })()`;
  // 板上所有的射线（反例那两条要证明"确实没有射线"）
  const 读射线 = `(function(){ var a = SR.board.applet(); var o=[];
    (a.getAllObjectNames()||[]).forEach(function(n){ var ty=''; try{ty=a.getObjectType(n)}catch(e){}
      if (ty==='ray') o.push(n) });
    return o })()`;

  // 命令原文里那三个字母，去掉命令名和空格只留 `X,Y,Z`。
  // ★★ 为什么不能直接比对命令原文：我头一版猜它长 `Angle(A,O,B)`，
  //   实测是 **`角度(A, O, B)`** —— 本地化的名字**加空格**。
  //   拿猜的格式去比，绿的那一格也会报红。要比的是**语义**（哪三个字母、什么顺序），
  //   不是它用什么名字、打几个空格写出来的。
  const 角参 = s => { const m = /\(([^)]*)\)/.exec(String(s || '')); return m ? m[1].split(',').map(function (x) { return x.trim() }).join(',') : String(s) };

  const 一例 = async (标题, 命令, 期望) => {
    console.log('\n──── ' + 标题 + ' ────');
    console.log('   喂进去：' + JSON.stringify(命令));
    await q('SR.board.run(' + JSON.stringify(命令) + ')');
    await sleep(3200);
    const 角 = await q(读角), 射线 = await q(读射线);
    console.log('   板上射线：' + (射线.length ? 射线.join('、') : '（一条都没有）'));
    角.forEach(x => console.log('   角 ' + x.名 + ' = ' + x.显示 + '   ← 建出来的命令是 ' + x.命令));
    if (!角.length) { 判(标题 + '：建出了角', false, '一个角对象都没有'); return null }
    const g = 角[0];
    const 参 = 角参(g.命令);
    if (期望.度数 !== undefined) 判(标题 + '：度数 ' + 期望.度数 + '°（±1.5）', 近(g.度数, 期望.度数), g.度数);
    if (期望.顶点) 判(标题 + '：三个字母里**中间那个**是顶点 ' + 期望.顶点, 参.split(',')[1] === 期望.顶点, 参);
    if (期望.参 !== undefined) 判(标题 + '：三个字母的顺序是 ' + 期望.参, 参 === 期望.参, 参);
    return g;
  };

  // ★★ ① 同时是**红验**：修尺要是不在（或没生效），它建的会是 `角(O,A,B)` → α = 302.01°，
  //    这一条当场报红。也就是说"这条绿"不是恒绿，是真的量到了那把修尺在干活。
  //    （老账：绿的样子也跟尺子坏了长得一样 —— 所以每把新尺子都得先证明它在坏东西上红过。）
  console.log('\n══ 前两条：该改的必须改对 ══');
  // ① 顶点写到第一个字母上（实测遍2 的原样）。两条射线都从 O 出发 ⇒ 顶点只能是 O。
  await 一例('① 顶点写错位',
    ['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(1.5,2.6)', '射线(O,A)', '射线(O,B)', '角(O,A,B)'],
    { 度数: 60.02, 顶点: 'O' });

  // ② 顶点对、两个边点绕反了（实测遍3 的原样，字母换成 O/A/B 便于比对）
  await 一例('② 绕行方向反了',
    ['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(1.5,2.6)', '射线(O,A)', '射线(O,B)', '角(B,O,A)'],
    { 度数: 60.02, 顶点: 'O' });

  // ③ 对照：本来就对的，**一个字都不许动**
  await 一例('③ [对照] 本来就对',
    ['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(1.5,2.6)', '射线(O,A)', '射线(O,B)', '角(A,O,B)'],
    { 度数: 60.02, 参: 'A,O,B' });

  console.log('\n══ 后两条：三角形那条路（板上一条射线都没有）══');
  // ④ 三角形上标内角 —— 这一格里**没有射线可当证据**，顶点按"中间那个字母"认。
  //    ★★ 这一条同时是**红验**：老代码（顶点只认射线证据）在这一格上不改一个字，
  //       建出来的是 `角度(A, B, C)` = **311.19°**（优角，三段弧绕在三角形外头画整圈），
  //       不是下面要的 48.8° —— 实测数字来自 test/_lab_triarc.cjs，那是**改之前**量的。
  //       所以这条绿不是恒绿：修尺一撤它当场红。
  //    ★ 字母序照**课本**写（A,B,C 按多边形顺序），正是模型最容易照抄的那一种。
  const g4 = await 一例('④ 没有射线证据：三角形内角按课本字母序写',
    ['#清空', 'A=(0,0)', 'B=(3,0)', 'C=(0.9,2.4)', '三角形(A,B,C)', '角(A,B,C)'],
    { 度数: 48.8, 顶点: 'B' });
  判('④ 这一例确实**一条射线都没有**（有射线的话它就不是"没有证据"那一格了）',
    (await q(读射线)).length === 0);
  if (g4) 判('④ 优角被翻成劣角：命令从 `A,B,C` 改成 `C,B,A`（只换方向，顶点 B 没动）',
    角参(g4.命令) === 'C,B,A', 角参(g4.命令));

  // ④b [对照] 本来就吐劣角的那一张，**一个字节都不许动**。
  //     没有这一格，上面 ④ 那条绿就可能是"一把什么都敢翻的修尺"糊出来的。
  const g4b = await 一例('④b [对照] 同样是三角形、没有射线，但本来就是对的那个角',
    ['#清空', 'A=(0,0)', 'B=(3,0)', 'C=(1.5,2.6)', '多边形(A,B,C)', '角(A,C,B)'],
    { 顶点: 'C' });
  if (g4b) {
    判('④b 三个字母原样放行（`A,C,B` 一个字没改）', 角参(g4b.命令) === 'A,C,B', 角参(g4b.命令));
    判('④b 度数仍是劣角（没被多此一举地翻过去）', g4b.度数 > 0 && g4b.度数 < 180, g4b.度数);
  }

  // ⑤ [反例] 增量作图：射线是**上一批**画的，这一批只来一条角。
  //    板上那条射线得能被算进证据 —— 这正是"在已画的图上继续加要素"那一路。
  console.log('\n──── ⑤ [增量] 射线是上一批画的，这一批只来一条角 ────');
  await q('SR.board.run(' + JSON.stringify(['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(1.5,2.6)', '射线(O,A)', '射线(O,B)']) + ')');
  await sleep(2600);
  console.log('   第一批之后板上射线：' + JSON.stringify(await q(读射线)));
  await q('SR.board.run(' + JSON.stringify(['角(O,A,B)']) + ')');
  await sleep(2600);
  const g5 = (await q(读角))[0];
  if (g5) { console.log('   角 ' + g5.名 + ' = ' + g5.显示 + '   ← ' + g5.命令);
    判('⑤ 板上已有的射线被算作证据，顶点归位到 O', 近(g5.度数, 60.02) && 角参(g5.命令) === 'A,O,B', { 度: g5.度数, 参: 角参(g5.命令) }) }
  else 判('⑤ 建出了角', false, '没有角对象');

  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r && r.result && r.result.data) { fs.mkdirSync(path.join('test', '_shots'), { recursive: true });
    fs.writeFileSync(path.join('test', '_shots', '_角修正.png'), Buffer.from(r.result.data, 'base64')) }
  console.log('\n──────── 绿 ' + 绿 + ' / 红 ' + 红 + ' ────────');
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });

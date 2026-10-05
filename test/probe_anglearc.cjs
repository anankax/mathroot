// 量"角弧有没有放大到该有的那个数"（产品里那一句：js/board.js 的 `角弧放大`）。
//
// ★★ 起因：孔老师那张图上的「α=60.02°」和顶点字母 `O` **叠在一起**。
//   上一次补的 `点名字显出来` 把字母给上了，可这两个字压在同一处。
//   量出来的原因：点的标签默认摆在点的**右上**，角的值摆在**角弧中点**；
//   60° 的角朝右上开时，角平分线也指着右上 —— 两个位置重合。
//   治法：把角弧放大一点，值顺着平分线自己往外走，字母原地不动。
//
// ★★ 这条探针里最要紧的还是**反例**（第②组）：
//   第①组说"产品画出来的角弧是 55"。这句话要恒绿（比如弧本来就是 55、
//   或者我量的那个量跟这件事无关），它就一句证据都不算。
//   所以第②组拿**同一串命令**走**裸 evalCommand**（`收尾` 还没跑过的行为），
//   那里的弧必须还是 GeoGebra 的默认 30。反例红了，才说明这把尺子读得出"没放大"。
//   ⚠ 反例走裸 evalCommand 是故意的，不是把它当产品路 —— 它在这儿只有一个身份：
//     **改之前那一版的行为**。产品结论只从走 `run` 的组里出。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 值) => { if (真) { 绿++; console.log('  OK  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } else { 红++; console.log('  XX  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } };

const 角图 = ['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(1.5,2.6)', '射线(O,A)', '射线(O,B)', '角(A,O,B)'];
// 顶点故意起名叫 Z（字母序排最后）：这样"原样保留"和"悄悄排序"两种可能
// 给出的答案**长得不一样**，认顶点那个判据是不是真的对，一测就分得开。
const Z图 = ['#清空', 'A=(3,0)', 'B=(1.5,2.6)', 'Z=(0,0)', '射线(Z,A)', '射线(Z,B)', '角(A,Z,B)'];
// 小图：两边只有 0.6 个单位（50px/单位 → 30px）。弧**绝不许比默认的 30 还小**。
const 小图 = ['#清空', 'O=(0,0)', 'A=(0.6,0)', 'B=(0.3,0.52)', '射线(O,A)', '射线(O,B)', '角(A,O,B)'];

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
    if (R && R.exceptionDetails) throw new Error('页面炸了: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    return R && R.result ? R.result.value : null };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=anglearc&t=' + Date.now() });
  for (let i = 0; i < 300; i++) { if (await q('!!(window.SR&&SR.board&&SR.board.isReady()===true)') === true) break; await sleep(500) }
  await sleep(3200);
  await q(`(function(){ if(SR.landing&&SR.landing.pick) SR.landing.pick('draw',true); return 1 })()`); await sleep(1200);

  const 跑 = async (命令) => {
    await q(`SR.board.run(${JSON.stringify(命令)})`);
    await sleep(900);
    for (let i = 0; i < 60; i++) { if (await q('SR.board.isBusy()===false') === true) break; await sleep(250) }
    await sleep(900);
  };
  // 每个角当前的弧半径（**从 XML 里读**，不是从我这边的账上读 —— 我的账可能记错）
  const 读弧 = `(function(){ var a=SR.board.applet(); var s=String(a.getXML()); var o={};
    (a.getAllObjectNames()||[]).forEach(function(n){
      if (String(a.getObjectType(n)).indexOf('angle')!==0) return;
      var 头='<element type="angle" label="'+n+'">'; var i=s.indexOf(头);
      if(i<0){ o[n]='★XML里没有这件'; return }
      var j=s.indexOf('</element>', i); var 段=s.slice(i,j);
      var k=段.indexOf('<arcSize val="');
      if(k<0){ o[n]='★这件没有 arcSize'; return }
      var m=段.indexOf('"', k+14);
      o[n]=parseFloat(段.slice(k+14,m)) });
    return o })()`;
  const 读件 = `(function(){ var a=SR.board.applet(); var o={};
    (a.getAllObjectNames()||[]).forEach(function(n){ try{ o[n]=String(a.getObjectType(n)) }catch(e){ o[n]='?' } });
    return o })()`;
  const 读数 = n => q(`String(SR.board.applet().getValueString(${JSON.stringify(n)}))`);

  console.log('【先确认判据用得上的接口都在】');
  const 接口 = await q(`(function(){ var a=SR.board.applet(); var o={};
    ['getDefinitionString','getCommandString','getXML','setXML','isDefined','getXcoord','getYcoord','getObjectType']
      .forEach(function(m){ o[m]=typeof a[m] });
    return o })()`);
  console.log('  ' + JSON.stringify(接口));
  判('接口 getDefinitionString / isDefined 都在（不在的话 `认顶点` 会一直认不出、整条路静默失效）',
    接口.getDefinitionString === 'function' && 接口.isDefined === 'function', 接口);

  // ================= ① 产品路：弧该是 55 =================
  //  |OА| = |OB| = 3 个单位 = 150px（scale=50）→ 0.5×150 = 75 → 夹到上界 55
  console.log('\n① 产品路（SR.board.run）—— 两边各 3 个单位，弧该夹到上界 55：');
  await 跑(角图);
  const 甲弧 = await q(读弧);
  判('① 角 α 的弧半径被放大到 55', 甲弧['α'] === 55, 甲弧);
  判('① 件数没变（放大弧不该多出或少掉东西）',
    JSON.stringify(Object.keys(await q(读件)).sort()) === JSON.stringify(['A', 'B', 'O', 'f', 'g', 'α']), await q(读件));
  判('① 度数没跟着变，还是 60.02°', (await 读数('α')).indexOf('60.02') >= 0, await 读数('α'));
  判('① 顶点那个字母还在（上一格 `点名字显出来` 的成果没被这一格弄丢）',
    (await q(`(function(){ var a=SR.board.applet(); return [a.getLabelVisible('O'), a.getLabelStyle('O')] })()`))[0] === true,
    await q(`(function(){ var a=SR.board.applet(); return [a.getLabelVisible('O'), a.getLabelStyle('O')] })()`));

  // ================= ② 反例（尺子必须在这儿变红） =================
  console.log('\n② 反例（裸 evalCommand，绕过 收尾 —— 也就是**改之前**的产品行为）：');
  await 跑(['#清空']);
  const ops = await q(`SR.board.toOps(${JSON.stringify(角图)})`);
  await q(`(function(){ var a=SR.board.applet(); var ops=${JSON.stringify(ops)};
    for (var i=0;i<ops.length;i++){
      if (ops[i]==='__NEW__'){ a.newConstruction(); continue }
      try{ a.evalCommand(ops[i]) }catch(e){}
    }
    return 1 })()`);
  await sleep(1400);
  const 乙弧 = await q(读弧);
  判('② ★反例必须红★：同一串命令不跑 `收尾` 时，弧还是 GeoGebra 默认的 30'
    + '（这一条要是绿了，上面①那条绿就一句都不算数）', 乙弧['α'] === 30, 乙弧);

  // ================= ③ 认顶点：认不认得准 =================
  console.log('\n③ 认顶点（顶点只有认准了才谈得上放大；认错了就该整条作废）：');
  await 跑(角图);
  判('③ 普通图 `角(A,O,B)` 的顶点认成了 O', (await q(`SR.board.认顶点('α')`)) === 'O', await q(`SR.board.认顶点('α')`));
  await 跑(Z图);
  判('③ ★顶点叫 Z★、写成 `角(A,Z,B)`：认出来必须是 Z（要是认出 A，说明引擎把参数排过序，判据作废）',
    (await q(`SR.board.认顶点('α')`)) === 'Z', await q(`SR.board.认顶点('α')`));
  判('③ 顶点是 Z 时弧也真的放大了', (await q(读弧))['α'] === 55, await q(读弧));
  判('③ 不是角的东西（一个点）一律认不出 → 返回空串',
    (await q(`SR.board.认顶点('Z')`)) === '', await q(`SR.board.认顶点('Z')`));

  // ================= ④ 小图：弧只许放大、不许缩小 =================
  console.log('\n④ 小图（两边各 0.6 个单位 = 30px）—— 0.5×30 = 15，比默认 30 还小：');
  await 跑(小图);
  const 丁弧 = await q(读弧);
  判('④ 小图上弧**保持默认 30**（只放大不缩小：宁可没改，也不能把本来好好的角画小）',
    丁弧['α'] === 30, 丁弧);

  // ================= ⑤ 幂等：再喊一遍不许越长越大 =================
  console.log('\n⑤ 幂等（`收尾` 每批都会喊一次，同一张图反复喊不许累积）：');
  await 跑(角图);
  const 一 = await q(读弧);
  await q(`SR.board.角弧放大()`); await sleep(800);
  const 二 = await q(读弧);
  await q(`SR.board.角弧放大()`); await sleep(800);
  const 三 = await q(读弧);
  console.log('  连喊三次：' + JSON.stringify(一) + ' → ' + JSON.stringify(二) + ' → ' + JSON.stringify(三));
  判('⑤ 连喊三次弧半径一直停在 55，没有越喊越大', 一['α'] === 55 && 二['α'] === 55 && 三['α'] === 55);

  // ================= ⑧ 三角形顶点上的字母往外让开 =================
  //  ★ 为什么非要有这一组：弧放大在**三角形上拧到头了**（test/_lab_tribarc.cjs：
  //    把弧从 55 一路拧到 110，那个 `48.81°` 一个像素都没再动），所以三角形那一路
  //    只能改字母。改字母这事**风险比改弧大**（动了他已经看惯的图），所以这一组
  //    里最要紧的是 ⑧b 那条**反例**：射线那张图上的 O **不许**被碰。
  console.log('\n⑧ 多边形顶点上的字母往外让（三角形那一路）：');
  const 读标偏 = n => q(`(function(){ var s=String(SR.board.applet().getXML());
    var i=s.indexOf('<element type="point" label="' + ${JSON.stringify(n)} + '"');
    if(i<0) return '（板上没有这个点）';
    var j=s.indexOf('</element>',i); var m=/<labelOffset[^>]*\\/>/.exec(s.slice(i,j));
    return m ? m[0] : '' })()`);
  const 三角图 = ['#清空', 'A=(0,0)', 'B=(3,0)', 'C=(0.9,2.4)', '三角形(A,B,C)',
    '角(A,B,C)', '角(B,C,A)', '角(C,A,B)'];
  await 跑(三角图);
  const 三偏 = { A: await 读标偏('A'), B: await 读标偏('B'), C: await 读标偏('C') };
  console.log('  三角形三个顶点的 labelOffset：' + JSON.stringify(三偏));
  判('⑧a 三角形三个顶点的字母都被挪开了（三点都写出了 labelOffset）',
    Object.keys(三偏).every(k => /^<labelOffset/.test(三偏[k])), 三偏);
  // 方向要看**屏幕**：x 向右、y 向下（实测 test/_lab_vlabel.cjs）。这个三角形
  // B 在右下、A 在左下、C 在顶上 ⇒ 让开的方向该是 右／左／上（上 = y 为负）。
  判('⑧a B 往右让（x > 0）', parseFloat((/<labelOffset x="(-?[\d.]+)"/.exec(三偏.B) || [])[1]) > 0, 三偏.B);
  判('⑧a A 往左让（x < 0）', parseFloat((/<labelOffset x="(-?[\d.]+)"/.exec(三偏.A) || [])[1]) < 0, 三偏.A);
  //  ⚠ y 那一格不能写成 `<labelOffset y="`：这个标签里 **x 永远在前**，
  //    那个字面串在 XML 里根本不出现 —— 照那样写，正则永远抓不到，红的是尺子不是产品。
  判('⑧a C 往上让（y < 0）', parseFloat((/<labelOffset[^>]*\sy="(-?[\d.]+)"/.exec(三偏.C) || [])[1]) < 0, 三偏.C);
  // ⑧b ★★ 反例：射线那张图不许多出 labelOffset ★★
  //     O 不在任何多边形上 ⇒ 那条路一个字节都不许动。
  //     这一条要是红了，说明"闸"根本没起作用，⑧a 那几条绿就不算数。
  await 跑(角图);
  const O偏 = await 读标偏('O');
  判('⑧b ★反例必须绿★：射线那张图的 O **没有** labelOffset'
    + '（55 的弧已经留得下空档，不拿已经好看了的图去冒险）', O偏 === '', O偏);
  // ⑧c 幂等：`收尾` 每批都喊一次，反复喊不许把字母越推越远
  await 跑(三角图);
  const 三偏2 = { A: await 读标偏('A'), B: await 读标偏('B'), C: await 读标偏('C') };
  await 跑(三角图);
  const 三偏3 = { A: await 读标偏('A'), B: await 读标偏('B'), C: await 读标偏('C') };
  console.log('  连跑三遍：' + JSON.stringify(三偏) + ' → ' + JSON.stringify(三偏2) + ' → ' + JSON.stringify(三偏3));
  判('⑧c 连跑三遍 labelOffset 一模一样（算的是"该是多少"，不是"再推多远"）',
    JSON.stringify(三偏) === JSON.stringify(三偏2) && JSON.stringify(三偏2) === JSON.stringify(三偏3), 三偏3);
  判('⑧c 件数没多没少（挪字母不该多出东西）',
    JSON.stringify(Object.keys(await q(读件)).sort()) === JSON.stringify(['A', 'B', 'C', 'a', 'b', 'c', 't1', 'α', 'β', 'γ']),
    await q(读件));

  // ================= ⑥ 老师平时那一屏（抽屉开着的那一屏） =================
  // ★★ 为什么非要有这一组：第⑦组拍的是**大图**，而弧半径和点的标签偏移都是**屏幕像素**，
  //   开大图只放大图形、不放大这两个数 —— **"大图上分得开"不等于"平时那一屏分得开"**。
  //   实测就是这么回事：上界取 42 时大图看着还行，抽屉那一屏里 O 的光晕还蹭着 6。
  //   两个坑当时都踩了，所以这两条断言留在这儿当门卫：
  //     (a) 画板得真在视口里（头两次拍回来 3KB 空白：一次视口比画布窄、顶点落在视口外，
  //         一次忘了拉开抽屉 —— 板子收在视口右边外面，`captureScreenshot` 照出一片白）
  //     (b) 拍回来的图不能是空白
  console.log('\n⑥ 平时那一屏（把抽屉拉开再拍）—— 大图拍得好不算数：');
  // ⚠ 先把**射线那张图**摆回板上：上面第⑧组最后留在板上的是三角形，
  //   而这一格拍的是**原点那个顶点**（O）—— 三角形一在，原点就是 A，
  //   拍回来的还是张好图、断言照样绿，可它量的**不是这一格说的那个东西**。
  //   （老账：读数没错，错的是它量的那个东西。）
  await 跑(角图);
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 980, deviceScaleFactor: 1, mobile: false });
  await sleep(2200);
  await q('(function(){ if(SR.main && SR.main.openDrawer) SR.main.openDrawer(); return 1 })()');
  await sleep(2600);
  const 布局 = await q(`(function(){ var c=document.querySelector('#ggb canvas').getBoundingClientRect();
    return { 视口:window.innerWidth, 左:Math.round(c.left), 右:Math.round(c.left+c.width) } })()`);
  判('⑥ 画板整块在视口里（不在的话拍回来是白的，那张图什么都不能说明）',
    布局.右 <= 布局.视口 && 布局.左 >= 0, 布局);
  const 屏位 = await q(`(function(){ var v=SR.board.applet().getViewProperties(1); if(typeof v==='string')v=JSON.parse(v);
    var c=document.querySelector('#ggb canvas').getBoundingClientRect();
    var k=c.width/v.width;
    return { x:Math.round(c.left + (0-v.xMin)/v.invXscale*k), y:Math.round(c.top + (0-v.yMin)/v.invYscale*k) } })()`);
  const 平时框 = { x: Math.round(屏位.x - 34), y: Math.round(屏位.y - 26), width: 124, height: 50 };
  const rp = await send('Page.captureScreenshot', { format: 'png', clip: { ...平时框, scale: 10 } });
  if (rp && rp.result && rp.result.data) {
    fs.mkdirSync(path.join('test', '_shots'), { recursive: true });
    const buf = Buffer.from(rp.result.data, 'base64');
    fs.writeFileSync(path.join('test', '_shots', '_弧_平时屏.png'), buf);
    判('⑥ 平时那一屏拍出来不是空白（>20KB）', buf.length > 20000, (buf.length / 1024).toFixed(0) + 'KB');
  } else 判('⑥ 平时那一屏拍出来不是空白（>20KB）', false, '没拿到截图');

  // ================= ⑦ 拍张图看（读数对不等于好看） =================
  console.log('\n⑦ 拍顶点放大图 —— 读数再对也得看一眼（本项目栽过"读数变了但其实没变化"）：');
  // ⚠ 先开大图、**再**算裁切框。上一版反过来（先算框后开大图），开大图会把画布尺寸
  //   和 coordSystem 全换掉，那个框当场作废 —— 拍回来一张 5KB 的空白。
  //   （同族老账："等稳"要等的是**最终**那一屏，不是动手之前那一屏。）
  await q('(function(){ if(SR.main && SR.main.openBigFig) SR.main.openBigFig(); return 1 })()');
  await sleep(2800);
  const 框 = await q(`(function(){ var a=SR.board.applet(); var s=String(a.getXML());
    var 头=s.indexOf('<coordSystem'); var 段=s.slice(头, 头+160);
    var k1=段.indexOf('xZero="'), k2=段.indexOf('yZero="');
    var xZ=parseFloat(段.slice(k1+7, 段.indexOf('"', k1+7)));
    var yZ=parseFloat(段.slice(k2+7, 段.indexOf('"', k2+7)));
    var c=document.querySelector('#ggb canvas').getBoundingClientRect();
    return { x:Math.round(c.left+xZ-52), y:Math.round(c.top+yZ-36), width:104, height:72 } })()`);
  console.log('  裁切框 ' + JSON.stringify(框));
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...框, scale: 8 } });
  if (r && r.result && r.result.data) {
    fs.mkdirSync(path.join('test', '_shots'), { recursive: true });
    const buf = Buffer.from(r.result.data, 'base64');
    fs.writeFileSync(path.join('test', '_shots', '_弧_产品路.png'), buf);
    // 这张图以前**没断言**，只打印一个"太小"的提醒 —— 提醒没人看就等于没量。
    // 改成一断言：拍回来是空白（4KB 以下）当场红。（同 ⑥ 那两条。）
    判('⑦ 大图那张拍出来不是空白（>20KB）', buf.length > 20000, (buf.length / 1024).toFixed(0) + 'KB');
  } else 判('⑦ 大图那张拍出来不是空白（>20KB）', false, '没拿到截图');

  console.log('\n' + (红 ? ('★★ 绿 ' + 绿 + ' / 红 ' + 红 + ' —— 有红的，别当它过了') : ('绿 ' + 绿 + ' / 红 0')));
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });

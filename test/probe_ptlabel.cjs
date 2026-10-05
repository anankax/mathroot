// 量"点上的字母到底显出来了没有"（产品里那一句：js/board.js 的 `点名字显出来`）。
//
// ★★ 起因就是孔老师那句话：「角 aob，**角的位置应该标 o**，两边是射线」。
//   他骂的那张图上，三个点**一个字母都没有**。实测（test/_lab_now.cjs 的原读数，
//   逐件问板子问出来的）：O/A/B 全是 `标签可见=false`、`标签档=0` ——
//   GeoGebra 建点的默认就是不显标签，所以**每一张几何图都没有字母**，
//   只有一句孤零零的「60.02°」挂在那儿，谁跟谁的夹角全靠猜。
//
// ★★ 这条探针里最要紧的不是那几条绿，是第②组那个**反例**。
//   第①组说"产品画出来的图上字母都在"。这句话要是恒绿的（比如板子本来就会显标签、
//   或者我量的那个量根本跟标签无关），它一句证据都不算。
//   所以第②组拿**同一串命令**走**裸 evalCommand** 画一遍 —— 那是 `收尾`
//   那一句还没加上去之前产品的行为（`__NEW__` 换成 `newConstruction()`，
//   其余原样，一条 post-pass 都不跑）。同一个判据必须**当场变红**。
//   反例红了，才说明这把尺子读得出"没显"。
//   ⚠ 反例走裸 evalCommand 是**故意的**，不是把它当产品路 —— 本项目栽过
//     "两条尺子量出两个答案，因为其中一把量的是产品里不存在的路"。
//     它在这儿只有一个身份：**改之前那一版的行为**，专门用来给尺子做红验。
//     所有关于产品的结论，全部只从①③④⑤这些走 `run` 的组里出。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 值) => { if (真) { 绿++; console.log('  OK  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } else { 红++; console.log('  XX  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } };

// 这一轮画的那张角图（跟 test/_look_now.cjs 里模型真吐的那串同形）
const 角图 = ['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(1.5,2.6)', '射线(O,A)', '射线(O,B)', '角(A,O,B)'];

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

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=ptlabel&t=' + Date.now() });
  for (let i = 0; i < 300; i++) { if (await q('!!(window.SR&&SR.board&&SR.board.isReady()===true)') === true) break; await sleep(500) }
  await sleep(3200);
  await q(`(function(){ if(SR.landing&&SR.landing.pick) SR.landing.pick('draw',true); return 1 })()`); await sleep(1200);

  // 走产品路跑一批，等到画板闲下来（`收尾` 就在 queueLeft 归零那一格里跑，是同步的）
  const 跑 = async (命令) => {
    await q(`SR.board.run(${JSON.stringify(命令)})`);
    await sleep(900);
    for (let i = 0; i < 60; i++) { if (await q('SR.board.isBusy()===false') === true) break; await sleep(250) }
    await sleep(900);
  };

  // 逐件问板子（**不看图猜**：图上"看不见一个字母"可能是被角标压住了、也可能字跟底色一样）
  const 读 = async () => q(`(function(){ var a=SR.board.applet(); var o={};
    (a.getAllObjectNames()||[]).forEach(function(n){ var r={};
      try{ r['型']=String(a.getObjectType(n)) }catch(e){ r['型']='?' }
      try{ r['可见']=a.getVisible(n) }catch(e){ r['可见']='?' }
      try{ r['标签可见']=a.getLabelVisible(n) }catch(e){ r['标签可见']='?' }
      try{ r['档']=a.getLabelStyle(n) }catch(e){ r['档']='?' }
      o[n]=r });
    return o })()`);
  const 打表 = (标, 表) => { console.log('  ' + 标); Object.keys(表).forEach(n => { const r = 表[n];
    console.log('      · ' + n + '  [' + r['型'] + ']  可见=' + r['可见'] + '  标签可见=' + r['标签可见'] + '  档=' + r['档']) }) };

  // ================= ① 产品路：图上该有字母 =================
  console.log('\n① 产品路（SR.board.run）：');
  await 跑(角图);
  const 甲 = await 读();
  打表('画完之后逐件问板子：', 甲);
  ['O', 'A', 'B'].forEach(n => {
    判('① 点 ' + n + ' 的字母显出来了', 甲[n] && 甲[n]['标签可见'] === true, 甲[n]);
    判('① 点 ' + n + ' 用的是"光名字"那一档（档=0，不带坐标）', 甲[n] && 甲[n]['档'] === 0, 甲[n] && 甲[n]['档']);
  });

  // ================= ② 反例（尺子必须在这儿变红） =================
  // 同一串命令，绕过 run/收尾（= 改之前那一版的行为）。
  // ⚠ `toOps` 给的是"要发给画板的那一份"（`__NEW__` 也在里面），照它发就等于
  //   产品路去掉 post-pass。`__NEW__` 换成 newConstruction()，其余原样 evalCommand。
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
  const 乙 = await 读();
  打表('同样的命令、不跑收尾：', 乙);
  const 反例红 = ['O', 'A', 'B'].every(n => 乙[n] && 乙[n]['标签可见'] !== true);
  判('② ★反例必须红★：同一串命令不跑 `收尾` 时，那几个点是**没有字母**的'
    + '（这一条要是绿了，上面①那几条绿就一句都不算数）', 反例红);

  // ================= ③ 交点的坐标不许被我覆盖 =================
  // `交点显坐标` 是**故意**写样式 1（`A = (-1, 1)`）的，它排在 `点名字显出来` 前面。
  console.log('\n③ 交点的「名字+坐标」别被这一句改回去：');
  await 跑(['#清空', 'f(x)=x^2', 'g(x)=2*x+3', '交点(f,g)']);
  const 丙 = await 读();
  打表('交点的读数：', 丙);
  // ⚠ 别按名字猜哪个是交点：`getObjectType` 一律回 `point`，从类型上看不出
  //   "这点是两样东西碰出来的"。照 `交点显坐标` 自己的判据来 —— 问命令原文。
  const 交点名 = await q(`(function(){ var a=SR.board.applet(); var o=[];
    (a.getAllObjectNames()||[]).forEach(function(n){
      try{ if (String(a.getObjectType(n)).indexOf('point')!==0) return; }catch(e){ return }
      var c=''; try{ c=String(a.getCommandString(n)||'') }catch(e){}
      if (/交点|Intersect/i.test(c)) o.push(n) });
    return o })()`);
  判('③ 认出了交点（认得出来才谈得上"没被覆盖"）', 交点名.length > 0, 交点名);
  交点名.forEach(n => 判('③ 交点 ' + n + ' 还是「名字+坐标」那一档（档=1，没被我改成 0）',
    丙[n] && 丙[n]['档'] === 1, 丙[n] && 丙[n]['档']));

  // ================= ④ 模型自己关掉的不许我开 =================
  console.log('\n④ 模型显式写了 `ShowLabel(A,false)`：不许我给它开回来');
  await 跑(['#清空', 'O=(0,0)', 'A=(3,0)', 'ShowLabel(A,false)']);
  const 丁 = await 读();
  打表('模型显式关掉 A：', 丁);
  判('④ 模型关掉的 A 仍然是关的', 丁['A'] && 丁['A']['标签可见'] !== true, 丁['A']);
  判('④ 同一批里没表态的 O 照旧开出来（说明"关着"是模型的意思，不是我全都没开）',
    丁['O'] && 丁['O']['标签可见'] === true, 丁['O']);

  // ================= ⑤ 整件藏起来的点不碰 =================
  console.log('\n⑤ `#隐藏 B` 的 B：整件都不该在图上，更不给它开字母');
  await 跑(['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(1.5,2.6)', '#隐藏 B']);
  const 戊 = await 读();
  打表('藏掉 B 之后：', 戊);
  判('⑤ B 整件是隐藏的', 戊['B'] && 戊['B']['可见'] !== true, 戊['B']);
  判('⑤ B 的字母也没被开出来', 戊['B'] && 戊['B']['标签可见'] !== true, 戊['B']);
  判('⑤ O / A 照旧有字母', 戊['O'] && 戊['O']['标签可见'] === true
    && 戊['A'] && 戊['A']['标签可见'] === true, { O: 戊['O'], A: 戊['A'] });

  // ================= ⑥ 只动点，别的一件都不许动 =================
  // 拿①和②里**同名的非点对象**对一对：我这一句要是手伸长了，这两份就会不一样。
  console.log('\n⑥ 非点对象（射线、角）在"跑收尾"和"不跑收尾"两份里必须一模一样：');
  const 非点 = Object.keys(甲).filter(n => 甲[n] && String(甲[n]['型']).indexOf('point') !== 0);
  判('⑥ 拿到了可以对照的非点对象（拿不到就说明命令根本没建出射线/角，前面的绿也要重看）',
    非点.length > 0, 非点);
  let 全同 = true; const 差 = {};
  非点.forEach(n => {
    const a = 甲[n] || {}, b = 乙[n] || {};
    if (a['标签可见'] !== b['标签可见'] || a['档'] !== b['档']) { 全同 = false; 差[n] = { 甲: a, 乙: b } }
  });
  判('⑥ 非点对象没被这一句碰到（射线、角的标签状态两份一致）', 全同, Object.keys(差).length ? 差 : undefined);

  // 拍一张肉眼看（字母得真的出现在图上，不能只是"读数说开着"）
  await q('(function(){ if(SR.main && SR.main.openBigFig) SR.main.openBigFig(); return 1 })()');
  await sleep(2600);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: await q(`(function(){var b=document.getElementById('ggb').getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),width:Math.round(b.width),height:Math.round(b.height),scale:2}})()`) });
  if (r && r.result && r.result.data) {
    fs.mkdirSync(path.join('test', '_shots'), { recursive: true });
    const p = path.join('test', '_shots', '_点字母.png'); const buf = Buffer.from(r.result.data, 'base64');
    fs.writeFileSync(p, buf);
    console.log('\n  截图 ' + p + '   ' + (buf.length / 1024).toFixed(0) + 'KB' + (buf.length < 30000 ? '   ← ⚠ 太小了，多半是张空图！' : ''));
  }

  console.log('\n──────── 绿 ' + 绿 + ' / 红 ' + 红 + ' ────────');
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });

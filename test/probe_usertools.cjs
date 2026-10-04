// 量一件事：放大看那个窗口里，GeoGebra 的工具**是不是真的能用**。
//
// 孔老师原话（2026-10-04）：
//   「你这个大窗口没有geogebra的基本功能啊，我要的放大缩小什么都没有啊，
//     也不能添加点，固定点。有啥用啊。那个借鉴的网页的窗口肯定是有geogebra全套工具的」
//
// 之前那把尺子（probe_zoom）量的是"工具条那颗键在不在、看不看得见"——
// 存在、可见，跟**点了它会不会真在板上落下一个点**是两件事。
// 这一把只量后果：真的用鼠标去点工具、去点画布，然后数板上的对象。
//
// ⚠ 用 CDP 的 Input.dispatchMouseEvent 发**真鼠标事件**，不是合成 DOM 事件：
//   GeoGebra 是 GWT，合成 MouseEvent 进不去它那套事件处理（实测点不动）。
//
// ⚠⚠ 挑工具认 `mode=`，不认序号。2026-10-04 我在这儿栽过一次：
//   选择器写成 `.toolbar_item, .toolbar_mainItem`，把那个 **UL** 也算成一颗了
//   （495×0 的空壳，排在 0 号），于是"第 2 颗"其实是第 1 颗（移动），
//   挑了移动再点画布当然什么都不产生 —— 读数看着合情合理，量的却是另一颗键。
//   `mode` 是引擎自己给的号（实测这排是 0,1,2,4,16,10,55,36,30,25,40），
//   不随排列、不随我怎么写选择器变。点 = mode 1，移动 = mode 0。
//   同族教训：选择器多匹配了一个东西 / 写死的件数。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
function 判(名, 好, 注) {
  if (好) { 绿++; console.log('  ✓ ' + 名 + (注 ? '　' + 注 : '')); }
  else { 红++; console.log('  ✗ ' + 名 + (注 ? '　' + 注 : '')); }
}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + JSON.stringify(R.exceptionDetails.exception).slice(0, 300));
    return R && R.result ? R.result.value : null;
  };
  const 等真 = async (式, 秒, 步) => { const n = Math.round(秒 * 1000 / (步 || 300)); for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 300); await sleep(步 || 300) } return -1 };
  // 真鼠标：按下、抬起都要发，GWT 才认。
  const 点一下 = async (x, y, 键) => {
    const b = 键 === 'right' ? 2 : 1;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 键 || 'left', buttons: b, clickCount: 1 });
    await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 键 || 'left', buttons: 0, clickCount: 1 });
  };
  // 按 mode 号点那颗工具（找不到返回 null）
  const 挑工具 = async (mode) => {
    const r = await q(`(function(){
      var b = document.querySelector('li.toolbar_item > .toolbar_button[mode="${mode}"]');
      if (!b) return null;
      var x = b.getBoundingClientRect();
      return [Math.round(x.left + x.width/2), Math.round(x.top + x.height/2)];
    })()`);
    if (!r) return null;
    await 点一下(r[0], r[1]);
    await sleep(600);
    return r;
  };
  const 选中了 = (mode) => q(`(function(){
    var b = document.querySelector('li.toolbar_item > .toolbar_button[mode="${mode}"]');
    return b ? b.getAttribute('isselected') : null;
  })()`);
  const 板上 = async () => JSON.parse(await q('JSON.stringify(SR.board.objects())') || '[]');

  const 错 = [];
  ws.on('message', m => { const o = JSON.parse(m); if (o.method === 'Runtime.exceptionThrown') 错.push(o.params.exceptionDetails.text); });

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=usertools&t=' + Date.now() });
  await 等真('!!(window.SR&&SR.board&&SR.board.isReady()===true)', 90, 500);
  await sleep(2000);

  console.log('\n① 工具条在大窗里露面');
  await q('(function(){SR.main.openBigFig();return 1})()');
  await sleep(1800);
  const 条 = await q(`(function(){
    var it = document.querySelectorAll('li.toolbar_item');
    var vis = 0; for (var i=0;i<it.length;i++) if (it[i].getClientRects().length) vis++;
    var f = document.getElementById('bigfig');
    var modes = Array.prototype.map.call(it, function(e){
      var b = e.querySelector('.toolbar_button'); return b ? b.getAttribute('mode') : null; });
    return { 在大窗里: !!(it.length && f && f.contains(it[0])), 工具数: it.length, 看得见: vis, modes: modes };
  })()`);
  console.log('  （工具 ' + 条.工具数 + ' 颗，看得见 ' + 条.看得见 + '，mode=' + JSON.stringify(条.modes) + '）');
  判('★ 大窗里有一排工具，且都看得见', 条 && 条.工具数 >= 8 && 条.看得见 === 条.工具数);
  // 按名认，不按数数：成套工具里必须有「点」
  判('★ 这一排里有「点」那颗（mode=1）', !!(条 && 条.modes && 条.modes.indexOf('1') >= 0));
  if (!(条 && 条.工具数)) { console.log('\n（没有工具条，底下不用量了）'); ws.close(); process.exit(2); }

  // 画布中心附近找一个落点
  const 落点 = await q(`(function(){
    var c = document.querySelector('#ggb canvas'); if (!c) return null;
    var r = c.getBoundingClientRect();
    return [Math.round(r.left + r.width * 0.40), Math.round(r.top + r.height * 0.38)];
  })()`);
  console.log('  落点：' + JSON.stringify(落点));

  // ═══ ② 红验：**不点工具**，直接点画布 —— 板上的东西不该变 ═══════════════
  //   ⚠⚠ 这一格是这把尺子的命根子。没有它，③那一格量到的可能根本不是
  //     "工具起了作用"，而是"随便在板上点一下都会冒出一个点"。
  console.log('\n② 红验：不挑工具，直接点画布');
  const 空手前 = JSON.stringify(await 板上());
  await 点一下(落点[0], 落点[1]);
  await sleep(900);
  const 空手后 = JSON.stringify(await 板上());
  console.log('  前 ' + 空手前 + ' → 后 ' + 空手后);
  判('★★ 红验成立：没挑工具时在画布上点一下**什么都不产生**（不然③量的是别的事）',
     空手前 === 空手后);

  // ═══ ③ 挑「点」（mode=1），再点画布 —— 该落下一个点 ═══════════════════
  console.log('\n③ 挑「点」工具，再在画布上点一下');
  const 工具位 = await 挑工具('1');
  判('★ 那颗「点」按键点得动（引擎把它收下了）', await 选中了('1') === 'true',
     'isselected=' + JSON.stringify(await 选中了('1')));
  const 挑前 = await 板上();
  await 点一下(落点[0], 落点[1]);
  await sleep(1200);
  const 挑后 = await 板上();
  console.log('  ' + JSON.stringify(挑前) + ' → ' + JSON.stringify(挑后));
  const 新名 = 挑后.filter(n => 挑前.indexOf(n) < 0);
  判('★★ 挑了「点」再去画布上点一下，板上**真多出一个东西**', 挑后.length > 挑前.length,
     '多出 ' + (挑后.length - 挑前.length) + ' 个');
  判('★ 多出来的确实是个**点**（坐标是它自己算的，不是命令行塞进去的）',
     新名.length > 0 && /^[A-Z][0-9]?$/.test(新名[0]),
     '新对象：' + 新名.join(','));
  // 再点一处 —— "一点一颗"，不是点一次就哑了
  const 再前 = 挑后.length;
  await 点一下(落点[0] + 130, 落点[1] + 90);
  await sleep(1100);
  const 再后 = await 板上();
  判('★ 换个地方再点一下，又落一颗（不是点一次就哑）', 再后.length > 再前,
     '共 ' + 再后.length + ' 个：' + 再后.join(','));

  // ═══ ④ 放大缩小 ═══════════════════════════════════════════════════════
  //   「我要的放大缩小什么都没有啊」—— 量后果：往画布上滚一下，坐标系的比例尺该变。
  console.log('\n④ 滚轮缩放（xscale 该变）');
  const 尺 = () => q(`(function(){
    try { var p = JSON.parse(window.ggbApplet.getViewProperties()); return p && (p.xscale!=null? p.xscale : p[0] && p[0].xscale) || null; }
    catch(e){ return 'ERR:'+e }
  })()`);
  const 滚前 = await 尺();
  // 红验：什么都不做，再读一次 —— 该**一模一样**（不然"变了"可能是它自己在飘）
  await sleep(700);
  const 静止 = await 尺();
  判('★★ 红验：不动它时比例尺不自己飘（不然④那个"变了"不算数）', String(静止) === String(滚前),
     '两次都 ' + 滚前);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 落点[0], y: 落点[1], deltaX: 0, deltaY: -240, button: 'none', buttons: 0 });
  await sleep(900);
  const 滚后 = await 尺();
  console.log('  xscale ' + 滚前 + ' → ' + 滚后);
  判('★★ 滚轮一滚，比例尺真的变了（放大缩小是活的）', String(滚后) !== String(滚前));

  // ⑤ 换到三维，工具条还在
  console.log('\n⑤ 切三维，工具条还在不在');
  await q('(function(){SR.board.setView("3d");return 1})()');
  await sleep(1600);
  const 三 = await q(`(function(){
    var it = document.querySelectorAll('li.toolbar_item, .toolbar_item');
    var vis = 0; for (var i=0;i<it.length;i++) if (it[i].getClientRects().length) vis++;
    return { 数: it.length, 看得见: vis };
  })()`);
  console.log('  （三维下工具 ' + 三.数 + ' 颗，看得见 ' + 三.看得见 + '）');
  判('★ 切到三维，工具条还在、还看得见', 三 && 三.数 >= 8 && 三.看得见 >= 8);
  await q('(function(){SR.board.setView("2d");return 1})()');
  await sleep(1400);

  // ═══ ⑥ 右键（「固定点」在右键那份菜单里）═══════════════════════════════
  console.log('\n⑥ 右键画布 / 右键那个点');
  await 点一下(落点[0], 落点[1], 'right');
  await sleep(1200);
  const 右键 = await q(`(function(){
    var 浮 = [];
    document.querySelectorAll('div, ul, table').forEach(function(e){
      var cs = getComputedStyle(e);
      if (cs.position !== 'absolute' && cs.position !== 'fixed') return;
      if (!e.getClientRects().length) return;
      var r = e.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) return;
      var t = (e.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t) 浮.push({ 类: e.className, 文: t.slice(0, 140) });
    });
    return 浮.slice(0, 4);
  })()`);
  console.log('  （右键后浮出来的东西：' + JSON.stringify(右键) + '）');
  判('★★ 右键点得出一份菜单（改名字／颜色／**固定**都在它里头）',
     右键 && 右键.length > 0);

  // 关掉那份菜单，别留着
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);

  console.log('\n（页面异常 ' + 错.length + ' 条）');
  判('★ 整场下来页面一条异常都没抛', 错.length === 0, 错.slice(0, 2).join(' | '));

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  ws.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('炸了：' + (e && e.stack || e)); process.exit(3); });

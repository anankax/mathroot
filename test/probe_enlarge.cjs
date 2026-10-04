// 「放大看」那一刀：点开大窗之后，**画板还是空白的吗**。
//
// 孔老师 2026-10-04：「打开大窗口以后，之前的图也没有出来啊，就是一个空白的画板啊。」
// 病根：这一遍回放走了慢档（550ms 一条），大窗先开、图后到，中间一两秒全白。
// 治：chat.js 那个处理函数改成 run(lines, {快:true})。
//
// ⚠ 前两版这把尺子自己坏过两次，都记在这儿：
//   ① 按 `y` 挑按钮 —— 聊天记录长起来之后按钮落到视口外，点击根本没落地，
//      而"没落地"和"点了没反应"在读数上一模一样。现在先 scrollIntoView 再点。
//   ② 板子还在**回放**的时候就去量"点之前" —— 量到的是上一张图，
//      点完之后板被下一张图清了，看着像"点了反而没图"。现在等板**静够 1.5 秒**才动手。
const path = require('path'), http = require('http'), fs = require('fs');
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
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result; if (R && R.exceptionDetails) throw new Error('页面炸了 ' + JSON.stringify(R.exceptionDetails.exception).slice(0, 400)); return R && R.result ? R.result.value : null };
  const 等真 = async (式, 秒, 步) => { const n = Math.round(秒 * 1000 / (步 || 250)); for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 250); await sleep(步 || 250) } return -1 };
  const 拍 = async (名) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r && r.result && r.result.data) { fs.writeFileSync(path.join('test', '_shots', 名), Buffer.from(r.result.data, 'base64')); return 名 } return '(没拍到)' };
  const 墨 = `(function(){
    var c = document.querySelector('#ggb canvas'); if(!c) return null;
    try { var d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; } catch(e){ return 'ERR:'+e.message }
    var n=0,t=0; for (var k=0;k<d.length;k+=4*17){ t++; if(d[k]<235||d[k+1]<235||d[k+2]<235) n++ }
    return { 抽点:t, 非白:n };
  })()`;
  const 局 = `(function(){
    var m = SR.main && SR.main.bigFigOpen ? SR.main.bigFigOpen() : null;
    var it = document.querySelectorAll('li.toolbar_item');
    var vis=0; for (var i=0;i<it.length;i++) if (it[i].getClientRects().length) vis++;
    var 输入 = document.querySelectorAll('#ggb textarea, #ggb input');
    var 看得见的输入 = 0;
    输入.forEach(function(e){ var r=e.getBoundingClientRect(); if (r.width > 60 && r.height > 6 && getComputedStyle(e).opacity !== '0') 看得见的输入++; });
    return { 大窗:m, 工具数:it.length, 工具看得见:vis, 输入框:看得见的输入, 板上: SR.board.objects() };
  })()`;

  let 红 = 0, 绿 = 0;
  const 判 = (名, 真, 说明) => { if (真) { 绿++; console.log('  ✓ ' + 名 + (说明 ? '  ' + 说明 : '')) } else { 红++; console.log('  ✗ ' + 名 + (说明 ? '  ' + 说明 : '')) } };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=enlarge&t=' + Date.now() });
  await 等真('!!(window.SR&&SR.board&&SR.board.isReady()===true)', 90, 500);
  await 等真('document.querySelectorAll(".figagain").length > 0', 40, 500);

  // 等板**静下来**：连着两秒 objects 不变才算回放完了
  console.log('等画板静下来…');
  let 上 = '', 稳 = 0;
  for (let i = 0; i < 60 && 稳 < 6; i++) {
    const 今 = JSON.stringify(await q('SR.board.objects()'));
    if (今 === 上) 稳++; else { 稳 = 0; 上 = 今 }
    await sleep(350);
  }
  console.log('  静下来时板上：' + 上);

  // 挑一个**在视口里**的「放大看」，滚进来，等它**不动了**再量坐标。
  //   ★ 为什么非等不可：容器上如果挂着 `scroll-behavior:smooth`，`scrollIntoView`
  //     是**动画**着过去的，量出来的坐标半路就作废了 —— 点击落到别处，
  //     而"点空了"跟"点了没反应"读数长得一模一样（上一版就栽在这儿）。
  const 挑 = `(function(){
    var all = Array.prototype.slice.call(document.querySelectorAll('.figagain'));
    for (var i = all.length - 1; i >= 0; i--) {
      var r0 = all[i].getBoundingClientRect();
      if (r0.width < 10) continue;
      all[i].scrollIntoView({ block: 'center' });
      var r = all[i].getBoundingClientRect();
      if (r.top > 40 && r.bottom < innerHeight - 40) {
        var cx = Math.round(r.left + r.width/2), cy = Math.round(r.top + r.height/2);
        var 落点 = document.elementFromPoint(cx, cy);
        return { 个数: all.length, 第几: i, 文字: all[i].textContent, x: cx, y: cy,
                 落点对不对: !!(落点 && (落点 === all[i] || all[i].contains(落点) || 落点.contains(all[i]))),
                 落点是什么: 落点 ? (落点.tagName + '.' + String(落点.className).slice(0, 40)) : null };
      }
    }
    return { 个数: all.length, 找不到: true };
  })()`;
  let 钮 = await q(挑);
  // 等它停稳：连着三次坐标一样才算
  for (let i = 0; i < 12; i++) {
    const 再 = await q(挑);
    if (再 && 钮 && 再.x === 钮.x && 再.y === 钮.y) { if (i >= 2) { 钮 = 再; break } }
    钮 = 再 || 钮;
    await sleep(200);
  }
  console.log('  聊天里那个按钮：' + JSON.stringify(钮));
  if (钮.找不到 || !钮.个数) { console.log('（没有能点的「放大看」，这条量不了）'); ws.close(); process.exit(2) }
  if (!钮.落点对不对) {
    // ★ 这条**必须先红**：落点不是那颗按钮，说明是尺子够不着，不是产品坏了。
    //   不拦这一道的话，下面四条会一起红成"大窗开不起来"，把尺子的毛病记到产品头上。
    console.log('  ✗ 尺子坏了：这个坐标上没有那颗按钮，落点是 ' + 钮.落点是什么 + ' —— 不是产品的问题，是没点着');
    ws.close(); process.exit(2);
  }

  const 点前墨 = await q(墨);
  console.log('点之前　' + JSON.stringify(await q(局)) + '　墨：' + JSON.stringify(点前墨));

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 钮.x, y: 钮.y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 钮.x, y: 钮.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 钮.x, y: 钮.y, button: 'left', buttons: 0, clickCount: 1 });

  // ★ 这一段是这条尺子的**题眼**：+1000ms 那一格，大窗已经开了，板上得**已经有图**。
  await sleep(1000);
  const 一 = { 局: await q(局), 墨: await q(墨) };
  console.log('+1000ms　' + JSON.stringify(一.局) + '　墨：' + JSON.stringify(一.墨));
  await sleep(1000);
  const 二 = { 局: await q(局), 墨: await q(墨) };
  console.log('+2000ms　' + JSON.stringify(二.局) + '　墨：' + JSON.stringify(二.墨));
  await sleep(2000);
  const 四 = { 局: await q(局), 墨: await q(墨) };
  console.log('+4000ms　' + JSON.stringify(四.局) + '　墨：' + JSON.stringify(四.墨));
  console.log('  截图 ' + await 拍('enlarge_after.png'));

  console.log('\n判：');
  判('大窗开起来了', 一.局.大窗 === true, JSON.stringify(一.局.大窗));
  判('+1 秒时画板上已经有图（不是空白）', 一.墨 && 一.墨.非白 > 0, '非白=' + (一.墨 && 一.墨.非白));
  判('+1 秒时板上已经有对象', !!一.局.板上 && 一.局.板上.length > 0, JSON.stringify(一.局.板上));
  判('大窗里有工具条', 一.局.工具看得见 > 0, 一.局.工具看得见 + ' 个');
  判('大窗里有能用的输入栏', 一.局.输入框 > 0, 一.局.输入框 + ' 个');
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('炸了：' + (e && e.stack || e)); process.exit(3); });

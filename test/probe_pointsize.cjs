// 画板上的点有多大？——守「geogebra 的点怎么这么大」这一条。
//
// ★ 为什么值得单独守：GeoGebra 新建的点默认大小是 5（它属性面板里那一档），
//   在一块宽不到 560px 的画板上就是个大圆点。而**没有"改全局默认"这条 API**，
//   只能在每条命令之后回头逐个改（board.js 的 slimPoints）。
//   这个"之后回头改"最容易被后来的改动绕过去：新加一条画图的路径、
//   或者某个分支提前 return 了，点就悄悄变大回去，而画板上不会报错。
//
// ★ 仪器自检（这条不能省）：光读 `getPointSize` 不够——它只能证明"属性设成了 3"，
//   证明不了"画出来真的小了"。所以同一颗点在**同一个位图尺子**上量两次：
//   先手动把它设成 5，量一次墨点；再让 slimPoints 把它改回 3，量一次。
//   两次读数必须差出来（5 的那次明显粗），否则是尺子坏了，先修尺子再报结论。
//
// 量法：摆一颗**孤零零的点**，把坐标轴、网格、标签全关掉，
// 于是整张位图上的墨点全是它，量到的就是它自己，不用猜位置。
// ⚠ 这一步不能省：`#清空`（newConstruction）**会把坐标轴重新打开**。
//   第一次跑这个探针时就栽在这儿——两根轴各 1000+ 像素的墨点混进来，
//   读数 5560 个，把点那几十个像素整个淹了，5 和 3 自然分不出来。
//
// 用法: node test/probe_pointsize.cjs   （先起 node test/serve.cjs 8138，Chrome 在 9222）
//   退出码 0 = 通过；1 = 点没变小；3 = 尺子坏了
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

// 页面里：把画板位图上的墨点量出来（暗像素个数 + 外接框）。
// 只有一颗点、标签已关，所以数到的就是这颗点。
const INK = `(function(){
  function ink(cb){
    var raw = SR.board.toPNG();
    var im = new Image();
    im.onerror = function(){ cb('LOAD-FAIL'); };
    im.onload = function(){
      var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      var g = c.getContext('2d'); g.drawImage(im, 0, 0);
      var d = g.getImageData(0, 0, im.width, im.height).data;
      var n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (var i = 0; i < d.length; i += 4) {
        // 纯黑才算。白底上的点就是这个色；抗锯齿的边缘是灰的，会自然落选。
        if (d[i] > 128 || d[i+1] > 128 || d[i+2] > 128) continue;
        if (d[i+3] < 200) continue;
        n++;
        var p = i / 4, x = p % im.width, y = (p / im.width) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      cb(JSON.stringify({ n: n, w: x1 - x0 + 1, h: y1 - y0 + 1 }));
    };
    im.src = /^data:/.test(raw) ? raw : 'data:image/png;base64,' + raw;
  }
  return new Promise(function(res){ ink(res); });
})()`;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitIdle = async () => { for (let i = 0; i < 30; i++) { await sleep(300); if (!(await q('SR.board.isBusy()'))) return true; } return false; };
  const shot2 = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(s.result.data, 'base64'));
    return path.join(__dirname, name);
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  await sleep(1500);
  // 同域普通导航吃缓存，必须硬重载——不然跑的是上一版 board.js
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 24; i++) {
    await sleep(1500);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }
  if (!(await q('SR.board.isReady()'))) { console.log('画板没就绪，后面没意义'); process.exit(3); }

  // ---- 摆一颗孤零零的点，标签关掉 ----
  await q(`SR.board.run(['#清空','A=(0,0)'])`);
  await waitIdle();
  // ★ 轴/网格是全图最粗的墨点来源，量点之前必须先关掉（`#清空` 会把轴打开）
  await q(`ggbApplet.setAxesVisible(false, false); ggbApplet.setGridVisible(false)`);
  await q(`ggbApplet.setLabelVisible('A', false)`);
  await sleep(500);

  const sizeNow = await q(`ggbApplet.getPointSize('A')`);
  const ink3 = JSON.parse(await q(INK));
  console.log('产品摆出来的那颗点：');
  console.log('  大小（GeoGebra 自己说的）=', sizeNow, '  位图上的墨点 =', JSON.stringify(ink3));

  // ---- 尺子自检：手动改成 5，同一个尺子再量一次 ----
  await q(`ggbApplet.setPointSize('A', 5)`);
  await sleep(500);
  const ink5 = JSON.parse(await q(INK));
  console.log('尺子自检——同一颗点手动设成 5：');
  console.log('  大小 =', await q(`ggbApplet.getPointSize('A')`), '  位图上的墨点 =', JSON.stringify(ink5));

  const ruler = ink5.n > ink3.n * 1.4 && ink5.w > ink3.w;
  console.log('  尺子能分出 5 和 3 吗：' + (ruler ? '能（' + ink3.w + 'px → ' + ink5.w + 'px）' : '★不能，先修尺子'));

  // ---- slimPoints 会不会把已画的大点拉回来 ----
  await q(`SR.board.run(['B=(3,3)'])`);
  await waitIdle();
  await sleep(500);
  const backA = await q(`ggbApplet.getPointSize('A')`);
  const newB = await q(`ggbApplet.getPointSize('B')`);
  console.log('\n再画一颗新点 B 之后：');
  console.log('  老的 A =', backA, '（5 应该被拉回 3）   新的 B =', newB, '（生出来就该是 3）');

  // ---- 一张给人眼的图：数轴 + 几个点，看看是不是真不笨了 ----
  await q(`SR.board.run(['#清空','数轴','P=(-3,0)','Q=(0,0)','R=(2.5,0)'])`);
  await waitIdle();
  await sleep(700);
  console.log('\n截图（数轴 + 三个点）: ' + await shot2('_pointsize.png'));

  const ok = sizeNow === 3 && ruler && backA === 3 && newB === 3;
  console.log('\n结论：' + (ok ? '✓ 点已经统一在 3，而且改得回来' : '✗ 没达标，逐条看上面'));
  process.exit(ok ? 0 : (ruler ? 1 : 3));
})().catch(e => { console.log('探针自己炸了：', e.message); process.exit(3); });

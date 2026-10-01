// 「存图」这条路：导出的 PNG 里，署名到底烧进去没有？
//
// ★ 为什么这条值得单独守：导出的是**图片**——最容易被人贴进课件、发进群里、
//   搬去别处的形态（比整页 HTML 还好搬）。孔老师这次第一条要求就是"不让人盗用"，
//   而画板右下角那个 `KAX · 数根 mathroot` 是个 DOM 层，`getPNGBase64` 拿不到它：
//   照它直接存，出去的是一张干干净净、看不出出处的图。所以导出那一路
//   （board.js 的 exportPNG）必须自己再画一遍水印。
//
// ★ 仪器自检（这条不能省）：同一块画板取两张图——**原图**（toPNG，没有水印）
//   和**导出的图**（exportPNG，该有水印）——量右下角同一块区域的"墨点"。
//   原图必须近似 0（说明尺子不是见谁都报有墨），导出的图必须有一片。
//   两边读数一样 = 尺子坏了，先修仪器，别急着报"水印没烧进去"。
//
// 用法: node test/probe_png.cjs        （先起 node test/serve.cjs 8138，Chrome 在 9222）
//   退出码 0 = 通过；1 = 水印没烧进去；3 = 尺子坏了
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const OUT = path.join(__dirname, '_png_out.png');   // gitignored（test/_*），留着给人眼看

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

// 在页面里：拿到两张图，各量一次右下角的墨点，一并回来
const MEASURE = `(function(){
  function ink(img, cb){
    var im = new Image();
    im.onerror = function(){ cb('LOAD-FAIL'); };
    im.onload = function(){
      var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      var g = c.getContext('2d'); g.drawImage(im, 0, 0);
      // 只看右下角那一块：署名烧在那儿。取宽 30%、高 9%。
      var w = Math.round(im.width * 0.30), h = Math.round(im.height * 0.09);
      var d = g.getImageData(im.width - w, im.height - h, w, h).data;
      var n = 0;
      for (var i = 0; i < d.length; i += 4) {
        // 主色是深绿 #277a56：红不高、绿偏中、蓝不高。灰阶的坐标轴/网格不满足这条。
        if (d[i] < 150 && d[i+1] > 60 && d[i+1] < 200 && d[i+2] < 160) n++;
      }
      cb(n);
    };
    im.src = /^data:/.test(img) ? img : 'data:image/png;base64,' + img;
  }
  return new Promise(function(res){
    var raw = SR.board.toPNG();
    SR.board.exportPNG(function(u){
      ink(raw, function(a){
        ink(u, function(b){
          res(JSON.stringify({raw: String(raw).length, out: String(u).length,
                              rawInk: a, outInk: b, data: u}));
        });
      });
    });
  });
})()`;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 20; i++) { await sleep(1200); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break; }
  console.log('画板就绪:', await q('SR.board.isReady()'));
  if (!(await q('typeof SR.board.exportPNG === "function"'))) {
    console.log('★ 页面上没有 SR.board.exportPNG——先把服务重启、硬刷一遍再跑（同域导航会吃缓存）');
    process.exit(1);
  }

  // 画点东西，空板子量不出水印（也免得"没画东西"和"没烧水印"混在一起）
  await q('SR.board.run(["坐标系","A=(-2,1)","B=(3,-1)","线段(A,B)"])');
  for (let i = 0; i < 20; i++) { await sleep(300); if (!(await q('SR.board.isBusy()'))) break; }
  await sleep(700);

  const got = await q(MEASURE);
  const o = typeof got === 'string' ? JSON.parse(got) : got;
  if (!o || o.rawInk === 'LOAD-FAIL' || o.outInk === 'LOAD-FAIL') {
    console.log('★ 图根本没 load 起来——先看 toPNG 回来的是不是光秃秃的 base64（没有 data: 前缀就加载不了）');
    process.exit(1);
  }
  fs.writeFileSync(OUT, Buffer.from(String(o.data).split(',')[1], 'base64'));

  console.log('原图 toPNG     : ' + o.raw + ' 字节   右下角墨点 ' + o.rawInk);
  console.log('导出 exportPNG : ' + o.out + ' 字节   右下角墨点 ' + o.outInk);
  console.log('（原图存到 ' + OUT + '，可以打开看一眼——水印应该压在右下角）');

  if (o.rawInk > 200 && o.outInk > 200) {
    console.log('\n★ 两张都有墨——尺子分不出"烧了"和"没烧"，先修仪器，别急着报通过。');
    process.exit(3);
  }
  const pass = o.outInk > 200 && o.rawInk <= 200;
  console.log('\n===== 存图水印：' + (pass ? '通过（导出的图右下角有署名）' : '有问题') + ' =====');
  process.exit(pass ? 0 : 1);
})();

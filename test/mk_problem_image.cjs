// 造一张"学生拍照发来的错题"，给 probe_image.cjs / probe_image_prompt.cjs 用。
//
// ★ 为什么是浏览器画的，不是 Python 画的：原来那版 mk_problem_image.py 要 Pillow，
//   而这台机器上没有装（`import PIL` 直接 ModuleNotFoundError）。为了不为了造一张测试图
//   去动孔老师的 Python 环境，改用**浏览器自己的字体和截图**——零依赖，画出来还有真中文字形。
//
// ★ 这张图要测什么（照旧，别改）：
//   测的是提示词里"学生把整份解答拍过来、每一步都看得见"那一档——模型最容易
//   "哪步错了就直接问哪步"，把学生自己的复盘跳过去。所以解答**故意错在中间那一步**
//   （6÷2 写成 4），不在最后。
//   图里只有字和算式，没有人脸。
//   ★ 顺手模拟"手机拍的"：整体斜一点 + 撒一点噪点，免得测的是"干净截图"这个最好走的情形。
//
// 产物：test/_case_photo.png （900×700，被 .gitignore 的 test/_* 挡住，不进仓库）
// 用法：node test/mk_problem_image.cjs   （要先起 node test/serve.cjs 8138，也要 Chrome 在 9222）
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const OUT = path.join(__dirname, '_case_photo.png');
const W = 900, H = 700;

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

const PAGE = `<!doctype html><meta charset="utf-8">
<style>
  /* overflow:hidden 必须有：那张纸整体转了 1.2°，外接矩形比视口大，
     不挡的话截图右边和下边会带出滚动条——那玩意儿会被识图模型当成图像的一部分。 */
  html,body{margin:0;padding:0;background:#faf8f3;overflow:hidden}
  .sheet{width:${W}px;height:${H}px;background:#faf8f3;position:relative;
         transform:rotate(-1.2deg);transform-origin:50% 50%}
  h1{position:absolute;left:60px;top:34px;margin:0;font:700 34px "Microsoft YaHei",sans-serif;color:#141414}
  pre{position:absolute;left:110px;top:120px;margin:0;font:30px/62px "Microsoft YaHei",sans-serif;color:#1e1e1e}
  .rule{position:absolute;left:60px;right:60px;top:565px;height:2px;background:#cdc8be}
  canvas{position:absolute;inset:0;mix-blend-mode:multiply;opacity:.5}
</style>
<div class="sheet">
  <h1>3. 解方程：2x + 1 = 7</h1>
  <pre>解：2x = 7 - 1
      2x = 6
      x = 6 ÷ 2
      x = 4

答：x = 4</pre>
  <div class="rule"></div>
  <canvas id="noise" width="${W}" height="${H}"></canvas>
</div>
<script>
  // 撒噪点：模拟手机拍的。用固定种子，保证每次造出来的图是同一张（探针才可复现）。
  var c = document.getElementById('noise'), g = c.getContext('2d');
  var s = 7;
  function rnd(){ s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  for (var i = 0; i < ${W * H / 60}; i++) {
    var k = Math.floor(rnd() * 60) - 30;
    g.fillStyle = 'rgba(' + (128 + k) + ',' + (128 + k) + ',' + (128 + k) + ',0.06)';
    g.fillRect(Math.floor(rnd() * ${W}), Math.floor(rnd() * ${H}), 2, 2);
  }
  document.title = 'ready';
</script>`;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(PAGE) });
  await sleep(900);   // 等中文字体落地，不然截图里是方框

  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(OUT, Buffer.from(s.result.data, 'base64'));
  ws.close();
  for (const x of JSON.parse(await put('/json/list'))) if (x.id === t.id) await put('/json/close/' + x.id);

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('OK ' + OUT + '  ' + W + '×' + H + '  ' + kb + 'KB');
  console.log('★ 验一下图里真的有字：用识图看一眼，别拿一张空白图去测读图。');
})();

// 「本地素材」这一档：本机该出现、公开站该彻底没有。
//
// ★ 这条要验的是**两件相反的事**，缺一件就等于没验：
//   1. 索引在的时候（本机）：按钮出现，搜「2.3」能筛出绝对值那几件；
//   2. 索引不在的时候（等于公开站的处境）：按钮**一直藏着**，页面上不留痕迹。
//   只验第 1 条的话，"客户看不到"这句就是没验过的假设——而它恰恰是这一档的底线：
//   孔老师要的是"成为网站的读取资源，不显示在客户面前"。
//   第 2 条靠 CDP 把 js/resource-index.js 拦掉来模拟公开站（比"手动删文件再还原"可靠，
//   也不会动到她的仓库）。
//
// 用法: node test/probe_resources.cjs      （先起 node test/serve.cjs 8138，Chrome 在 9222）
//   退出码 0 = 两件都对；1 = 有问题；3 = 尺子坏了
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const BLOCK = '*/js/resource-index.js';

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const boot = async () => {
    for (let i = 0; i < 25; i++) { await sleep(800); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break; }
    await sleep(600);
  };

  // ---- 第一趟：索引在（本机）----
  await send('Network.setBlockedURLs', { urls: [] });
  await send('Page.navigate', { url: PAGE });
  await boot();
  console.log('索引条数      :', await q('(SR.RESOURCES&&SR.RESOURCES.条数)||0'));
  const shown = await q('(function(){var b=document.getElementById("resbtn");return b?getComputedStyle(b).display:"（没有这个按钮）"})()');
  console.log('按钮 display  :', shown);
  console.log('按需加载状态  :', await q('SR.resources.state()'));

  // 打开面板、搜 2.3
  await q('(function(){document.getElementById("resbtn").click();return 1})()');
  await sleep(400);
  await q('(function(){var i=document.getElementById("resq");i.value="2.3";i.dispatchEvent(new Event("input"));return 1})()');
  await sleep(300);
  const rows = await q(`JSON.stringify(Array.prototype.slice.call(document.querySelectorAll('#resrows .resrow')).map(function(e){
     return e.querySelector('.reshape').textContent + ' | ' + e.querySelector('.respath').textContent; }))`);
  const meta = await q('document.getElementById("resmeta").textContent');
  const list = JSON.parse(rows || '[]');
  console.log('搜「2.3」     :', meta);
  list.slice(0, 4).forEach(r => console.log('   ' + r));
  const hitAbs = list.filter(r => /绝对值/.test(r)).length;
  const absPath = list.length ? /^C:\\数学办公/.test(list[0].split(' | ')[1]) : false;
  console.log('  其中带"绝对值"的 ' + hitAbs + ' 条；路径补全成绝对路径 ' + (absPath ? '✅' : '❌'));

  // 空搜一遍（q 清空）——列表该回到全部
  await q('(function(){var i=document.getElementById("resq");i.value="";i.dispatchEvent(new Event("input"));return 1})()');
  await sleep(300);
  const allShown = await q('document.querySelectorAll("#resrows .resrow").length');
  console.log('清空搜索后显示:', allShown, '条（★ 封顶 200，是设计好的，不是只筛出这些）');
  await q('(function(){var b=document.querySelector("#reslist [data-close]");if(b)b.click();return 1})()');

  // ---- 第二趟：把索引拦掉（模拟公开站）----
  await send('Network.setBlockedURLs', { urls: [BLOCK] });
  await send('Page.navigate', { url: PAGE });
  await boot();
  const shown2 = await q('(function(){var b=document.getElementById("resbtn");return b?getComputedStyle(b).display:"（没有这个按钮）"})()');
  const has = await q('!!window.SR.RESOURCES');
  console.log('\n拦掉索引之后  :');
  console.log('  window.SR.RESOURCES 有没有 :', has);
  console.log('  按需加载状态               :', await q('SR.resources.state()'));
  console.log('  按钮 display               :', shown2);
  await send('Network.setBlockedURLs', { urls: [] });

  const pass = shown !== 'none' && hitAbs > 0 && absPath && !has && shown2 === 'none';
  // 尺子自检：第一趟按钮要是也没显示，那"第二趟没显示"什么都说明不了
  if (shown === 'none') {
    console.log('\n★ 索引在的时候按钮都没出来——先修仪器（是不是 js/resource-index.js 没生成、或者服务没重启），别急着看第二趟。');
    process.exit(3);
  }
  console.log('\n===== 本地素材：' + (pass ? '通过（本机出现、拦掉索引就彻底消失）' : '有问题') + ' =====');
  ws.close();
  process.exit(pass ? 0 : 1);
})();

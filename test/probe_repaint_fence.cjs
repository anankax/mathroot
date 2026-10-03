// 「同一段原文，当场渲染的字 == 刷新之后渲染的字」——一条不变量，两态各量一遍。
//
// 为什么要有这条：chat.js 里模型的话有**两条渲染路**。
//   当场那条（submit 的收流）走 SR.render.parseFences(...).visible —— 围栏摘掉，
//   命令进画板，气泡里只剩人话。
//   重画那条（repaintLog，刷新页面／切工位走它）原来把**原文**直接倒进气泡，
//   于是同一句话刷新一下长出了机器话：「#清空 / 数轴 / 点(-2,"-2")」。
//   2026-10-03 在页面上量到的原文就长这样（memo 里存的是 res.text，带围栏）：
//     "```ggb\n#清空\n数轴\n```\n"
//
// ★ 这条不变量本文件不用嘴说：**让产品自己跑一遍**。
//   ① 用桩把一轮回复喂成"围栏 + 一句正话"，当场渲染 → 记下字；
//   ② 硬重载（产品自己把这一轮写进了 memo）→ 重画那条路渲染同一轮 → 再记一次。
//   两回的字必须一样，而且**都不许出现围栏里的字**。
//
// ⚠ 别拿"两处都调 parseFences"当判据——那是同义反复（我改成什么样它都绿）。
//   这里量的是**屏幕上那个气泡里的字**。
//
// 跑法：
//   node test/probe_repaint_fence.cjs              绿
//   SR_RED=1 node test/probe_repaint_fence.cjs     红验：把 repaintLog 那行改回
//                                                  addAssistantText(t.t)（CDP 换响应）
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const RED = process.env.SR_RED === '1';
const CHAT = path.join(__dirname, '..', 'js', 'chat.js');
const FIXED = 'addAssistantText(restoreText(t.t, t.w))';
const BROKEN = 'addAssistantText(t.t)';

let DOCTORED = null;
if (RED) {
  const src = fs.readFileSync(CHAT, 'utf8');
  const a = src.indexOf(FIXED);
  if (a < 0) { console.log('★ chat.js 里没找到"' + FIXED + '"——红验作废'); process.exit(2); }
  const s = src.slice(0, a) + BROKEN + src.slice(a + FIXED.length);
  try { new Function(s); } catch (e) { console.log('★ 改坏的那份编译不过，红验作废：' + e.message); process.exit(2); }
  DOCTORED = s;
}

const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });

let PASS = 0, FAIL = 0;
const ok = (cond, what, got) => {
  if (cond) { console.log('  ✓ ' + what); PASS++; return true; }
  console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got)); FAIL++; return false;
};
const HINT = '#清空';          // 围栏里的东西（机器话）——两条路上都不该出现在气泡里
const WORDS = '画好了。数轴是一条水平的直线。';   // 围栏外的正话——两条路上都该有

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {}; let HIT = false;
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.method === 'Fetch.requestPaused' && r.params) {
      const p = r.params;
      if (RED && /\/js\/chat\.js(\?|$)/.test(p.request.url) && DOCTORED) {
        HIT = true;
        send('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' },
            { name: 'Cache-Control', value: 'no-store' }],
          body: Buffer.from(DOCTORED, 'utf8').toString('base64'),
        });
      } else send('Fetch.continueRequest', { requestId: p.requestId });
      return;
    }
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; }
  });
  await new Promise(r => ws.on('open', r));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (RED) await send('Fetch.enable', { patterns: [{ urlPattern: '*js/chat.js*', requestStage: 'Request' }] });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面里炸了：' + String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 220));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const up = async () => {
    for (let i = 0; i < 100; i++) { if (await ev('!!(window.SR && SR.chat && SR.render)')) break; await sleep(250); }
    await sleep(900);
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE }); await up();
  if (RED && !HIT) { console.log('★ 没拦到 js/chat.js，红验作废'); await closeTab(t.id); ws.close(); process.exit(2); }
  if (RED) console.log('★ 这个标签页跑的 chat.js：**repaintLog 那行已改回原文渲染**（磁盘没动）\n');

  // ---- ① 当场渲染 ----
  console.log('① 当场那一轮（桩：模型只回「围栏 + 一句正话」）');
  await ev(`(function(){
    var RAW = '\\u0060\\u0060\\u0060ggb\\n#清空\\n数轴\\n\\u0060\\u0060\\u0060\\n' + ${JSON.stringify(WORDS)};
    SR.api.ready = function(){ return true; };
    window.fetch = function(){
      var s = 'data: ' + JSON.stringify({choices:[{delta:{content: RAW}}]}) + '\\n\\ndata: [DONE]\\n\\n';
      return Promise.resolve(new Response(s,{status:200,headers:{"Content-Type":"text/event-stream"}}));
    };
    window.__RAW = RAW;
    return 1; })()`);
  await ev('(function(){var i=document.getElementById("input");i.focus();i.value="画一条数轴，标出 -2 和 3";i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
  await sleep(300);
  await ev('document.getElementById("send").click(); 1');
  for (let s = 0; s < 60; s++) { await sleep(400); if (!(await ev('document.getElementById("send").disabled'))) break; }
  await sleep(600);
  const live = await ev('(function(){var b=document.querySelector("#msgs .msg.assistant:last-of-type .bubble");return b?b.innerText:""})()');
  console.log('   当场渲染出来：「' + String(live).replace(/\n/g, ' ⏎ ') + '」');
  ok(String(live).indexOf(HINT) < 0, '当场这条：气泡里没有围栏里的机器话', live);
  ok(String(live).indexOf(WORDS) >= 0, '当场这条：正话还在', live);
  const stored = await ev('(function(){var l=SR.memo.log().filter(function(x){return x.r==="a"});var t=l[l.length-1];return t?t.t:""})()');
  ok(String(stored).indexOf('```ggb') >= 0, 'memo 里存的确实是**带围栏的原文**（不然后面那半没量到）', stored);

  // ---- ② 硬重载 → 重画那条路 ----
  console.log('\n② 刷新之后（重画那条路渲染同一轮）');
  await send('Page.reload', { ignoreCache: true }); await up();
  const after = await ev('(function(){var b=document.querySelector("#msgs .msg.assistant:last-of-type .bubble");return b?b.innerText:""})()');
  const stillThere = await ev('(function(){var l=SR.memo.log().filter(function(x){return x.r==="a"});var t=l[l.length-1];return t?t.t:""})()');
  if (String(stillThere).indexOf('```ggb') < 0) {
    console.log('   ★ 重载后 memo 里那条不见了（别的标签页把它盖了？）——这一半没量到，红验作废');
    await closeTab(t.id); ws.close(); process.exit(2);
  }
  console.log('   刷新后渲染出来：「' + String(after).replace(/\n/g, ' ⏎ ') + '」');
  const same = String(after).replace(/\s+/g, ' ').trim() === String(live).replace(/\s+/g, ' ').trim();
  ok(String(after).indexOf(HINT) < 0, '★ 刷新这条：气泡里也没有机器话', after);
  ok(String(after).indexOf(WORDS) >= 0, '★ 刷新这条：正话还在', after);
  ok(same, '★ 两条路渲染出来的字**一模一样**（同一段原文，刷新前后一个样）', { 当场: live, 刷新后: after });

  console.log('\n' + (RED
    ? (FAIL ? '✓ 红验通过：改回原文渲染，② 当场变红 → 它量的就是那行。'
            : '✗ 红验没红——改回原文它还是绿的，这条断言是恒绿的！')
    : (FAIL ? '✗ 有 ' + FAIL + ' 条没过。' : '✓ 全过（' + PASS + '/' + (PASS + FAIL) + '）。')));
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

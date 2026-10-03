// 首屏在**发送那一刻**收不收起来 —— 一条底线，两态各量一遍。
//
// 为什么非要在浏览器里量：这条底线横跨**两个文件**。
//   landing.js 管"要不要拦"（blocking()：这一场已经有他说过的话，就别拦了），
//   chat.js   管"拦完之后收不收首屏"（submit() 里那一句 hide）。
//   仓库里那把 test/probe_landing.cjs 是 node 侧假 DOM 的，只装 landing.js，
//   装不进 chat.js —— 所以它量不到这条，得回浏览器真跑。
//
// 两态：
//   【新用户】intercept() 归得出工位 → pick() → 首屏在**那一趟**就收了。
//            这条路一直是好的（探针 ③ 号用例量它，当对照）。
//   【刷新回来】memo 把上一场对话接回来 → hasUser() 真 → blocking() 放行
//            （故意放行，不能让首屏把老用户的话吞了），可**没人收首屏**，
//            于是首屏一直盖在对话上：消息照发、画板照画，屏幕上一点变化都没有。
//            2026-10-03 在页面上亲眼见的就是这一屏。② 号用例专盯它——
//            ★ 它排在前头，因为要在**这张标签页刚开的这一屏**上量（见 ② 那段注释）。
//
// ★ 不往 localStorage 写一个字：hasUser 这一态是**在页面里把 SR.chat.hasUser 换掉**
//   造出来的（它在全仓库只有一个读者：landing.js:281）。标签页一关，桩就没了，
//   他浏览器里的记忆不受影响。
// ★ api.ready / fetch 也一并桩掉：这条底线在**发网络请求之前**就判完了，
//   不需要真连模型——也就不会有"网络抖一下判据跟着抖"。
//
// 跑法：
//   node test/probe_landing_send.cjs              绿：三条用例都该过
//   SR_RED=1 node test/probe_landing_send.cjs     红验：把 chat.js 里那一句 hide 摘掉
//                                                 （CDP 换响应，磁盘不动），③ 必须当场变红
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const RED = process.env.SR_RED === '1';
const CHAT = path.join(__dirname, '..', 'js', 'chat.js');
const MARK = '// ---- 首屏还亮着就收起来';
const LINE = 'if (SR.landing && SR.landing.hide) SR.landing.hide();';

// ---- 红验那份改坏的 chat.js：只摘掉这一句（连它上面那段注释），别的一个字不动 ----
let DOCTORED = null;
if (RED) {
  const src = fs.readFileSync(CHAT, 'utf8');
  const a = src.indexOf(MARK);
  if (a < 0) { console.log('★ chat.js 里没找到"' + MARK + '"这一段——红验作废（是不是那句被删了？）'); process.exit(2); }
  const b = src.indexOf(LINE, a);
  if (b < 0) { console.log('★ 注释在、那句 hide 不在——红验作废'); process.exit(2); }
  const s = src.slice(0, a) + '/*红验：这一句被摘掉了*/' + src.slice(b + LINE.length);
  if (s.indexOf(LINE) >= 0) { console.log('★ 摘完还剩一句同名的——红验作废（会假红）'); process.exit(2); }
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 100; i++) { if (await ev('!!(window.SR && SR.chat && SR.landing && SR.board)')) break; await sleep(250); }
  await sleep(1000);

  if (RED && !HIT) { console.log('★ 没拦到 js/chat.js，红验作废'); await closeTab(t.id); ws.close(); process.exit(2); }
  if (RED) console.log('★ 这个标签页跑的 chat.js：**那一句 hide 已被摘掉**（磁盘没动）\n');

  // 量"看得见"只认 getClientRects —— 藏在爹身上的东西 getComputedStyle 会骗人
  const vis = sel => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return !!(e&&e.getClientRects().length>0);})()`);
  const nBub = () => ev('document.querySelectorAll("#msgs .msg").length');

  // ---------------- ① 开场 ----------------
  console.log('① 开场这一屏');
  ok(await vis('#landing') === true, '首屏亮着', await vis('#landing'));
  ok(await vis('#works') === false, '工位那一行这会儿是藏着的（被首屏压着）', await vis('#works'));

  // 桩：断网免抖，并且把"有没有配 Key"这一道让开——这条底线在发请求**之前**就判完了
  await ev(`(function(){
    SR.api.ready = function(){ return true; };
    window.fetch = function(){ var s='data: {"choices":[{"delta":{"content":"嗯"}}]}\\n\\ndata: [DONE]\\n\\n';
      return Promise.resolve(new Response(s,{status:200,headers:{"Content-Type":"text/event-stream"}})); };
    return 1; })()`);

  // ---------------- ② 刷新回来那条（← 今天修的，先量**真现场**）----------------
  // ★ 必须在这张标签页刚开的这一屏上量：intercept() 里 `picked` 一旦立起来就不落了，
  //   那之后再 show() 摆回去，走的就是**另一条**分支（"他点过了"而不是"他有旧对话"），
  //   量的就不是现场那一条了。所以这一节排在最前头。
  console.log('\n② 刷新回来那条：记忆把上一场接回来，首屏也得让开');
  await ev('SR.chat.hasUser = function(){ return true; };');
  const before = await nBub();
  await ev('(function(){var i=document.getElementById("input");i.value="画一个数轴，标出 -2 和 3";i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
  await sleep(250);
  ok(await vis('#landing') === true, '摆好了：发送前，首屏还亮着盖在对话上', await vis('#landing'));
  await ev('document.getElementById("send").click(); 1');
  await sleep(1000);
  ok(await ev('document.body.getAttribute("data-landing")') === null, 'body 上的 data-landing 摘掉了', await ev('document.body.getAttribute("data-landing")'));
  const hid = await vis('#landing');
  ok(hid === false, '★ 首屏收起来了（这一句发出去之前就该收）', hid);
  ok(await nBub() > before, '那一句**真发出去了**（不是被谁吞了才显得"没事"）', [before, await nBub()]);
  ok(await vis('#works') === true, '工位那一行露出来了——换工位照旧跳得过去', await vis('#works'));
  ok(await ev('!!(SR.chat.hasUser && SR.chat.hasUser())') === true, '（收首屏没把老用户那句话拦下来——blocking 照旧）', await ev('!!(SR.chat.hasUser&&SR.chat.hasUser())'));

  // ---------------- ③ 新用户那条路（对照：归得出工位，pick() 里就收了）----------------
  console.log('\n③ 新用户那条：归得出工位，首屏该在 pick() 那一趟就收掉');
  await ev('if(SR.landing&&SR.landing.show) SR.landing.show();');   // 摆回"刚进来、首屏亮着"
  await ev('SR.chat.hasUser = function(){ return false; };');      // ← 桩死，不看这台机器上有没有旧对话
  await sleep(200);
  const r3 = await ev('(function(){var i=document.getElementById("input");i.value="画一个数轴，标出 -2 和 3";return SR.landing.intercept();})()');
  ok(r3 === false, 'intercept() 放行（这一句照发）', r3);
  ok(await vis('#landing') === false, '首屏收起来了', await vis('#landing'));
  ok(await vis('#works') === true, '工位那一行也露出来了', await vis('#works'));

  console.log('\n' + (RED
    ? (FAIL ? '✓ 红验通过：那一句 hide 一被摘掉，② 当场变红 → 它量的就是那一句。'
            : '✗ 红验没红——摘了 hide 它还是绿的，这条断言是恒绿的！')
    : (FAIL ? '✗ 有 ' + FAIL + ' 条没过。' : '✓ 全过（' + PASS + '/' + (PASS + FAIL) + '）。')));
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

// 「刷新回来，带走用的那两颗按钮还在不在」——一条不变量，两态各量一遍。
//
// 为什么要有这条：一条回复上有**两条渲染路**。
//   当场那条（submit 的收尾）走 render.parseFences(...).visible 渲染字，
//   再 attachCopy 挂上「复制这段」＋「打包」；
//   重画那条（repaintLog，刷新页面／切工位走它）原来**只渲染字、什么都不挂**。
//   于是刷新之后：链子一条不少地摆回来了，可两颗"带走"的按钮一条都没有。
//   ★ 「打包」**只长在这同一条 bar 上**（chat.js 里 attachCopy 是它唯一的出生地），
//     bar 没了它就没有第二个入口——而 chat.js 的 seedPack 明明把账本从记忆里
//     重建好了（"刷新之后点打包，包里只有刷新之后那几轮"那段注释就是为它写的），
//     重建出来却没有一颗按钮去点。
//   ★ 只有 copy:true 的工位（备课／讲评）当场才有这条 bar，「关于」里那句
//     「备好的追问链可以「复制这段」带走」说的正是它们。
//
// ★ 这条不变量也不靠嘴说：**摆一份记忆，让产品自己重画一遍**，再数按钮。
//   memo.log() 是桩的——不往他浏览器里写一个字，也不依赖这台机器上那堆残留
//   标签页谁最后写的（它们会互相盖，量出来的条数会飘）。
//
// 还要量住**序号**：打包按钮拿的是"到这一段为止"。这个序号必须跟 seedPack
//   数出来的账本行号同一个顺序，错开一位就会打出一个**看着完整、实际少一段**的包。
//   所以桩掉 SR.pack.make，记下它收到的 upto，跟账本行号对。
//
// 跑法：
//   node test/probe_restore_bar.cjs              绿
//   SR_RED=1 node test/probe_restore_bar.cjs     红验：把 repaintLog 那段改回
//                                                 「只摆字、不挂按钮」（CDP 换响应）
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const RED = process.env.SR_RED === '1';
const CHAT = path.join(__dirname, '..', 'js', 'chat.js');
const MARK = '      if (cfg.copy) attachCopy(b, v, (SR.pack && SR.pack.__seed) ? ai : null);';

let DOCTORED = null;
if (RED) {
  const src = fs.readFileSync(CHAT, 'utf8');
  const a = src.indexOf(MARK);
  if (a < 0) { console.log('★ chat.js 里没找到那段 attachCopy——红验作废'); process.exit(2); }
  const s = src.slice(0, a) + '      /*红验：这段挂按钮被摘掉了*/' + src.slice(a + MARK.length);
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

// 摆好的那一场：三条助手回复，前两条在**备课**（copy:true），第三条在**作图**（不挂）。
const TURNS = [
  { r: 'u', w: 'prep', t: '讲一下这道题' },
  { r: 'a', w: 'prep', t: '```ggb\n#清空\n数轴\n```\n第一节 · 学生大概会说"先把分母去掉"。' },
  { r: 'u', w: 'prep', t: '接着说' },
  { r: 'a', w: 'prep', t: '第二节 · 你接这句："为什么两边都能乘同一个数？"' },
  { r: 'u', w: 'draw', t: '画个图' },
  { r: 'a', w: 'draw', t: '画好了。板子上是一条数轴。' },
];

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
  for (let i = 0; i < 100; i++) { if (await ev('!!(window.SR && SR.chat && SR.memo && SR.pack && SR.render)')) break; await sleep(250); }
  await sleep(1200);
  if (RED && !HIT) { console.log('★ 没拦到 js/chat.js，红验作废'); await closeTab(t.id); ws.close(); process.exit(2); }
  if (RED) console.log('★ 这个标签页跑的 chat.js：**重画那条路上的挂按钮已被摘掉**（磁盘没动）\n');

  // ---- 桩：摆一份记忆，把"刷新回来"那一态造出来 ----
  await ev(`(function(){
    var T = ${JSON.stringify(TURNS)};
    SR.memo.log = function(){ return T.map(function(x){return {r:x.r,t:x.t,w:x.w}}); };
    SR.memo.history = function(){ return T.filter(function(x){return x.r==='u'||x.r==='a'})
      .map(function(x){return {role:x.r==='u'?'user':'assistant',content:x.t}}); };
    SR.memo.pocket = function(){ return { topic:'3.1 代数式的值', cls:'', date:'', marks:{} }; };
    // 拦下真打包：只记它收到的序号，别真去借画板
    window.__UPTO = [];
    SR.pack.make = function(upto, onStep, cb){ window.__UPTO.push(upto); cb({ ok:false, why:'探针拦下了' }); };
    return 1; })()`);
  await ev('SR.chat.reset("prep"); 1');       // ← 走的就是重画那条路
  await sleep(1200);

  console.log('① 重画之后，每一条助手回复底下挂没挂那条 bar');
  const shape = await ev(`(function(){
    return [].slice.call(document.querySelectorAll('#msgs .msg.assistant')).map(function(m,i){
      var bar = m.querySelector('.bubble .copybar');
      return { 第几条:i, 字:(m.querySelector('.bubble')?m.querySelector('.bubble').innerText:'').replace(/\\s+/g,' ').trim().slice(0,26),
               有bar:!!bar, 按钮: bar? [].slice.call(bar.querySelectorAll('button')).map(function(x){return x.innerText.trim()}) : [] };
    }); })()`);
  console.log(JSON.stringify(shape, null, 1));

  ok(shape.length === 3, '三条助手回复都摆回来了', shape.length);
  ok(shape[0] && shape[0].有bar, '★ 备课那一条：bar 摆回来了（复制这段 / 打包）', shape[0] && shape[0].按钮);
  ok(shape[0] && shape[0].按钮.indexOf('复制这段') >= 0, '★ 里面有「复制这段」', shape[0] && shape[0].按钮);
  ok(shape[0] && shape[0].按钮.indexOf('打包') >= 0, '★ 里面有「打包」——它只有这一个入口', shape[0] && shape[0].按钮);
  ok(shape[1] && shape[1].有bar, '★ 备课那条也一样', shape[1] && shape[1].按钮);
  ok(shape[2] && !shape[2].有bar, '作图那条**不该**挂（copy:false，跟当场一致）', shape[2] && shape[2].按钮);
  ok(String(shape[0] && shape[0].字).indexOf('#清空') < 0, '顺带：气泡里没有围栏里的机器话（restoreText 那条还在管用）', shape[0] && shape[0].字);

  console.log('\n② 「打包」拿到的序号，必须跟账本行号同一个顺序');
  const led = await ev('SR.pack.turns().length');
  ok(led === 3, '账本也从记忆里重建出来了（3 行）', led);
  // ⚠ 红态下压根没有 .packbtn —— 别让探针自己炸在这儿，那会把上面已经量到的红盖掉
  await ev('(function(){var m=[].slice.call(document.querySelectorAll("#msgs .msg.assistant"))[1];var b=m&&m.querySelector(".packbtn");if(b)b.click();return !!b})()');
  await sleep(400);
  const upto = await ev('window.__UPTO');
  ok(Array.isArray(upto) && upto.length === 1 && upto[0] === 1,
     '★ 点第二条备课回复的「打包」→ 序号 1（= 它的账本行号，不是 0 也不是 2）', upto);

  await ev('(function(){var m=[].slice.call(document.querySelectorAll("#msgs .msg.assistant"))[0];var b=m&&m.querySelector(".packbtn");if(b)b.click();return !!b})()');
  await sleep(400);
  const upto2 = await ev('window.__UPTO');
  ok(upto2.length === 2 && upto2[1] === 0, '★ 点第一条 → 序号 0', upto2);

  console.log('\n' + (RED
    ? (FAIL ? '✓ 红验通过：把那段挂按钮摘掉，① 当场变红 → 它量的就是那段。'
            : '✗ 红验没红——摘了它还是绿的，这条断言是恒绿的！')
    : (FAIL ? '✗ 有 ' + FAIL + ' 条没过。' : '✓ 全过（' + PASS + '/' + (PASS + FAIL) + '）。')));
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

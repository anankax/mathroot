// 「这一轮收工之后，最后一条回复要整个看得见」——一条不变量，两态各量一遍。
//
// 为什么要有这条：`scroll()`（贴底）在 chat.js 里是**收流过程中**一段一段调的，
//   可这一轮收工之后对话区还会**变矮**一次——「想说」那三颗建议这时候才冒出来，
//   顶在输入框上面，把 #msgs 从底下压掉 53px（实测 1440×900：看得见 541→488）。
//   已经滚到底的那一屏，底部 53px 就这么跑到屏幕外面去了，而且没有任何东西
//   再把它补回来。老师的感受是：**刚收到的那条回复，末尾两行在屏幕外**。
//   ★ 这跟"偶尔"没关系：「想说」是核心协议，多半的回复都带它。
//
// ★ 判据用**几何**，不用嘴说：量 #msgs 的 (scrollHeight - clientHeight - scrollTop)
//   和末条气泡底端比对话区底端高多少。而且必须**在收工那一刻**量——
//   收工标记用产品自己的 `#send.disabled`（chat.js 按下时 true、收工时松开）。
// ⚠ 别在首屏盖着的时候量：css 里 `body[data-landing="1"] #msgs{display:none}`，
//   那时候 clientHeight 恒为 0，"差多少到底" 恒等于 0——一条**恒绿**的假断言。
//   这台探针第一句就把首屏收掉，并且先断言 #msgs 真的看得见（getClientRects）。
//
// 跑法：
//   node test/probe_tail_scroll.cjs              绿
//   SR_RED=1 node test/probe_tail_scroll.cjs     红验：把收工那行 scroll() 摘掉（CDP 换响应）
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const RED = process.env.SR_RED === '1';
const CHAT = path.join(__dirname, '..', 'js', 'chat.js');
const MARK = '      // ---- 收工之后再补最后一次贴底 ----';

let DOCTORED = null;
if (RED) {
  const src = fs.readFileSync(CHAT, 'utf8');
  const a = src.indexOf(MARK);
  if (a < 0) { console.log('★ chat.js 里没找到收工那段注释——红验作废'); process.exit(2); }
  const b = src.indexOf('scroll();', a);
  if (b < 0) { console.log('★ 注释在、那句 scroll() 不在——红验作废'); process.exit(2); }
  const s = src.slice(0, a) + '      /*红验：收工这一句 scroll() 被摘掉了*/' + src.slice(b + 'scroll();'.length);
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

// 一条够长的回复 + 一个「想说」围栏（收工之后才冒出来、把对话区压矮的那三颗）
const BODY = '数轴是一条水平的直线，中间是原点 0，右边是正方向。\n\n'
  + '上面有刻度，每一格代表一个单位长度，箭头表示它往哪个方向延伸。\n\n'
  + '这条说明故意写长：它要让这条气泡占到十来行，好把对话区撑出滚动条——'
  + '短气泡永远贴底，量不出"收工之后又矮了一截"这种事。';
const RAW = '```ggb\n#清空\n数轴\n```\n' + BODY
  + '\n\n```想说\n画个正方体，让它转起来\n换成三维，再画个球\n切回平面，画条数轴加个动点\n```\n';

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
  for (let i = 0; i < 100; i++) { if (await ev('!!(window.SR && SR.chat && SR.memo)')) break; await sleep(250); }
  for (let i = 0; i < 60; i++) { if (await ev('!!document.querySelector("#ggb .applet_scaler.ggbTransform")')) break; await sleep(300); }
  await sleep(1000);
  if (RED && !HIT) { console.log('★ 没拦到 js/chat.js，红验作废'); await closeTab(t.id); ws.close(); process.exit(2); }
  if (RED) console.log('★ 这个标签页跑的 chat.js：**收工那一句 scroll() 已被摘掉**（磁盘没动）\n');

  // ★ 先把首屏收掉——不收就是 display:none，量出来恒为 0（假绿）
  await ev('if(SR.landing&&SR.landing.hide) SR.landing.hide(); 1');
  await sleep(400);
  const rects = await ev('(function(){var p=document.getElementById("msgs");return p.getClientRects().length})()');
  ok(rects > 0, '前提：#msgs 真的看得见（不然下面全是假绿）', rects);

  // 撑一场长对话（借重画那条路），这样最后一条才有被切掉的余地；顺手桩掉 fetch
  await ev(`(function(){
    var T=[]; for (var i=1;i<=6;i++){
      T.push({r:'u',w:'draw',t:'第 '+i+' 步：把这条线再往右挪一点。'});
      T.push({r:'a',w:'draw',t:'画好了。数轴是一条水平的直线，上面有刻度和箭头表示正方向。这条说明故意写长一点，好让气泡占几行。'});
    }
    SR.memo.log=function(){return T};
    SR.memo.history=function(){return T.map(function(x){return {role:x.r==='u'?'user':'assistant',content:x.t}})};
    SR.memo.pocket=function(){return {topic:'撑长用',cls:'',date:'',marks:{}}};
    SR.api.ready=function(){return true};
    window.fetch=function(){ var s='data: '+JSON.stringify({choices:[{delta:{content:${JSON.stringify(RAW)}}}]})+'\\n\\ndata: [DONE]\\n\\n';
      return Promise.resolve(new Response(s,{status:200,headers:{"Content-Type":"text/event-stream"}})); };
    return 1; })()`);
  await ev('SR.chat.reset("draw"); 1');
  await sleep(1500);

  const geom = () => ev(`(function(){var p=document.getElementById('msgs');
    var ms=document.querySelectorAll('#msgs .msg');var last=ms[ms.length-1];
    var lb=last?last.getBoundingClientRect():null, pb=p.getBoundingClientRect();
    return {可滚:p.scrollHeight, 看得见:p.clientHeight,
            差多少到底:Math.round((p.scrollHeight-p.clientHeight)-p.scrollTop),
            末条被切多少:Math.round((lb?lb.bottom:0)-pb.bottom)};})()`);

  const before = await geom();
  ok(before.差多少到底 <= 2, '前提：发之前本来是贴着底的（不然这一条量不出东西）', before);

  // 真发一轮
  await ev('(function(){var i=document.getElementById("input");i.focus();i.value="画一条数轴，标出 -2 和 3";i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
  await sleep(250);
  await ev('document.getElementById("send").click(); 1');
  for (let s = 0; s < 90; s++) { await sleep(400); if (!(await ev('document.getElementById("send").disabled'))) break; }
  const tail = await geom();
  const chips = await ev('document.querySelectorAll("#chips button").length');
  console.log('   收工那一刻：' + JSON.stringify(tail) + '   建议 ' + chips + ' 颗');
  await sleep(1200);
  const later = await geom();
  console.log('   再等 1.2 秒：' + JSON.stringify(later));

  ok(chips === 3, '前提：这一轮真冒出了三颗建议（对话区就是被它们压矮的）', chips);
  ok(before.看得见 > tail.看得见, '前提：收工之后对话区**确实变矮了**（不然这条探针没咬到东西）', { 发之前: before.看得见, 收工: tail.看得见 });
  ok(tail.差多少到底 <= 2, '★ 收工那一刻是贴着底的（末条回复整条看得见）', tail);
  ok(tail.末条被切多少 <= 0, '★ 末条气泡的底边没有越过对话区的底边', tail);
  ok(later.差多少到底 <= 2, '★ 过 1.2 秒还是贴着底（没有后到的内容又把它顶下去）', later);

  console.log('\n' + (RED
    ? (FAIL ? '✓ 红验通过：把收工那句 scroll() 摘掉，★ 那三条当场变红 → 它量的就是那一句。'
            : '✗ 红验没红——摘了它还是绿的，这条断言是恒绿的！')
    : (FAIL ? '✗ 有 ' + FAIL + ' 条没过。' : '✓ 全过（' + PASS + '/' + (PASS + FAIL) + '）。')));
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

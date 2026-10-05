// 「刷新回来，带走用的东西还在不在」——一条不变量，两态各量一遍。
//
// 为什么要有这条：一条回复上有**两条渲染路**。
//   当场那条（submit 的收尾）走 render.parseFences(...).visible 渲染字，
//   再 attachCopy 挂上「复制这段」；
//   重画那条（repaintLog，刷新页面／切工位走它）原来**只渲染字、什么都不挂**。
//   于是刷新之后：链子一条不少地摆回来了，可"带走"的按钮一条都没有。
//   ★ 只有 copy:true 的工位（备课／讲评）当场才有那条 bar，「关于」里那句
//     「备好的追问链可以「复制这段」带走」说的正是它们。
//
// ★★ 2026-10-05 这一格**改过口径**（孔老师把「打包」搬去了绿行，见 js/packui.js）：
//   原来这儿量的两颗都在那条 bar 上；现在 bar 上只剩「复制这段」，
//   而"带走"这条不变量拆成了两半——
//     · 「复制这段」 —— 还是重画那条路欠的**同一笔债**（① 量的就是它）；
//     · `data-turn` —— **新增的债**。绿行那颗「打包」和挑选模式全靠这个号：
//       号没挂上，圆圈一个都长不出来（② 量它）。⚠ 它跟 copy 那道闸**无关**，
//       三条回复**全都要有**（第三条在命题工位，没有 bar，但绿行照样勾得到它）。
//   ⇒ 红验（SR_RED=1）也从"摘掉挂按钮"改成了"摘掉挂 data-turn"，
//     因为前者现在只影响 ① 的一条，后者才是这次改动真正的正身。
//
// ★ 这条不变量也不靠嘴说：**摆一份记忆，让产品自己重画一遍**，再数按钮。
//   memo.log() 是桩的——不往他浏览器里写一个字，也不依赖这台机器上那堆残留
//   标签页谁最后写的（它们会互相盖，量出来的条数会飘）。
//
// 还要量住**序号**：勾一条回答，传下去的那个号必须跟 seedPack 数出来的账本行号
//   同一个顺序，错开一位就会打出一个**看着完整、其实少一条**的包。
//   所以桩掉 SR.pack.make，记下它收到的 sel，跟账本行号对。
//
// 跑法：
//   node test/probe_restore_bar.cjs              绿
//   SR_RED=1 node test/probe_restore_bar.cjs     红验：把 repaintLog 里挂 data-turn
//                                                 那半句摘掉（CDP 换响应，磁盘不动）
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const RED = process.env.SR_RED === '1';
const CHAT = path.join(__dirname, '..', 'js', 'chat.js');
const MARK = "      if (b && SR.pack && SR.pack.__seed) b.setAttribute('data-turn', String(ai));";

let DOCTORED = null;
if (RED) {
  const src = fs.readFileSync(CHAT, 'utf8');
  const a = src.indexOf(MARK);
  if (a < 0) { console.log('★ chat.js 里没找到挂 data-turn 那半句——红验作废'); process.exit(2); }
  const s = src.slice(0, a) + '      /*红验：这半句挂 data-turn 被摘掉了*/' + src.slice(a + MARK.length);
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

// 摆好的那一场：三条助手回复，前两条在**备课**（copy:true），第三条在**命题**（没有 copy）。
// ★ 第三条**原来摆的是作图**，2026-10-05 换成命题了 —— 那天这条断言报红，查下去
//   不是产品坏了，是**前提过期了**：作图工位 2026-10-03 起带上了 `copy: true`
//   （config.js:344，"存图"恰恰是作图最想要的），所以它当场就**该**挂 bar。
//   ⇒ 尺子量的东西被人挪走了，读数还照样合情合理（同族：[[scanner-numbers-are-not-what-they-claim]]）。
//     `vary` 命题 / `grade` 学情 两格至今都没有 copy，拿它们验"没 copy 就不挂"才作数。
const TURNS = [
  { r: 'u', w: 'prep', t: '讲一下这道题' },
  { r: 'a', w: 'prep', t: '```ggb\n#清空\n数轴\n```\n第一节 · 学生大概会说"先把分母去掉"。' },
  { r: 'u', w: 'prep', t: '接着说' },
  { r: 'a', w: 'prep', t: '第二节 · 你接这句："为什么两边都能乘同一个数？"' },
  { r: 'u', w: 'vary', t: '来几道变式' },
  { r: 'a', w: 'vary', t: '变式一：把 3 换成 5，其余不动。' },
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
  // ★★ 等的**不是** `SR.*` 在不在 —— 那几件是 defer 脚本一执行就有了，
  //   而开机 `SR.main.boot()` 挂在 DOMContentLoaded 上、前面还压着一道
  //   "等第三方库（最多 8 秒）"的闸门（见 index.html / main.js 末尾那段）。
  //   只等 SR.* 的话，下面 `SR.chat.reset()` 会在 boot 还没跑的时候被调：
  //   `els.msgs` 还是 undefined，报一句 "Cannot set properties of undefined"。
  //   ⇒ 这条探针**一直**是这么炸的（记录里"两态都崩"就是它），
  //     而崩的原因是**尺子起跑太早**，不是产品坏了。
  //   等 `#msgs` 里真出现了消息（开场白或摆回来的那一场），boot 就一定跑完了。
  for (let i = 0; i < 120; i++) {
    if (await ev('!!(window.SR && SR.chat && SR.memo && SR.pack && SR.render && SR.packui && document.querySelector("#msgs .msg"))')) break;
    await sleep(250);
  }
  await sleep(400);
  if (RED && !HIT) { console.log('★ 没拦到 js/chat.js，红验作废'); await closeTab(t.id); ws.close(); process.exit(2); }
  if (RED) console.log('★ 这个标签页跑的 chat.js：**重画那条路上挂 data-turn 的那半句已被摘掉**（磁盘没动）\n');

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
  ok(shape[0] && shape[0].有bar, '★ 备课那一条：bar 摆回来了', shape[0] && shape[0].按钮);
  ok(shape[0] && shape[0].按钮.indexOf('复制这段') >= 0, '★ 里面有「复制这段」', shape[0] && shape[0].按钮);
  ok(shape[0] && shape[0].按钮.indexOf('打包') < 0, '★ 里面**不再**有「打包」（它搬去绿行了，见 js/packui.js）', shape[0] && shape[0].按钮);
  ok(shape[1] && shape[1].有bar, '★ 备课那条也一样', shape[1] && shape[1].按钮);
  ok(shape[2] && !shape[2].有bar, '命题那条**不该**挂（没有 copy，跟当场一致；★作图那条现在是**该**挂的）', shape[2] && shape[2].按钮);
  ok(String(shape[0] && shape[0].字).indexOf('#清空') < 0, '顺带：气泡里没有围栏里的机器话（restoreText 那条还在管用）', shape[0] && shape[0].字);

  console.log('\n② 账本行号必须钉在**每一条**助手回复上（绿行的勾选全靠它）');
  const led = await ev('SR.pack.turns().length');
  ok(led === 3, '账本也从记忆里重建出来了（3 行）', led);
  const turnIds = await ev(`(function(){
    return [].slice.call(document.querySelectorAll('#msgs .msg.assistant')).map(function(m){
      var b = m.querySelector('.bubble[data-turn]');
      return b ? Number(b.getAttribute('data-turn')) : null;
    }); })()`);
  ok(JSON.stringify(turnIds) === '[0,1,2]',
     '★ 三条**全都有号**（命题那条也在——它没有 bar，可绿行照样勾得到它）', turnIds);

  console.log('\n③ 绿行上勾一条 → 传下去的就是那一条的号');
  const strip = await ev(`(function(){
    var s = document.getElementById('onep'), pk = document.getElementById('op-pack'), pi = document.getElementById('op-pick');
    return { strip: !!s, pk: !!pk, pi: !!pi,
             pkText: pk ? String(pk.textContent).trim() : '', piText: pi ? String(pi.textContent).trim() : '' };
  })()`);
  ok(strip.strip && strip.pk && strip.pi, '★ 绿行上那两颗按钮在', strip);
  ok(strip.pkText === '打包 (3)', '★ 「打包」报的是账本里几条（刷新回来数得对）', strip.pkText);

  await ev("document.getElementById('op-pick').click(); 1");
  await sleep(200);
  const nBox = await ev('document.querySelectorAll("#msgs .pickbox").length');
  ok(nBox === 3, '★ 三个圆圈都长出来了', nBox);

  // ⚠ 红态下一条号都没有、圆圈一个也长不出来——别让探针自己炸在这儿，
  //   那会把上面已经量到的红盖掉（同族：读数合情合理却是别人那页的）。
  await ev(`(function(){
    var m = [].slice.call(document.querySelectorAll('#msgs .msg.assistant')).filter(function(x){
      return x.querySelector('.bubble[data-turn]'); })[1];
    if (m) { var c = m.querySelector('.pickbox'); if (c) c.click(); }
    return 1; })()`);
  await sleep(150);
  await ev("document.getElementById('op-pack').click(); 1");
  await sleep(400);
  const upto = await ev('window.__UPTO');
  ok(Array.isArray(upto) && upto.length === 1 && JSON.stringify(upto[0]) === '[1]',
     '★ 勾第二条 → 传下去的是 [1]（= 它的账本行号，不是 0 也不是 2）', upto);

  // 第二下：把刚才那条**取消**，改勾第一条 —— 既量了"取消真的取消得掉"，
  // 又量了"换一条换得对"（只勾上不会取消的话，这一下会传 [0,1]）。
  await ev(`(function(){
    var m = [].slice.call(document.querySelectorAll('#msgs .msg.assistant')).filter(function(x){
      return x.querySelector('.bubble[data-turn]'); })[1];
    if (m) { var c = m.querySelector('.pickbox'); if (c) c.click(); }
    return 1; })()`);
  await sleep(150);
  await ev(`(function(){
    var m = [].slice.call(document.querySelectorAll('#msgs .msg.assistant')).filter(function(x){
      return x.querySelector('.bubble[data-turn]'); })[0];
    if (m) { var c = m.querySelector('.pickbox'); if (c) c.click(); }
    return 1; })()`);
  await sleep(150);
  const checked = await ev('SR.packui.__checked()');
  ok(JSON.stringify(checked) === '[0]', '★ 取消第二条、改勾第一条 → 只剩 [0]', checked);
  await ev("document.getElementById('op-pack').click(); 1");
  await sleep(400);
  const upto2 = await ev('window.__UPTO');
  ok(upto2.length === 2 && JSON.stringify(upto2[1]) === '[0]', '★ 第二下传下去的是 [0]', upto2);

  console.log('\n' + (RED
    ? (FAIL ? '✓ 红验通过：把挂 data-turn 那半句摘掉，②③ 当场变红 → 它们量的就是那半句。'
            : '✗ 红验没红——摘了它还是绿的，这条断言是恒绿的！')
    : (FAIL ? '✗ 有 ' + FAIL + ' 条没过。' : '✓ 全过（' + PASS + '/' + (PASS + FAIL) + '）。')));
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

// 流水线面板：**屏幕上那一排，是不是账本里那一排。**
//
// 为什么这一步非要在浏览器里量（node 里那些探针量不了它）：
//   test/probe_flow.cjs 量的是账本（纯函数，node 里跑得了）。可**账本和面板是两份东西**：
//   账本里 store 的是 state:'stale'，面板上要变成一颗 ↻ 加两个字「得重来」、
//   还要多出一颗「重跑」按钮。这两份之间隔着 render / stamp 一整套映射——
//   而它坏了的样子是：**面板看着挺正常**，只是某一格亮错了颜色、
//   或者「重跑」按钮压根没出现（那一步他就再也点不动，而且他不会怀疑是按钮没画出来，
//   只会觉得"这一步就是不能重跑"）。
//
// ★ 它判的是"面板跟账本一致"。**它不判这条流水线分得对不对**——
//   那是你真实走一轮才看得出来的（计划文件验收那节：人看）。
//
// ★ 这一把尺子有几处是**关系式**断言，不是写死值，说明一下为什么：
//   ① 显隐：不写"prep 该亮"，而是拿 SR.WORKS 里每个工位自己的 retrieve 开关去比。
//      因为"哪几个工位要流水线"是产品里那个开关说了算（js/flow.js 的 setWork 就是
//      这么判的），写死工位名等于把答案抄进考题。
//   ② 出处：不写"必须是本机"，只写"得是 云上/本机 里的一档，而且跟账本那一格一模一样"。
//      云函数配没配、这台机器上有没有课本原文，都会让它改口——那正是这一步要显示的东西。
//
// ★ 量"看得见吗"一律量 getClientRects()，**不量 getComputedStyle().display**——
//   `.flowbox` 默认 display:none 是它自己身上那条 CSS，可下面那几格是**爹藏了孩子照样报 flex**。
//   （这条坑见 test/probe_tplrow.cjs 顶上那段，同一个家族。）
//
// 用法（先 node test/serve.cjs 8138，Chrome 开着 9222）：
//   node test/probe_flow_panel.cjs
// 退出码：0 = 都对；1 = 有地方对不上；2 = 探针自己炸了；3 = 尺子坏了（仪器不在）

const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';

// ============================================================
//  红验模式：RED=1
// ============================================================
// ★ 为什么红验要绕这么大的弯（用 CDP 拦截响应），而不是直接改 js/flow.js：
//   **那是产品正身，探针不该去动它**——"不许擅自改用户的东西"这条对自己一样成立。
//   而且"改一下、验完再改回来"这个做法有个更实的坏处：中途一旦没走到还原那一步
//   （脚本挂了、我被打断），他手上那份**就已经是坏的**，而且看着还挺正常。
//   所以这里把改坏的那一份只喂给这一个标签页，磁盘上那个字节不动。
//
// ★ 三处破坏各自对应一组断言，一处都不许落空：
//   ① 状态词都画成"已完成"  → B（面板跟账本逐格对）必须红
//   ② 产物改走 innerHTML     → C（尖括号不许被当 HTML）必须红
//   ③ 流水线永远亮着         → A（显隐跟工位的 retrieve 走）必须红
//   ★ 每一处替换都**断言"确实改到了"**：没改到就直接退出，
//     否则又是在没改的那份上跑出全绿——"假绿"这一坑今天已经栽过两次。
const RED = !!process.env.RED;
let SAB = null, SAB_WHY = [], SAB_HIT = false;
if (RED) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'js', 'flow.js'), 'utf8');
  // ⚠ 搜索串必须**逐字照源码**：第一版我写成 `'st-' + s.state`（多了一个前引号），
  //   而源码里是 `'fstep st-' + s.state`——那个引号在 `fstep ` 前面，
  //   所以 `'st-` 这一段**根本不连着存在**。幸好下面那道"没改到就退出"的闸把它拦住了，
  //   报的是"红验作废"而不是一片假绿。（同一个家族：**以为在量 A，其实没量到 A**。）
  const cuts = [
    ["'fstep st-' + s.state", "'fstep st-done'", '状态词都画成已完成'],
    ['e.textContent = String(text);', 'e.innerHTML = String(text);', '产物改走 innerHTML'],
    ["document.body.setAttribute('data-flow', on ? 'on' : 'off');",
      "document.body.setAttribute('data-flow', 'on');", '流水线永远亮着'],
  ];
  for (const [a, b, why] of cuts) {
    if (s.indexOf(a) < 0) {
      console.log('★ 破坏「' + why + '」一处都没改到，红验作废（不做红验就没法信绿）：' + a);
      process.exit(2);
    }
    s = s.replace(a, b); SAB_WHY.push(why);
  }
  // ★ 换上去的必须是一份**能跑的坏**，不是一份语法错的坏：
  //   语法错的话页面一加载就白屏，探针会满屏红——看着像"尺子灵"，
  //   其实它量的是"页面挂了"。所以这里先替 V8 读一遍。
  try { new Function(s); } catch (e) {
    console.log('★ 改坏的那份自己就编译不过（红验作废，那不是产品坏，是脚本坏）：' + e.message);
    process.exit(2);
  }
  SAB = s;
}

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}
function closeTab(tid) {
  return new Promise(res => {
    const r = http.request({ host: 'localhost', port: 9222, path: '/json/close/' + tid, method: 'GET' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', () => res(null)); r.end();
  });
}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    // 红验：把 js/flow.js 这一个响应换掉，别的原样放过（continueRequest）。
    if (r.method === 'Fetch.requestPaused' && r.params) {
      const p = r.params;
      if (SAB && /\/js\/flow\.js(\?|$)/.test(p.request.url)) {
        SAB_HIT = true;
        send('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'text/javascript; charset=utf-8' },
            { name: 'Cache-Control', value: 'no-store' }],
          body: Buffer.from(SAB, 'utf8').toString('base64'),
        });
      } else {
        send('Fetch.continueRequest', { requestId: p.requestId });
      }
      return;
    }
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; }
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  if (RED) {
    console.log('⚠⚠ 红验模式：这一趟跑的 js/flow.js 被换成了改坏的那一份 —— ' + SAB_WHY.join('；'));
    console.log('    （磁盘上那个文件一个字节都没动）\n');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*js/flow.js*', requestStage: 'Request' }] });
  }
  // ★ 页面里抛出来的异常**直接扔上来**，不返回一个 'THROW: …' 字符串。
  //   返回字符串那一版会让"某处炸了"变成"拿到一个看着像值的字符串"，
  //   后面每一条断言都拿着它去比，红的样子跟产品坏了长得一样。
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) {
      throw new Error('页面里炸了：' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    }
    return R && R.result ? R.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 等一个条件成立（render 是 setTimeout(0) 合并过的，改完账本不能立刻读 DOM）
  const until = async (expr, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) { if (await q(expr)) return true; await wait(120); }
    return false;
  };
  // 真鼠标点一下（不是 el.click()）——省得日后有人把它接到要用户手势的东西上
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', clickCount: 1 });
  };

  // ★★ 2026-10-03 补两件，都是**尺子自己的毛病**，产品一个字没改：
  //  ① 窗宽写死。原来这一把**不设窗宽**——量的是"他那扇 Chrome 窗口现在多宽"（实测 1707）。
  //     等于把判据挂在他随手拉的窗口尺寸上：他要是把窗拖窄过 900px，单栏规矩一生效、
  //     右栏整个收起来，下面每一条"看得见吗"都会红，而红的样子跟"产品坏了"长得一模一样。
  //     （同族：写死的件数在"加一件"那天报成"仪器不对"。）
  //  ② 收首屏。首屏（`body[data-landing="1"]`）的规矩是 **`.side{display:none}`**，
  //     而 `.flowbox` 正好是这个文件顶上专门写过的那条坑——"爹藏了孩子照样报 flex"。
  //     首屏是后加的（这把尺子写的时候，右栏一开页就露着），所以它量到的是
  //     "`.flowbox` 自己 display=flex、`getClientRects()` 却是 0"。**藏它的那个爹就是首屏。**
  //     首次实测（2026-10-03）：8 条红里有 5 条出自这一条，没有一条是产品坏了。
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.flow&&SR.WORKS&&SR.chat)')) break; await wait(500); }
  await wait(1200);
  await q('(function(){ if (window.SR && SR.landing && SR.landing.hide) SR.landing.hide(); })()');
  await wait(600);
  // ★ 自检：右栏真露出来了，才往下判。没露出来的话下面全是**假红**——
  //   而"假红"最坏的地方不是白跑一趟，是它跟"产品坏了"长得一样，看久了就没人看红了。
  const sideSeen = await q('(function(){var s=document.querySelector(".side");return !!s && s.getClientRects().length>0;})()');
  ok('★ 对照：右栏真露出来了（没露的话下面每一条"看得见吗"都是假红）', sideSeen === true, sideSeen);

  const host = await q('location.host');
  console.log('这一趟跑在 : ' + host + '\n');

  // ---------- ⓪ 仪器 ----------
  const inst = await q('({box:!!document.getElementById("flowbox"),list:!!document.getElementById("flowlist"),'
    + 'hint:!!document.getElementById("flowhint"),f:typeof SR.flow.start,p:typeof SR.flow.staleAfter,'
    + 'i:typeof SR.flow.init,works:Object.keys(SR.WORKS||{})})');
  console.log('⓪ 仪器在不在');
  const missing = ['box', 'list', 'hint'].filter(k => !inst[k])
    .concat(['f', 'p', 'i'].filter(k => inst[k] !== 'function'));
  if (missing.length || !inst.works.length) {
    console.log('★ 仪器不对，先别往下判：' + JSON.stringify(inst));
    console.log('  缺的是 ' + (missing.join('/') || '（工位表）') + '。缺一大堆多半是页面没起来（8138 起了吗？9222 是这个 profile 吗？）。');
    await closeTab(t.id); ws.close(); process.exit(3);
  }
  ok('三块 DOM（.flowbox / #flowlist / #flowhint）和 SR.flow 那几个口子都在', true);
  // 对照：证明这一页真是产品那一页，不是个空壳（空壳也能让上面那条"通过"）
  // ★ 2026-10-03：原来写死 `ctrl.n === 5`（那时候五个工位）。加了「学情」之后它是 6，
  //   这条当场红——**红的是这个写死的 5，不是产品**。改成关系式：屏幕上那一行工位按钮，
  //   跟 `SR.WORK_ORDER`（工位顺序与名字的唯一真相）逐颗对得上。
  const ctrl = await q('({n:Object.keys(SR.WORKS).length, order:(SR.WORK_ORDER||[]).length,'
    + 'btns:document.querySelectorAll("#works .workbtn").length,'
    + 'badge:((document.getElementById("badge")||{}).textContent||"").trim().length})');
  ok('★ 对照：这一页真是产品那一页（工位按钮跟 SR.WORK_ORDER 逐颗对得上 + 状态栏有字）',
    ctrl.n > 0 && ctrl.btns === ctrl.n && ctrl.n === ctrl.order && ctrl.badge > 0, ctrl);

  // ---------- A. 显隐跟着工位自己的开关走 ----------
  // ★ 关系式：不写死哪个工位该亮，拿 SR.WORKS 每个工位身上的 retrieve 去比。
  //   （写死工位名＝把答案抄进考题；而且流水线该不该出现在某个工位上，
  //     判据本来就是那个开关，见 js/flow.js 的 setWork。）
  console.log('\nA. 流水线该亮的时候亮、该收的时候收（判据＝工位自己的 retrieve）');
  const wasWork = await q('document.body.getAttribute("data-work")');
  const table = await q('(function(){var out={};'
    + 'var names=Object.keys(SR.WORKS);'
    + 'var body=document.body, box=document.getElementById("flowbox");'
    + 'names.forEach(function(w){SR.flow.setWork(w);'
    + 'out[w]={retrieve:!!SR.WORKS[w].retrieve, attr:body.getAttribute("data-flow"),'
    + 'rects:box.getClientRects().length, own:getComputedStyle(box).display};});'
    + 'SR.flow.setWork(' + JSON.stringify(wasWork) + ');'
    + 'return out;})()');
  for (const w of Object.keys(table)) {
    const x = table[w];
    ok('[' + w + '] retrieve=' + x.retrieve + ' → data-flow=' + x.attr + '，盒子数 ' + x.rects,
      x.attr === (x.retrieve ? 'on' : 'off') && (x.rects > 0) === x.retrieve, x);
  }
  const boxBack = await q('({attr:document.body.getAttribute("data-flow"),work:document.body.getAttribute("data-work"),'
    + 'rects:document.getElementById("flowbox").getClientRects().length})');
  ok('★ 探针把工位放回了原样（不留改动）', boxBack.work === wasWork, boxBack);
  // ★ 顺带记一笔：这条 CSS 是"藏在爹身上还是自己身上"这件事的现场证据。
  //   要是哪天显隐改成写在内层，这里量到的 box 自己的 display 会一直是 none，
  //   可它孩子照样报 flex——那时这段日志会先显出不对。
  console.log('    （.flowbox 自己的 display：' + JSON.stringify(
    Object.keys(table).map(w => w + ':' + table[w].own)) + '；还原后盒子数 ' + boxBack.rects + '）');
  // 让流水线是亮着的状态跑下面几段（本机开局多半停在 prep，本来就亮）
  await q('SR.flow.setWork("prep")');

  // ---------- B. 面板画的是不是账本说的那件事 ----------
  console.log('\nB. 面板上每一格，跟账本里那一格对不对得上');
  await q('SR.flow.reset(); window.__pr = SR.flow.start("prep","我不会画数轴");');
  await q('SR.flow.retrieve(window.__pr,"我不会画数轴").then(function(){return true;})');
  await until('!!document.querySelector("#flowlist .fround")');
  const pair = await q('(function(){'
    + 'var r=window.__pr, rows=document.querySelectorAll("#flowlist .fstep");'
    + 'if(rows.length!==r.steps.length)return {count:rows.length,want:r.steps.length,same:false};'
    + 'var bad=[];'
    + 'for(var i=0;i<rows.length;i++){'
    + 'var s=r.steps[i], row=rows[i];'
    + 'var cls=(row.className||""), name=(row.querySelector(".fname")||{}).textContent;'
    + 'var tag=(row.querySelector(".t-route")||{}).textContent;'
    + 'var noteEl=row.querySelector(".fnote"), note=noteEl?noteEl.textContent:null;'
    + 'var hitCls=cls.indexOf("st-"+s.state)>=0, hitName=name===s.name, hitTag=tag===s.route;'
    + 'var hitNote=(s.note?note===s.note:true);'
    + 'if(!(hitCls&&hitName&&hitTag&&hitNote))bad.push({i:i,id:s.id,state:s.state,cls:cls,'
    + 'name:name,wantName:s.name,tag:tag,wantTag:s.route,note:note,wantNote:s.note});}'
    + 'return {count:rows.length,want:r.steps.length,same:bad.length===0,bad:bad,'
    + 'states:r.steps.map(function(s){return s.id+":"+s.state;}).join(" ")};})()');
  // （★ 那句"正好六格"是旧的措辞：账本早就不是六步了。断言本来就是关系式，留着改个说法，
  //   别让标签里那个数字撒谎——同一家族里"标签说六、实际七"也是会带人走错的一种。）
  ok('★ 面板上格数 = 账本步数，一格不多一格不少（当前 ' + pair.want + ' 步）',
    pair.count === pair.want, pair);
  ok('★ 每一格的状态词、步名、出处标签、说明，跟账本逐格一样',
    pair.same === true, pair.bad);
  console.log('    账本里的状态：' + pair.states);

  // ---------- C. 产物：原生 details，而且**不许当 HTML 解析** ----------
  // ★ 这条是真在验注入：out 里装的是**课本原文和模型自己生成的字**，
  //   塞进 innerHTML 就是把别人的字当代码跑。所以喂一段带标签的字进去，
  //   它必须原样显示、一个元素都不许生出来。
  console.log('\nC. 每步产物的抽屉');
  const inj = await q('(function(){'
    + 'SR.flow.done(window.__pr,"textbook",{out:"<b>粗</b><img src=x onerror=\\"window.__probeX=1\\">",note:"探针"})'
    + ';return true;})()');
  // ⚠⚠ 必须**指名那一格**（翻教材是第 2 格），不能 `document.querySelector("#flowlist .fout pre")`：
  //   那是屏幕上第一份产物，也就是**凑话**那一步的（内容正好是那句学生的话）。
  //   第一次跑就是这么红的——尺子报"产物里的尖括号被当 HTML 吃了"，
  //   其实它压根没看我注进去的那一格。**又是一次"量到的不是它宣称的那个东西"**。
  await until('!!document.querySelectorAll("#flowlist .fstep")[1].querySelector(".fout pre")');
  const drawn = await q('(function(){'
    + 'var row=document.querySelectorAll("#flowlist .fstep")[1];'
    + 'var d=row.querySelector("details.fout");'
    + 'var pre=d?d.querySelector("pre"):null;'
    + 'var tag=(d&&d.querySelector("summary"))?d.querySelector("summary").textContent:null;'
    + 'return {step:(row.querySelector(".fname")||{}).textContent, text:pre?pre.textContent:null, tag:tag,'
    + 'elems:pre?pre.querySelectorAll("*").length:-1,'
    + 'injected:typeof window.__probeX};})()');
  ok('★ 量的是「翻教材」那一格的产物（不是屏幕上第一份产物）',
    drawn.step === '翻教材索引', drawn.step);
  ok('★ 产物的抽屉是原生 details（不用写开合的 JS，键盘也点得动）',
    !!(await q('(function(){var r=document.querySelectorAll("#flowlist .fstep")[1];'
      + 'return !!(r&&r.querySelector("details.fout > summary"));})()')), drawn.tag);
  ok('★ 抽屉上写着这一步产物有多少字', /这一步的产物（\d+ 字）/.test(String(drawn.tag)), drawn.tag);
  ok('★★ 产物里的尖括号**原样显示**，没有被当 HTML 解析（一个元素都没生出来）',
    drawn.text && drawn.text.indexOf('<b>') >= 0 && drawn.elems === 0, drawn);
  // ★ 说清楚这两条里哪一条是**敏感**的那条：红验时（把 textContent 换成 innerHTML）
  //   红的是上面 elems 那条；这一条**没红**——img 在没展开的 details 里没去加载，
  //   onerror 本来就不会响。留着它是上保险，但**别把它当成"注入验过了"的证据**。
  ok('★★ 产物里的 onerror 一个字都没执行（上保险的一条，敏感的是上面 elems 那条）',
    drawn.injected === 'undefined', drawn.injected);
  await q('delete window.__probeX;');

  // ---------- D. 「重跑」：哪几格有、点下去账本跟不跟着动 ----------
  console.log('\nD. 「重跑」那颗按钮');
  await q('SR.flow.done(window.__pr,"prompt",{out:"（提示词）",note:"x 字"});'
    + 'SR.flow.done(window.__pr,"reply",{out:"（回话）"});'
    + 'SR.flow.paintDone("摆完了");');
  await until('document.querySelectorAll("#flowlist .fbtn.flink").length>0');
  const btns = await q('(function(){var rows=document.querySelectorAll("#flowlist .fstep");var got=[];'
    + 'for(var i=0;i<rows.length;i++){'
    + 'var b=rows[i].querySelector(".fbtn.flink");'
    + 'if(b)got.push({i:i,id:window.__pr.steps[i].id,rerun:!!window.__pr.steps[i].rerun});}return got;})()');
  // ★ 2026-10-03：原来写死「长度===2 且恰好是 textbook,zhuawen」。加了「翻素材库」
  //   那一步（reslib，它的产物翻歪了同样得能单独重跑）之后这里变成 3 颗，当场红——
  //   又是**写死的件数**，不是产品。按这把尺子顶上声明的契约改：
  //   它判的是"**面板跟账本一致**"（不是"流水线分得对不对"），所以判**一一对应**：
  //   账本里标了能重跑的，面板上就得有那颗按钮；面板上有按钮的，账本里就得标着能重跑。
  //   当前是哪几步**打印出来给人看**，不写成断言——口径真改了，屏幕上一眼看得到，
  //   不必让这条报成"仪器不对"。
  const rerunWant = await q('window.__pr.steps.filter(function(s){return s.rerun;}).map(function(s){return s.id;}).join(",")');
  ok('★ 面板上的「重跑」跟账本里标了能重跑的那几步一一对应（当前账本是 ' + rerunWant + '）',
    btns.length > 0 && btns.every(b => b.rerun) && btns.map(b => b.id).join(',') === rerunWant,
    { 面板上的: btns.map(b => b.id), 账本里的: rerunWant });
  // 真鼠标点「翻教材」那一颗
  const spot = await q('(function(){var rows=document.querySelectorAll("#flowlist .fstep");'
    + 'var b=rows[1].querySelector(".fbtn.flink");if(!b)return null;'
    + 'b.scrollIntoView({block:"center"});var r=b.getBoundingClientRect();'
    + 'return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width)};})()');
  ok('★ 那颗按钮真的画在屏幕上有面积（不是个 0×0 的空壳）',
    !!spot && spot.w > 0, spot);
  if (spot && spot.w > 0) {
    await clickAt(spot.x, spot.y);
    await until('SR.flow.at(window.__pr,"prompt").state==="stale"', 12000);
  }
  const after = await q('(function(){var r=window.__pr;'
    + 'return {states:r.steps.map(function(s){return s.id+":"+s.state;}).join(" "),'
    + 'recall:SR.flow.at(r,"recall").state, text:SR.flow.at(r,"textbook").state,'
    // ★ 2026-10-03：这里原来写死**下标 3**（那时候 prompt 排第 4 格）。
    //   中间插进 reslib 之后下标 3 落到它身上（`st-skip`），这条于是报"面板没重画"——
    //   又一次**写死的下标**。改成按 id 找那一格，插入多少步都不会再错位。
    + 'cls:(function(){var i=0,k=r.steps;for(var j=0;j<k.length;j++){if(k[j].id==="prompt"){i=j;break;}}'
    + 'var row=document.querySelectorAll("#flowlist .fstep")[i];return row?row.className:"";})(),'
    + 'foot:!!document.querySelector("#flowlist .ffoot"),'
    + 'footBtn:!!document.querySelector("#flowlist .ffoot .fbtn")};})()');
  ok('★ 点下去真跑了：翻教材这一步回到 done，而下游三步变成 stale',
    after.text === 'done' && after.states.indexOf('prompt:stale') >= 0 &&
    after.states.indexOf('reply:stale') >= 0 && after.states.indexOf('paint:stale') >= 0, after.states);
  ok('★ 前面那一步一个字没动（凑话仍是 done）', after.recall === 'done', after.states);
  ok('★ 面板跟着重画了（拼提示词那一行现在挂着 st-stale）',
    String(after.cls).indexOf('st-stale') >= 0, after.cls);
  ok('★ 底下多出那条提示 + 一颗「拿新的重问一轮」',
    after.foot === true && after.footBtn === true, after);

  // ---------- F. 云上那一步：这趟真调一次 gate ----------
  // 孔老师这句话的正身：「不要只是本机，应该是在我云知识库调取苏科版这些东西才对吧」。
  // 所以这一段的判据不是"面板画得像云上"，而是**云函数真的把苏科版那几条送回来了**。
  //
  // ★★ 这段**只在这一页的来源是白名单来源时才量**（线上那一页就是）。
  //   在 localhost 上它量不了，而且**不是产品坏了**——2026-10-02 实测：
  //   腾讯云网关对 localhost 那个来源，在预检里回了两个 Access-Control-Allow-Origin
  //   （它自己回显一个 `http://localhost:8138`、我们函数那个 `*` 又带出去一个），
  //   Chrome 判 MultipleAllowOriginValues，请求**根本没到函数**就被浏览器拦掉。
  //   同一发请求从 https://anankax.github.io 那一页发出去 → HTTP 200、via:"gate"、
  //   命中「苏科版·七上 2.2 数轴」score 5.529467627748627（curl 还不带 Origin 时看不出这个重复，
  //   只有 Chrome 那边看得见；这是网关自家的事，从外面看不透）。
  //   ⚠ 所以本机这一支**既不回绿也不回红**：回绿是撒谎（请求压根没出去），
  //     回红会变成"长期假红"（红的样子跟产品坏了长得一样，看久了就没人看了）。
  //     它今天在本机**没被量过**，就该这么写着。
  // ★ 这道门槛（"不带 Referer 的脚本必须被拒"）**不在浏览器里量**——那是脚本的事，
  //   归 test/probe_gate_door.cjs 在 node 里直接问云函数。
  // ★ 想量 F 这一段，就跑线上那一页：
  //     SR_PAGE=https://anankax.github.io/mathroot/index.html node test/probe_flow_panel.cjs
  console.log('\nF. 云上那一步（苏科版那边真有东西回来吗）');
  const gateOn = await q('({on:SR.gate.on(), url:SR.gate.url()})');
  const isLocalHost = /localhost|127\.0\.0\.1/.test(host);
  if (!gateOn.on) {
    // ★ 跳过就是跳过，不当通过报——"跳过 ≠ 通过"这条今天已经写进好几把尺子。
    console.log('  – 这一页没配云函数（SR.GATE.url 是空的），F 整段**跳过**。');
    console.log('    跳过不等于通过：这条链今天没被验过。');
  } else if (isLocalHost) {
    console.log('  – 本机来源（' + host + '）**走不到**云函数：腾讯云网关在预检里回了两个');
    console.log('    Access-Control-Allow-Origin，浏览器判 MultipleAllowOriginValues 直接拦掉，请求没到函数。');
    console.log('    **这不是产品坏了**（线上来源实测通）。这一段今天在本机**没量**——');
    console.log('    要量它就跑线上那一页：SR_PAGE=https://anankax.github.io/mathroot/index.html node test/probe_flow_panel.cjs');
  } else {
    const Q0 = '我不会画数轴';
    const cloud = await q('SR.gate.kb("textbook",' + JSON.stringify(Q0) + ',2)');
    console.log('    从 ' + host + ' 调：' + JSON.stringify({ ok: cloud.ok, why: cloud.why, via: cloud.via }));
    ok('★ F1 云上真把苏科版那几条送回来了（这一步正是他说的"在我云知识库调取"）',
      cloud.ok === true && !!(cloud.hits || []).length &&
      !!(cloud.hits[0].title && typeof cloud.hits[0].score === 'number' && cloud.hits[0].text),
      { ok: cloud.ok, why: cloud.why, hits: cloud.hits && cloud.hits.map(h => h.title + '@' + h.score) });
    // ★ 这两个字段**只有云函数会填**（本机那条路不经过 gate.js）：
    //   所以它们齐了才叫"这一步真跑在云上"，而不是"云没回话、悄悄退回本机"。
    //   （判据照 test/probe_kb_cloud.cjs 那段抄的，别改成看"有没有回话"。）
    ok('★ F1 回来的东西带着 via:"gate" 和 ms（只有云函数会填这两个字段）',
      cloud.via === 'gate' && typeof cloud.ms === 'number', { via: cloud.via, ms: cloud.ms });
    ok('★ F1 这一步没带 model 字段（翻教材不该调模型、不该花额度）',
      cloud.model === undefined, cloud.model);
    // ---- F2 云上那份跟本机那份是不是同一个答案 ----
    // ⚠ 只有本机这份语料在的时候才比得了（公开站上 js/textbook.js 是 localOnly，
    //   浏览器里根本没有它——那时这条**跳过**，不许当成通过）。
    // ⚠ 返回值直接给对象，不要在页面里拼成 "标题@分数" 再切回来——
    //   标题里万一有个 @ 就会切错，红的样子是"两边分数对不上"，查半天查不到拼串上。
    const local = await q('(SR.TEXTBOOK && SR.TEXTBOOK.length>1000)'
      + '? SR.findTextbook(' + JSON.stringify(Q0) + ',2).map(function(h){'
      + 'return {title:h.doc.title, score:h.score};}) : null');
    if (!local) {
      console.log('  – F2 这一页本机没有教材语料（公开站就是这样），跳过比对。跳过不等于通过。');
    } else {
      const mineS = local.map(h => ({ title: h.title, score: h.score }));
      const cloudS = (cloud.hits || []).map(h => ({ title: h.title, score: h.score }));
      const sameT = mineS.length === cloudS.length && mineS.every((h, i) => h.title === cloudS[i].title);
      const sameS = sameT && mineS.every((h, i) => Math.abs(h.score - cloudS[i].score) <= 1e-9 * Math.max(1, Math.abs(h.score)));
      console.log('      本机：' + JSON.stringify(mineS.map(h => h.title + '@' + h.score.toFixed(4))));
      console.log('      云上：' + JSON.stringify(cloudS.map(h => h.title + '@' + h.score.toFixed(4))));
      ok('★ F2 云上那份跟本机那份**标题和分数都一样**（同一份语料 + 同一个检索器）',
        sameT && sameS, { 标题一样: sameT, 分数一样: sameS });
    }
  }

  // ---------- E. 收尾 ----------
  console.log('\nE. 收尾');
  const hint = await q('(function(){var h=document.getElementById("flowhint");'
    + 'return {text:h?h.textContent:null, n:SR.flow.list().length};})()');
  ok('★ 标题右边那句写着现在账本里留了几轮', /最近 \d+ 轮/.test(String(hint.text)) && hint.n > 0, hint);
  // ★ 探针自己开的账本自己收掉——这是他真浏览器的那个页面，
  //   留着一条假流水线，他下次打开会看到"我没发过这句话啊"。
  //   （flow.js 的账本只在内存里，reset 就够了；工位也放回原样。）
  await q('SR.flow.reset(); SR.flow.setWork(' + JSON.stringify(wasWork) + '); delete window.__pr;');
  // ★ 窗宽也放回去（这一趟开头把它钉到 1440 了，不收掉会留给同一个 profile 的下一个探针）
  await send('Emulation.clearDeviceMetricsOverride', {});
  await wait(300);
  const clean = await q('({n:SR.flow.list().length, work:document.body.getAttribute("data-work"),'
    + 'empty:!!document.querySelector("#flowlist .flowempty")})');
  ok('★ 探针把账本清空了、工位放回原样（不留假流水线在他的页面里）',
    clean.n === 0 && clean.work === wasWork && clean.empty === true, clean);

  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  // ★ 红验得自己证明「确实换掉了」：没换成的那一趟跑的是真产品，
  //   全绿也不能当尺子灵的证据（这就叫"在没改的那份上跑出全绿"）。
  if (RED) {
    console.log(SAB_HIT
      ? '★ 红验确实换掉了 js/flow.js——上面每一条红都是对着改坏的那份报的'
      : '★★ 红验**没换成**——这一趟跑的是真产品，这些绿不能当尺子灵的证据');
    await send('Fetch.disable', {});
  }
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e && e.message); process.exit(2); });

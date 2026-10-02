// 思维导图**接上了没有** —— 浏览器腿（js/mindmap.js 的界面那一半）。
//
// 为什么要有这一把（跟 probe_mindmap.cjs 分工说清楚）：
//   · `test/probe_mindmap.cjs` 在 node 里跑，量的是**纯函数**——几何、公式转文字、
//     那串回复读成什么。它一个字都碰不到界面。
//   · 这一把只量**接线**：那一排按钮点了会怎样、画板有没有被藏起来、
//     点一条淡下去的岔路到底发出去了什么、打包里到底有没有「思维导图.png」。
//   ★ 两把都不判"导图好不好看"。那条只有孔老师看得出来（见下面最后一行）。
//
// 用法（先把这两样起起来，否则它连不上）：
//   node test/serve.cjs 8138
//   Chrome 挂在 9222（**要有窗口**，别 --headless=new）
//   node test/probe_mmwire.cjs
//
// ★ 它只动**在页内存**里的东西（SR.pack.__seed 那一份账、SR.chat.say 临时换成假的），
//   一个字节都不写 localStorage／不进网络。收尾把换掉的那个函数**原样还回去**。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const SITE = process.env.SITE || 'http://localhost:8138/index.html';

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

let PASS = 0, FAIL = 0;
function ok(cond, label, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + label); }
  else { FAIL++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

// 夹具：两条岔路 + 三个环节。跟 probe_mindmap.cjs 那份同一个形状，
// 但**短一点**——这里要的是"界面上点得动"，不是几何。
const TURNS = [
  { visible: '这道题问 |x|=5，学生有两种错法：①他以为 x 一定是正数，只写了一个答案；' +
             '②他把 -7 当成 7 了。我打算先走第 2 路，大概 3 个环节。\n\n' +
             '第 1 环节 · 先把"距离"这个词捞出来\n' +
             '学生说：x 到原点的距离是 5，那 x 就是 5。\n' +
             '你接这句：还有哪个数到原点也是 5？\n' +
             '这么接的道理：让它自己看见另一边。', ggb: [] },
  { visible: '第 2 环节 · 把"两个答案"并排摆出来\n学生说：那就是 5 和 -5 都对。\n' +
             '你接这句：题目问的"等于 5"和"距离是 5"是一回事吗？\n' +
             '这么接的道理：摆在一起才看得出差别。\n\n' +
             '第 3 环节 · 让他把答案说回题目\n学生说：我算出来 3，可题目问的是距离。\n' +
             '你接这句：那你刚才算的是什么？\n' +
             '这么接的道理：把"算的"和"问的"分开。', ggb: [] }
];

const SEED = `(function(){
  var T = ${JSON.stringify(TURNS)};
  SR.pack.__seed(T, '|x|=5 的两种错法');
  return JSON.stringify({ turns: SR.pack.turns().length, topic: SR.pack.topic() });
})()`;

const SNAP = `(function(){
  var wrap = document.querySelector('.boardwrap');
  var mm = document.getElementById('mm');
  var c = mm && mm.querySelector('canvas');
  var g = document.getElementById('ggb').getBoundingClientRect();
  var lit = [].slice.call(document.querySelectorAll('.viewsw .viewbtn'))
    .filter(function(b){ return b.classList.contains('on'); })
    .map(function(b){ return b.getAttribute('data-view'); });
  return JSON.stringify({
    mmon: wrap.classList.contains('mmon'),
    mmDisplay: mm ? getComputedStyle(mm).display : 'no-node',
    mmRect: mm ? (Math.round(mm.getBoundingClientRect().width) + 'x' + Math.round(mm.getBoundingClientRect().height)) : 'no-node',
    canvas: c ? (c.width + 'x' + c.height) : 'no-canvas',
    ggb: Math.round(g.width) + 'x' + Math.round(g.height),
    lit: lit
  });
})()`;

const CLICK_MM = `document.querySelector('.viewsw .viewbtn[data-view="mm"]').click(); 'done'`;
const CLICK_2D = `document.querySelector('.viewsw .viewbtn[data-view="2d"]').click(); 'done'`;

// 找出那条**没选中**的岔路（带 dim 的），算出它在屏幕上的坐标。
// ★ 屏幕坐标 = 画布左上角 + 版面坐标 × 缩放（paint 里就是 setTransform(scale,…)）。
//   版面坐标的原点就在画布左上角，所以只差一个 boundingRect 的偏移。
const ROUTE_PT = `(function(){
  var L = SR.mm.__layout();
  if (!L) return JSON.stringify({ err: '导图没画（__layout 是 null）' });
  var dims = (L.routes || []).filter(function(n){ return n.dim; });
  if (!dims.length) return JSON.stringify({ err: '一条淡下去的岔路都没有', routes: (L.routes||[]).length, chosen: L.chosen });
  var n = dims[0], s = L.scale || 1;
  var r = document.querySelector('#mm canvas').getBoundingClientRect();
  return JSON.stringify({
    want: '先走第 ' + ((L.routes || []).indexOf(n) + 1) + ' 条路。',
    // ★ 上面这句是从下标**算**出来的，不是把产品那句话抄了一遍——
    //   下面那条断言另配了一份**写死**的字，两处对上了才算数。
    x: Math.round(r.left + (n.x + n.w / 2) * s),
    y: Math.round(r.top + (n.y + n.h / 2) * s),
    chosen: L.chosen, routes: L.routes.length
  });
})()`;

// 把 SR.chat.say 临时换成假的——只为看清"点下去要发哪句话"，不真发请求。
// ★ 换之前先把原函数**存起来**，收尾原样还回去（不 clear、不留痕）。
const PATCH_SAY = `(function(){
  window.__mmSaid = null;
  window.__mmOrigSay = SR.chat.say;
  SR.chat.say = function (t) { window.__mmSaid = String(t); return true; };
  return typeof window.__mmOrigSay;
})()`;
const RESTORE_SAY = `(function(){
  if (window.__mmOrigSay !== undefined) SR.chat.say = window.__mmOrigSay;
  delete window.__mmOrigSay;
  return typeof SR.chat.say;
})()`;

// 导图那张 PNG：直接从 dataURL 里读 IHDR 的宽高（PNG 头是死的：8 字节签名 + 4 长度 + 'IHDR' + 宽4高4）。
const PNG_INFO = `(function(){
  var u = '';
  try { u = SR.mm.toPNG(); } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); }
  if (!u) return JSON.stringify({ err: '空场（toPNG 按约定回空串）' });
  if (u.indexOf('data:image/png') !== 0) return JSON.stringify({ err: '不是 PNG：' + u.slice(0, 30) });
  var b = atob(u.split(',')[1]);
  var w = ((b.charCodeAt(16) << 24) | (b.charCodeAt(17) << 16) | (b.charCodeAt(18) << 8) | b.charCodeAt(19)) >>> 0;
  var h = ((b.charCodeAt(20) << 24) | (b.charCodeAt(21) << 16) | (b.charCodeAt(22) << 8) | b.charCodeAt(23)) >>> 0;
  return JSON.stringify({ ok: true, w: w, h: h, bytes: b.length });
})()`;

// 打包：真调一次 make（夹具里没有 ggb 围栏，所以它一张板上的图都不用画），
// 然后在 zip 的字节里**按名字找**那个条目——local header 里存的就是 UTF-8 的文件名。
const PACK_MM = `(function(){
  // ★★ 2026-10-02 修：**两个名字得用同一把尺**。
  //   r.bytes 是 zip 的原始字节，这里逐字节 fromCharCode 拼成一个字符串——
  //   也就是**一个字节当一个字符**。而 zip 里存文件名用的是 **UTF-8 字节**。
  //   一个带汉字的文件名，两边对不上：'思维导图.png' 这种中文字面量
  //   是 5 个字符，而字节串里躺着的是 12 个。**怎么找都不会命中。**
  //   原来 hasMM 老老实实手写了一遍 UTF-8 编码（所以它一直是对的），
  //   紧接着的 hasMD 却直接写了中文字面量——同一条断言里两种口径，
  //   于是「备课全程.md 也还在」**长期红着**，红的样子跟"打包漏了那份 md"一模一样。
  //   教训跟量具那条老账是一族的：**先问这把尺子量得到吗，再问结果对不对**。
  //   所以现在两个名字走同一个 u8()，「思维导图.png」那条行为不变。
  //   ⚠ 这段注释里**不能出现反引号**：整个函数体是一个模板字符串，
  //     反引号会把字符串提前结束掉，报的是一句看不懂的 SyntaxError。
  function u8(str) {
    var tag = '';
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp < 0x80) tag += String.fromCharCode(cp);
      else if (cp < 0x800) tag += String.fromCharCode(0xC0 | (cp >> 6)) + String.fromCharCode(0x80 | (cp & 63));
      else tag += String.fromCharCode(0xE0 | (cp >> 12)) + String.fromCharCode(0x80 | ((cp >> 6) & 63)) + String.fromCharCode(0x80 | (cp & 63));
    }
    return tag;
  }
  var tagMM = u8('思维导图.png'), tagMD = u8('备课全程.md');
  window.__mmPack = 'pending';
  SR.pack.make(null, null, function (r) {
    if (!r || !r.ok) { window.__mmPack = JSON.stringify({ ok: false, why: r && r.why }); return; }
    var s = '';
    for (var j = 0; j < r.bytes.length; j++) s += String.fromCharCode(r.bytes[j]);
    window.__mmPack = JSON.stringify({
      ok: true, name: r.name, figs: r.figs, mm: !!r.mm,
      hasMM: s.indexOf(tagMM) >= 0,
      hasMD: s.indexOf(tagMD) >= 0,
      // ★ 自检：**一个一定不在包里的名字，必须找不到**。
      //   没有这一条的话，"编码写错成谁都匹配"也能让上面两条一起变绿，
      //   而那把尺子其实什么都没量。两件相反的事一起验。
      hasBogus: s.indexOf(u8('绝对不在包里这个名字.md')) >= 0
    });
  });
  return 'started';
})()`;

(async () => {
  const t = JSON.parse(await put('/json/new?' + encodeURIComponent(SITE)));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const V = async e => { const s = await q(e); try { return JSON.parse(s); } catch (x) { return { __raw: s }; } };

  await send('Page.navigate', { url: SITE });
  await sleep(1800);
  // ★★ 这一场的东西从 2026-10-02 起是**跨刷新活着**的，浏览器里躺着上一趟留下的记忆。
  //   不清的话，开出来的不是空场：对话、打包的题目、连**压缩包的名字**都是从上一趟恢复的
  //   （实测红的是「备课全程.md 也还在」那一条，包名却是上一趟某一题的标题）。
  //   这不是产品坏了，是**这把尺子的起点脏了**——量具自己先把地盘扫干净。
  //   ⚠ 内存那份和盘上那份都得动：只删盘上的，页面离开时 pagehide 会把内存那份又写回去。
  if (!process.env.KEEPMEMO) await q(`SR.memo.clear(); localStorage.removeItem('mathroot_memo'); 1`);
  await send('Page.reload', { ignoreCache: true });   // 硬重载：同域导航吃缓存，会把没生效的判成生效
  await sleep(3500);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await sleep(600);

  // ---- 第 0 件：模块到底装上没有。缺了就说缺了，别拿 undefined 一路量到底 ----
  console.log('\n===== ⓪ 装上了没有 =====');
  const has = await V(`JSON.stringify({
    mm: !!(SR.mm && SR.mm.init && SR.mm.toPNG && SR.mm.__layout),
    say: typeof SR.chat.say,
    hook: typeof SR.mm.set3D
  })`);
  console.log('  ' + JSON.stringify(has));
  if (!has.mm) { console.log('★ js/mindmap.js 没装上（或没露 init/toPNG）——下面每一条都别信。'); process.exit(1); }
  ok(has.say === 'function', 'SR.chat.say 存在（导图上点岔路那条路才通）', '实际是 ' + has.say);

  // ---- 第 1 件：账本喂进去 ----
  console.log('\n===== ① 夹具进账本 =====');
  const seeded = await V(SEED);
  ok(seeded.turns === 2, '两条回复进了 SR.pack 的账', JSON.stringify(seeded));

  // ---- 第 2 件：点「导图」 ----
  //
  // ★★ 先等盒子**稳下来**再记基准，别数一个固定毫秒数就去量。
  //   这一条是量出来的教训，不是防患于未然：同一套代码、同一个起点，连着跑三趟，
  //   「点之前」量到 346 / 530 / 346 三种值——那把尺子量的是**页面还没安定下来的那一瞬**，
  //   于是红绿全看这一趟赶上了哪一帧。而它红起来的样子，跟"导图把画板挤塌了"一模一样。
  //   （等状态，别等时间：连续两次读到同一个盒子才算稳。）
  //
  // ★★★ 2026-10-02 又补一道，因为**只等"稳"是不够的**：
  //   GeoGebra 加载完的那一刻，`appletOnLoad` 里那句 `note('')` 把 `.boardbar` 上的
  //   「正在加载…」收起来，工具条从两行变一行（实测 69 → 56px），腾出来的高度
  //   被 `.boardwrap` 接走（518 → 532），`#ggb` 跟着从 426 长到 530——**它赖在那儿了**。
  //   而"正在加载"这一段本身是**稳的**：连读四次都是 426，`settleBox` 一看"稳了"就
  //   收工，**在加载还没完的时候就把基准记下来了**。于是后面那条
  //   「#ggb 的盒子一点没变」把"加载前 vs 加载后"的差，记成了"导图把画板挤了"的账。
  //   ⚠ 这条冤枉了导图，也冤枉了我自己——我照着这个红去改过 `js/board.js`（给 `#ggb`
  //     的父级加 ResizeObserver），**根本没治**，因为病根不在这儿。
  //   看穿它的是一次**一次导图都不点**的对照（`test/_ggbready.cjs`）：
  //     30 秒里只等页面自己加载，工具条照样 69 → 56、盒子照样 426 → 530。
  //     → 跟导图**没有关系**。导图是 `position:absolute; inset:0` 盖上去的，
  //       压根不参与 flex 计算。
  //   ★ 所以基准必须取在**加载完成之后**：先等 `#ggbstate` 那句提示收起来，再等盒子稳。
  //     两件事合成一个函数，免得哪天有人只补了一半。
  const waitReady = async () => {
    for (let i = 0; i < 120; i++) {                    // 最多 36 秒（冷缓存实测约 10 秒）
      const st = await V(`JSON.stringify((function(){
        var s = document.getElementById('ggbstate');
        var g = document.getElementById('ggb');
        return { hasNote: !!s,
                 hidden: !!(s && s.style.display === 'none'),
                 w: g ? Math.round(g.getBoundingClientRect().width) : 0 };})())`);
      // ★ 提示节点**还没生出来**那会儿也算"没好"：不是 hidden，是"还没到时候"。
      if (st.hasNote && st.hidden && st.w > 100) return true;
      await sleep(300);
    }
    return false;
  };
  const settleBox = async () => {
    let last = '', same = 0;
    for (let i = 0; i < 40; i++) {
      const now = await q(`(function(){var g=document.getElementById('ggb').getBoundingClientRect();
        return Math.round(g.width)+'x'+Math.round(g.height);})()`);
      if (now === last) { if (++same >= 2) return now; } else { same = 0; last = now; }
      await sleep(150);
    }
    return last;
  };
  if (!(await waitReady())) {
    console.log('\n⛔ 尺子坏了：等不到画板加载完（提示一直没收起来 / 画板没有宽度）。');
    console.log('   这一趟量不了"导图有没有动到画板"——基准还没到就能取，取到的就是错的。');
    await fetch(`http://${HOST}/json/close/${t.id}`).catch(() => {});
    process.exit(3);
  }
  await settleBox();
  const before = await V(SNAP);
  console.log('  点之前 ' + JSON.stringify(before));
  await q(CLICK_MM);
  await sleep(700);
  await settleBox();                 // 盖上去之后也要等它稳，不然量的是过渡中的那一帧
  const after = await V(SNAP);
  console.log('  点之后 ' + JSON.stringify(after));
  ok(after.mmon === true, '.boardwrap 上加上了 mmon（css 靠这一个类决定显不显示）');
  ok(after.mmDisplay === 'block', '.mmwrap 是 display:block', after.mmDisplay);
  ok(/^\d+x\d+$/.test(after.canvas) && Number(after.canvas.split('x')[0]) > 100,
     '画布真开出来了、而且有尺寸', after.canvas);
  // ★★ 这条是这一节的**正题**：盖着 ≠ 藏起来。藏了 #ggb 它的盒子就塌，
  //    GeoGebra 会量到 0 宽、自己重排一次（而且它不会跟你说）。
  ok(after.ggb === before.ggb && Number(after.ggb.split('x')[0]) > 100,
     '#ggb 的盒子一点没变（盖着，不是藏起来）', before.ggb + ' → ' + after.ggb);
  ok(JSON.stringify(after.lit) === JSON.stringify(['mm']),
     '三颗按钮里**只有**「导图」亮着', JSON.stringify(after.lit));

  // ---- 第 3 件：尺子自检——这一节量的东西真会动吗 ----
  // 故意把 #ggb 藏起来，看"盒子尺寸"这个量具会不会跟着变。
  // **不会变就说明它量的是个死数**，上面那条绿也就不算数。
  console.log('\n===== ③ 尺子自检（先跑红：这一节量得到"被藏起来"吗）=====');
  const hidden = await q(`(function(){
    var g = document.getElementById('ggb');
    var keep = g.style.display;
    g.style.display = 'none';
    var w = g.getBoundingClientRect().width;
    g.style.display = keep;                     // 原样还回去
    return Math.round(w);
  })()`);
  ok(hidden === 0, '把 #ggb 藏起来的瞬间宽度掉到 0 → 这把尺子**量得到**"藏"', '量到 ' + hidden);
  const back = await V(SNAP);
  ok(back.ggb === before.ggb, '还原之后 #ggb 又回到原来的尺寸', back.ggb);

  // ---- 第 4 件：从导图切回画板 ----
  console.log('\n===== ④ 点「平面」＝回画板 =====');
  await q(CLICK_2D);
  await sleep(600);
  const back2 = await V(SNAP);
  console.log('  ' + JSON.stringify(back2));
  ok(back2.mmon === false, 'mmon 摘掉了', String(back2.mmon));
  ok(back2.mmDisplay === 'none', '.mmwrap 又是 display:none', back2.mmDisplay);
  ok(back2.lit.indexOf('mm') < 0 && back2.lit.length === 1, '亮的不再是导图', JSON.stringify(back2.lit));

  // ---- 第 5 件：点一条淡下去的岔路 = 换这条走 ----
  console.log('\n===== ⑤ 点没选中那条岔路（发出去的是不是一句人话）=====');
  await q(CLICK_MM);
  await sleep(500);
  const orig = await q(PATCH_SAY);
  ok(typeof orig === 'string' && orig === 'function', '换之前 SR.chat.say 本来就在（事后要还回去的那份）', String(orig));
  const pt = await V(ROUTE_PT);
  console.log('  ' + JSON.stringify(pt));
  if (pt.err) {
    ok(false, '找得到一条淡下去的岔路', pt.err);
  } else {
    ok(pt.chosen === '2', '认出来选了第 2 条路（夹具里写的就是它）', String(pt.chosen));
    // 真鼠标事件，不是 el.click() 也不光补个 clientX——
    // handler 读的正是事件坐标，坐标不对它会算到别的框上。
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(400);
    const said = await q('window.__mmSaid === null ? "null" : window.__mmSaid');
    ok(said === '先走第 1 条路。', '点下去发的是一句**人话**、而且指的是那一条', String(said));
    // ★ 上面那条断言里的字是**写死**的；而 pt.want 是从下标算出来的。两处对上，
    //   才说明"点到第几条"和"说的第几条"是同一件事，不是各说各的。
    ok(said === pt.want, '而且是**被点的那一条**的序号（两处算法对上）', said + ' vs ' + pt.want);
  }
  const restored = await q(RESTORE_SAY);
  ok(restored === 'function', 'SR.chat.say 原样还回去了（探针不留痕）', String(restored));

  // ---- 第 6 件：点空白处不该发东西 ----
  console.log('\n===== ⑥ 点空白（不该说话）=====');
  await q(PATCH_SAY);
  const blank = await q(`(function(){
    var r = document.querySelector('#mm canvas').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + 5), y: Math.round(r.bottom - 5) });
  })()`);
  const bp = JSON.parse(blank);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bp.x, y: bp.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bp.x, y: bp.y, button: 'left', clickCount: 1 });
  await sleep(300);
  const said2 = await q('window.__mmSaid === null ? "null" : window.__mmSaid');
  ok(said2 === 'null', '点空白处一声不吭（没往对话里塞半句话）', String(said2));
  await q(RESTORE_SAY);

  // ---- 第 7 件：导图那张 PNG ----
  console.log('\n===== ⑦ 导出那张图 =====');
  const png = await V(PNG_INFO);
  console.log('  ' + JSON.stringify(png));
  ok(png.ok === true, '导出一张 PNG（不是空场、不是别的格式）', png.err || '');
  if (png.ok) {
    ok(png.w <= 2400, '宽度没超 2400px（计划里定的那条：插进 Word 版心放得下）', png.w + 'px');
    ok(png.h > 100 && png.w > 100, '宽高都是真尺寸（不是 0×0 的空画布）', png.w + '×' + png.h);
    ok(png.bytes > 2000, '这张 PNG 有内容（不是一张纯白）', png.bytes + ' 字节');
  }

  // ---- 第 8 件：打包里到底有没有它 ----
  console.log('\n===== ⑧ 包里有没有「思维导图.png」=====');
  // 打包借画板（offscreenJob），画板得先起来。起不来就**说没跑**，不许当绿。
  let ready = false;
  for (let i = 0; i < 30; i++) { if (await q('String(!!(SR.board && SR.board.isReady && SR.board.isReady()))') === 'true') { ready = true; break; } await sleep(1000); }
  if (!ready) {
    console.log('  ⚠ 画板 30 秒没就绪 —— 这一节**没跑**（不是通过）。GeoGebra 是从 CDN 拉的，网络慢就会这样。');
  } else {
    await q(PACK_MM);
    let packed = null;
    for (let i = 0; i < 60; i++) {
      const s = await q('window.__mmPack ');
      if (s && s !== 'pending' && s !== 'started') { packed = JSON.parse(s); break; }
      await sleep(500);
    }
    console.log('  ' + JSON.stringify(packed));
    if (!packed) ok(false, '打包在 30 秒内回来了', '一直 pending');
    else {
      ok(packed.ok === true, '打包成了', packed.why || '');
      if (packed.ok) {
        ok(packed.mm === true, '结果里标了"含导图"（状态栏那四个字靠它）', String(packed.mm));
        ok(packed.hasMM === true, 'zip 字节里**真的找得到**「思维导图.png」这个名字', JSON.stringify(packed));
        // ★ 中间那条 self-check 不能省：它保证"找得到"是真的找得到，
        //   而不是编码写坏成谁都匹配。它红了 = 上面两条绿都不能信。
        ok(packed.hasBogus === false, '尺子自检：一个不在包里的名字，确实找不到',
           '居然"找到"了 → 上面那两条"找得到"作废');
        ok(packed.hasMD === true, '「备课全程.md」也还在（别为了加一张图把它挤掉）', '');
        ok(packed.figs >= 1, '图数把导图算进去了', String(packed.figs));
      }
    }
  }

  // ---- 收尾：把在页内存里留下的东西擦掉 ----
  await q(`(function(){
    if (window.__mmOrigSay !== undefined) SR.chat.say = window.__mmOrigSay;
    delete window.__mmOrigSay; delete window.__mmSaid; delete window.__mmPack;
    SR.pack.__seed([], '');          // 夹具那份账也还回去
    SR.mm.show('2d');
    return 'cleaned';
  })()`);

  console.log('\n' + (FAIL ? '★ ' + FAIL + ' 条没过（上面每一条都写了实际值）。' : '') +
              '通过 ' + PASS + ' 条，没过 ' + FAIL + ' 条。');
  console.log('★ 这把尺子只量**接线**：按钮点下去谁亮、画板有没有被藏、点岔路发了哪句话、包里有没有那张图。');
  console.log('★ 它判不了：导图好不好看、那两条岔路是不是**真的两种错法**、图上那句学生的话像不像孩子在说话。**这三条只有孔老师看得出来。**');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('炸了：', e.message); process.exit(3); });

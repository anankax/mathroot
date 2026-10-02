// 「版式」那一行（#tplbar）和左栏那颗「备课卡片」（#cardbtn）。
//
// ★★ 这把尺子守的是 2026-10-02 那两件搬家动作，两件都**只改动了几个字符**，
//   坏了不报错、页面上还看得见，只是看得见的不是那句真话：
//
//   ① 「我的模板」从左栏搬进产物栏，改名「模板库」，并且要多说一句
//      **现在用的是哪一份**（#tplnow）。这一句是整件事的重点：
//      以前 `cur` 是纯内存状态，restore() 开机悄悄接回来一份，
//      **界面上一个字都不说**——老师刷新一次就不知道它手上套的是哪份版式。
//      所以这把尺子不查"那行字长什么样"，查**"cur 一变，那行字跟着变吗"**
//      （见下面 setCurrent 那一段：改了要变、改回来要还原）。
//
//   ② 「备课卡片」对访客隐藏（只在 localhost 露出来）。
//      这一条**本机测不出来**：本机跑时它本来就该是露着的（isLocal 为真）。
//      所以要拿线上地址跑同一把尺子——线上 location.hostname 不是 localhost，
//      那时它必须 display:none。断言写成**跟 host 挂钩的条件**，两种模式都成立，
//      而且报错时会把 host 一起打出来，能一眼看出"是部署错了还是我跑错地方了"。
//
// ★ 为什么这不是"把产品措辞焊进测试"：
//   全篇**没有断言任何一句中文**（除了那句假模板的名字，那是探针自己塞进去的、
//   用来证明"界面确实把当前这份的名字显示出来了"——那正是这个功能的定义）。
//   它问的是三个**关系**：入口在不在该在的框里、那行字跟不跟 cur 走、
//   该藏的有没有藏住。
//
// ★ 为什么不能只查 DOM 里有没有 .tplbar：
//   元素在 DOM 里和在屏幕上是两件事。`.tplbar` 住在 `.outbox` 里，而 .outbox 只在
//   组卷那一格显示（css `body:not([data-work="material"]) .outbox{display:none}`）。
//   所以"搬到 outbox 里"这个设计**全靠那条 CSS 兜着**——CSS 哪天被改掉，
//   DOM 查询照样全绿，而它已经跑到画图工位上去了。下面 B2 那一段就是量这个的。
//
// 用法（先起 node test/serve.cjs 8138，Chrome 在 9222）：
//   node test/probe_tplrow.cjs
//   SR_PAGE=https://anankax.github.io/mathroot/ node test/probe_tplrow.cjs   （线上必跑）
// 退出码：0 = 都对；1 = 有地方对不上；2 = 探针自己炸了；3 = 尺子坏了（页面没起来）
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';

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
// 自己开的标签页自己关——只 ws.close() 不关页，开一次攒一个。
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
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; }
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300);
    return R && R.result ? R.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.WORKS&&SR.chat)')) break; await wait(500); }
  await wait(800);

  const host = await q('location.host');
  console.log('这一趟跑在 : ' + host + '\n');

  // ---- 前置：仪器在不在 ----
  const has = await q('({bar:!!document.querySelector(".tplbar"),now:!!document.getElementById("tplnow"),'
                    + 'btn:!!document.getElementById("tplbtn"),card:!!document.getElementById("cardbtn"),'
                    + 'paint:typeof SR.paintTpl})');
  if (!has || !has.bar || !has.now || !has.btn || !has.card || has.paint !== 'function') {
    console.log('★ 仪器不对，先别往下判：' + JSON.stringify(has));
    console.log('  这五个都该在（bar/now/btn/card 四个元素 + SR.paintTpl 一个函数）。');
    console.log('  缺一大堆的话多半是页面根本没起来（服务在 8138 吗？Chrome 9222 是这个 profile 吗？）。');
    await closeTab(t.id); ws.close(); process.exit(3);
  }

  // ---- A. 搬家：入口现在住在产物栏里，不在左栏 ----
  const where = await q('(function(){var b=document.getElementById("tplbtn");'
                      + 'return {inOutbox:!!b.closest(".outbox"), inRail:!!b.closest(".rail"),'
                      + 'barInRail:!!document.querySelector(".rail .tplbar")};})()');
  ok('A1：模板库这颗按钮在 .outbox 里（搬到了产物栏）', where.inOutbox, where);
  ok('A2：它**不在** .rail 里（左栏那组抽屉彻底不留它）', !where.inRail && !where.barInRail, where);

  // ---- B. 它只在组卷那一格出现，而且这是 CSS 说了算的 ----
  // 直接改 body 的 data-work 再改回去——纯读 CSS，不动别的状态。
  //
  // ★★ 这里踩过一个坑，记下来（第一次跑就是被它骗的）：
  //   量"看得见吗"**不能用 `getComputedStyle(el).display`**。
  //   `.tplbar` 住在 `.outbox` 里，而收起用的是 `body:not([data-work=material]) .outbox{display:none}`
  //   ——**藏的是爹，不是它**。它的 computed display 一直是 `flex`，
  //   照样报告"看得见"，可它一个像素都没画出来。第一次跑的时候 B2 就是这么红的：
  //   红的样子跟"搬家搬错了"一模一样，其实错的是尺子。
  //   改量 `getClientRects().length`：那数的是**它到底生成了几个盒子**，
  //   祖先不显示就是 0。这个坑跟"数 textContent 里的反斜杠"是同一族——
  //   量到的是**关于这个元素的一件事**，不是**它在屏幕上的样子**。
  const vis = await q('(function(){'
    + 'var body=document.body, was=body.getAttribute("data-work");'
    + 'var bar=document.querySelector(".tplbar");'
    + 'function d(){return {rects:bar.getClientRects().length, own:getComputedStyle(bar).display};}'
    + 'body.setAttribute("data-work","material"); var onMat=d();'
    + 'body.setAttribute("data-work","draw");     var onDraw=d();'
    + 'body.setAttribute("data-work",was);         var back=d();'
    + 'return {was:was, nowAttr:body.getAttribute("data-work"),'
    + 'onMaterial:onMat, onDraw:onDraw, restored:back};})()');
  ok('B1：在组卷里它是真画出来的（有盒子）', vis.onMaterial.rects > 0, vis);
  ok('B2：切到别的工位它自己消失（这条靠 .outbox 那条 CSS 兜着，改掉 CSS 就会红）',
     vis.onDraw.rects === 0, vis);
  // ★ B3 只查"那个属性原样放回去了"，**不查它还原后有盒子**——
  //   这台机器上开局停在 `prep`（状态是从 localStorage 接回来的），
  //   还原成 prep 之后这一行**本来就该是没的**：那是功能，不是坏。
  //   第一版我拿"还原后的盒子数"去比"组卷里的盒子数"，它当然不等——
  //   又一条"红的样子跟产品坏了长得一样"的假警报。要查"放回去了没有"，
  //   就查那个**被改过的东西**（属性），别绕道去查它的下游表现。
  ok('B3：探针把 data-work 放回了原样（不留改动）', vis.nowAttr === vis.was, vis);
  console.log('      （当前工位 ' + vis.was + '，盒子数 组卷/其它/还原 = '
            + vis.onMaterial.rects + ' / ' + vis.onDraw.rects + ' / ' + vis.restored.rects
            + '；它自己的 display 三种状态都是 ' + vis.onDraw.own + '，这正是不能量它的原因。'
            + (vis.restored.rects === 0 ? '还原后没盒子是对的——当前不在组卷这一格。' : '') + '）');

  // ---- C. 那行字跟不跟 cur 走（这是整件事的重点） ----
  // 塞一份**假模板**：它不出现在任何列表里、不写库、不碰 localStorage，
  // 只走 setCurrent 那条路，验完立刻用原值覆盖回去。
  const before = await q('(function(){var o=SR.material.current();'
    + 'return {text:document.getElementById("tplnow").textContent, on:document.getElementById("tplnow").classList.contains("on"),'
    + 'curName:o?o.name:null, curId:o?o.id:null};})()');
  const after = await q('(function(){'
    + 'window.__probe_cur0 = SR.material.current();'
    + 'SR.material.setCurrent({id:"__probe__", name:"探针假模板"});'
    + 'var el=document.getElementById("tplnow");'
    + 'return {text:el.textContent, on:el.classList.contains("on")};})()');
  // 再来一遍 cur=null：有模板和没模板是两种样子（「选中」那层高亮要跟着掉）
  const none = await q('(function(){'
    + 'SR.material.setCurrent(null);'
    + 'var el=document.getElementById("tplnow");'
    + 'return {text:el.textContent, on:el.classList.contains("on")};})()');
  const back2 = await q('(function(){'
    + 'SR.material.setCurrent(window.__probe_cur0); delete window.__probe_cur0;'
    + 'var el=document.getElementById("tplnow");'
    + 'return {text:el.textContent, on:el.classList.contains("on")};})()');

  console.log('\n  cur 变化前那一行写的是 : ' + JSON.stringify(before.text)
            + '（高亮 ' + before.on + '，当时 cur = ' + JSON.stringify(before.curName) + '）');
  console.log('  换成假模板之后          : ' + JSON.stringify(after.text) + '（高亮 ' + after.on + '）');
  console.log('  置成 null 之后          : ' + JSON.stringify(none.text) + '（高亮 ' + none.on + '）');
  console.log('  换回来之后              : ' + JSON.stringify(back2.text) + '（高亮 ' + back2.on + '）\n');

  ok('C1：换了模板，那行字**当场就变了**（不是等刷新；不动就不是活的）',
     after.text !== before.text, { 前: before.text, 后: after.text });
  ok('C2：它说出了当前用的是哪一份（把名字显示出来）',
     after.text.indexOf('探针假模板') >= 0, after.text);
  ok('C3：有模板时那一行是"选中"的样子（.on）', after.on === true, after);
  ok('C4：置成 null 之后换了一句话（有模板 / 没模板 是两种样子）',
     none.text !== after.text, { 有: after.text, 无: none.text });
  ok('C5：没模板时"选中"那层高亮掉了（.on 不能一直挂着）',
     none.on === false, none);
  ok('C6：换回来之后**跟原来一字不差**（改回来就得像没动过）',
     back2.text === before.text, { 原: before.text, 还原: back2.text });
  ok('C7：还原后"选中"的样子也回到原样', back2.on === before.on, { 原: before.on, 还原: back2.on });

  // ---- D. 备课卡片：该藏的人藏住了没有 ----
  // ⚠ 这条分两半，因为"藏住"有两层，本机只能验到第一层：
  //   ① 出厂的那份 HTML 上就写着 display:none —— 访客的 JS 还没跑起来、或者
  //      以后有人加了个同步的显隐、或者干脆脚本挂了，他都看不见。取**源码**来查，
  //      因为页面跑起来之后本机会把这个行内样式抹掉（那是第二层，故意的）。
  //   ② 跑起来之后露不露，跟"这是不是本机"一致——本机露、线上藏。
  //      ★ 这里的判据是照 js/main.js 里那个 `isLocal` 一行**同样**写的：
  //      两边不一致本身就是一种坏法（一边以为藏了、一边露着），所以这把尺子
  //      宁可把它当**要一致**的两处来看，而不是各算各的。
  // 同样量"生成了几个盒子"，不量它自己的 display（理由见上面 B 段那个坑）
  const card = await q('(function(){var b=document.getElementById("cardbtn");'
    + 'return {rects:b.getClientRects().length, display:getComputedStyle(b).display,'
    + 'isLocal:(location.hostname==="localhost"||location.hostname==="127.0.0.1"'
    + '||location.protocol==="file:"||location.hostname==="")};})()');
  // 页面源码里那颗按钮身上带没带 display:none。
  // 不用正则——这一串要先过 JS 字符串、再过 Runtime.evaluate，两层转义里
  // 一个反斜杠对不上，尺子就会报"源代码里没有 display:none"，看着像产品坏了。
  // 直接按位置切一段出来看，转义只剩一层，而且报错时能把切到的那段原文打出来。
  const srcHas = await q('fetch(location.href,{cache:"no-store"}).then(function(r){return r.text();})'
    + '.then(function(s){var i=s.indexOf("cardbtn");'
    + 'if(i<0)return {found:false,tag:""};'
    + 'var a=s.lastIndexOf("<",i), b=s.indexOf(">",i);'
    + 'if(a<0||b<0)return {found:false,tag:""};'
    + 'var tag=s.slice(a,b+1);'
    + 'return {found:true, tag:tag, hidden:tag.indexOf("display:none")>=0};})');
  // 三个"本机才有"的入口一起量（本地素材 / 备课卡片 / 知识库）——
  // 孔老师 2026-10-02 那句「不要给使用的人看到了、」说的就是这一整组。
  // 本机露、访客全藏，三条一起看才叫"这一组收干净了"。
  const gates = await q('(function(){var o={};'
    + '["resbtn","cardbtn","kbbtn"].forEach(function(k){var b=document.getElementById(k);'
    + 'o[k]=b?b.getClientRects().length:null;});return o;})()');
  console.log('  三个本机入口 : ' + JSON.stringify(gates)
            + '（盒子数；host=' + host + '，该' + (card.isLocal ? '全露' : '全藏') + '）');
  ok('D0：本地素材/备课卡片/知识库三个入口，本机露、访客全藏',
     Object.keys(gates).every(k => (gates[k] > 0) === card.isLocal), { 盒子数: gates, 该显示: card.isLocal });

  const shouldShow = card.isLocal;
  console.log('\n  备课卡片 : host=' + host + ' → 该' + (shouldShow ? '露出来' : '藏起来')
            + '，实际盒子数=' + card.rects + '（自己的 display=' + card.display + '）\n');
  ok('D1：跑起来之后，它的显隐跟"这是不是本机"一致（线上必须藏住）',
     (card.rects > 0) === shouldShow, { host: host, 盒子数: card.rects, display: card.display, 该显示: shouldShow });
  ok('D2：出厂那份 HTML 上就写着 display:none（JS 没跑起来时访客也看不见）',
     !!(srcHas && srcHas.hidden), srcHas && srcHas.tag);

  // ---- 对照组：证明这条链真在渲染，不是空页 ----
  const badgeShown = await q('(document.getElementById("badge")||{}).textContent||""');
  ok('★ 对照：当前工位的说明文字有内容（空页也能让上面几条"通过"）',
     String(badgeShown).trim().length > 0, badgeShown);

  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e); process.exit(2); });

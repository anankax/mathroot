// 工位的名字，**三处必须是同一套**。件数照 SR.WORK_ORDER 现数，不写死。
//
// ★★ 这条守的是一个具体的、真会发生的错：
//   工位的名字在**三个文件位置**各写了一遍——
//     ① js/config.js   SR.WORKS[].label / .badge （产品自己认的那份，行为也挂在它上面）
//     ② 页面上那一行   #works 里的 <button class="workbtn">（由 js/main.js 照
//                      SR.WORK_ORDER 现画，名字取自 SR.WORKS 同一格）
//     ③ index.html     「关于」里第一张列表的 <strong>
//   改名字的时候漏掉一处，**没有任何东西会报**：页面照常跑，只是工位写「组卷」、
//   点开「关于」还写着「出材料」。2026-10-02 换教师行话（出材料/画图/出题 →
//   组卷/作图/命题）就是这种改动，所以当天写了这把尺子。
//
// ★ 2026-10-03：左栏撤了，②那条路从 `.rail .workbtn` 改成 `#works .workbtn`。
//   注意②现在是**照着①现画**的，所以它对①的一致性几乎是被结构保证的——
//   剩下的真价值在③（「关于」那份是手写的，谁也不会自动跟着改）。留着②是当**对照**：
//   它要是也对不上，说明按钮根本没画出来（页面没起来），别把那种情况读成"③写错了"。
//
// ★ 为什么这不是"把产品措辞焊进测试"（这个仓库栽过的坑）：
//   这里**一个名字都没写死**。尺子只问"三处一不一致"，不问"该叫什么"。
//   你明天把「组卷」改成「出卷」，三处一起改，它照样绿——这正是它该有的行为。
//   真正焊死的反例是"断言页面里有『组卷』两个字"：那是把某天的决定当成永久事实。
//
// ★ 为什么不能只查 index.html 里有没有旧词：
//   ① 「画图」是**合法的正文**——「关于」里那句"它写一行**画图命令**，工作台自己
//      把图渲出来印上去"说的就是画图这件事，一点没错。全局扫「画图」会把这句判成错的。
//      （同族的坑：某次拿"禁『节』字"当规矩，可「环节」里本来就有「节」，四条正确输出全红。）
//   ② 所以尺子**只认三个位置**：工位那一行按钮的可见文字、关于列表里加粗的那几个名字、
//      以及 config 里那两份。别的地方写什么都不管。
//
// ★ #badge 那一条是**对照组**：光比"三处文字一不一致"的话，一个根本没渲染出来的页面
//   （或者按钮文字全是空字符串的页面）也能全绿。断言"高亮那一格底下的说明文字
//   确实等于当前工位的 badge"，才说明这条链是活的。第三条"标签两两不同"是同一目的的
//   第二道：复制粘贴漏改会出现两个「备课」，那时三处"一致"，但产品是坏的。
//
// 用法（先起 node test/serve.cjs 8138，Chrome 在 9222）：
//   node test/probe_labels.cjs
//   SR_PAGE=https://anankax.github.io/mathroot/ node test/probe_labels.cjs   （线上也照跑）
// 退出码：0 = 三处一致；1 = 有地方对不上；2 = 探针自己炸了；3 = 尺子坏了（页面没起来）
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
  // 件数照 SR.WORK_ORDER 现数——加/减一个工位，这把尺子自己跟着走，不用改。
  const nOrder = await q('SR.WORK_ORDER ? SR.WORK_ORDER.length : -1');
  const nWorks = await q('SR.WORKS ? Object.keys(SR.WORKS).length : -1');
  const nBtns = await q('document.querySelectorAll("#works .workbtn").length');
  if (nOrder !== nWorks || nBtns !== nOrder || nOrder < 1) {
    console.log('★ 仪器不对，先别往下判：SR.WORK_ORDER 有 ' + nOrder + ' 格、SR.WORKS 有 ' + nWorks
      + ' 个、页面上画出来 ' + nBtns + ' 个按钮。三个该相等。');
    console.log('  是 0 的话多半是页面根本没起来（服务在 8138 吗？Chrome 9222 是这个 profile 吗？）。');
    await closeTab(t.id); ws.close(); process.exit(3);
  }

  // ---- 三处取证。注意：这一整段**没有写死任何一个名字** ----
  const cfg = await q('(function(){var o={};for(var k in SR.WORKS){o[k]={id:SR.WORKS[k].id,label:SR.WORKS[k].label,badge:SR.WORKS[k].badge};}return o;})()');
  const rail = await q('(function(){var o={};document.querySelectorAll("#works .workbtn").forEach(function(b){o[b.getAttribute("data-work")]=b.textContent.trim();});return o;})()');
  // 「关于」里**第一张**列表 = 讲这五件事的那张（用位置取，不焊"五件事"这个标题词——
  // 标题哪天真改了字，这张列表还在原地，尺子不该跟着红）。
  const about = await q('(function(){var ul=document.querySelectorAll("#about ul")[0];if(!ul)return null;return Array.prototype.map.call(ul.querySelectorAll("li > strong:first-child"),function(s){return s.textContent.trim();});})()');

  console.log('① js/config.js  的 label : ' + Object.keys(cfg).map(k => k + '=' + cfg[k].label).join('  '));
  console.log('② 工位那一行的按钮文字  : ' + Object.keys(rail).map(k => k + '=' + rail[k]).join('  '));
  console.log('③ 「关于」列表的加粗名  : ' + (about || []).join(' / ') + '\n');

  // ---- 自检：不能"两边都空"也算一致 ----
  const labels = Object.keys(cfg).map(k => (cfg[k].label || '').trim());
  ok('尺子自检：' + nOrder + ' 个人话名都不是空的（不然"对得上"可能只是两边都空）',
     labels.length === nOrder && labels.every(s => s.length > 0), labels);
  ok('尺子自检：' + nOrder + ' 个人话名互不相同（防复制粘贴漏改，出现两个「备课」）',
     new Set(labels).size === nOrder, labels);
  if (labels.some(s => !s) || new Set(labels).size !== nOrder) {
    console.log('\n★ 名字本身就不成立，比三处一致更重要——先修名字再跑这把尺子。');
    console.log('  结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
    await closeTab(t.id); ws.close(); process.exit(1);
  }

  // ---- ①vs②：逐格对（按 data-work 配对，不按出现顺序） ----
  const badRail = Object.keys(cfg).filter(k => (rail[k] || '') !== cfg[k].label);
  ok('①=②：工位那一行每个按钮的文字，都等于 config 里同一格的名字',
     badRail.length === 0,
     badRail.map(k => ({ 工位: k, config: cfg[k].label, 工位行: rail[k] })));

  // ---- ①vs③：集合相同（顺序不管——关于列表是按"哪件事先说"排的，不必跟导航同序） ----
  const wantSet = labels.slice().sort();
  const gotSet = (about || []).slice().sort();
  ok('①=③：「关于」那张列表里的名字，跟 config 的 ' + nOrder + ' 个人话名是同一套',
     JSON.stringify(wantSet) === JSON.stringify(gotSet), { config: wantSet, 关于: gotSet });

  // ---- 对照组：这条链是活的 ----
  const cur = await q('document.body.getAttribute("data-work")');
  const badgeShown = await q('(document.getElementById("badge")||{}).textContent||""');
  ok('★ 对照：高亮那一格底下的说明，等于当前工位的 badge（证明这条链真在渲染，不是空页）',
     cfg[cur] && badgeShown === cfg[cur].badge, { 当前: cur, 显示的: badgeShown, config: cfg[cur] && cfg[cur].badge });
  ok('对照：当前工位拿得到 badge（空的话上面那条会比较两个空串）',
     !!(cfg[cur] && (cfg[cur].badge || '').trim().length > 0), cfg[cur] && cfg[cur].badge);

  // ---- 红验：往**页面跑起来之后的 DOM** 里注入"漏改一处"，看这把尺子抓不抓得住 ----
  //
  // ★ 为什么注入点选 DOM、不选仓库里的 js/：
  //   这把尺子读的本来就是"页面上现在写着什么"（②的按钮文字、③的「关于」列表）。
  //   要考它，就该改它读的那一层——改 js/ 再还原是另一码事（既动了产品文件，
  //   又留下"忘了还原"的风险）。
  // ★ 为什么每条先读回来核一遍：一根没接上的故障线会红得**跟真故障一模一样**，
  //   于是"尺子抓得住"这个结论就是白得的。改不到 → 判红验作废（exit 3），
  //   不许把它当成过。
  // 用法：RED=about / RED=rail
  if (process.env.RED) {
    const which = process.env.RED;
    if (which === 'about') {
      const hit = await q(`(function(){var s=document.querySelectorAll("#about ul")[0].querySelector("li > strong");if(!s)return null;var was=s.textContent.trim();s.textContent="出材料";return {改前:was,改后:s.textContent.trim()}})()`);
      console.log('\n[红验 about] 把「关于」第一个名字改成旧词：' + JSON.stringify(hit));
      if (!hit || hit.改后 !== '出材料') {
        console.log('★ 红验作废：这一处没改到（没找着那个 strong？）—— ③ 那条断言根本没被考验。');
        await closeTab(t.id); ws.close(); process.exit(3);
      }
      const about2 = await q('(function(){var ul=document.querySelectorAll("#about ul")[0];if(!ul)return null;return Array.prototype.map.call(ul.querySelectorAll("li > strong:first-child"),function(s){return s.textContent.trim();});})()');
      const w2 = labels.slice().sort(), g2 = (about2 || []).slice().sort();
      ok('[红验] ③ 漏改一处 → 「①=③」必须红', JSON.stringify(w2) !== JSON.stringify(g2), { config: w2, 关于: g2 });
    } else if (which === 'rail') {
      const hit = await q(`(function(){var b=document.querySelector("#works .workbtn");if(!b)return null;var was=b.textContent.trim();b.textContent="出材料";return {改前:was,改后:b.textContent.trim()}})()`);
      console.log('\n[红验 rail] 把第一个工位按钮改成旧词：' + JSON.stringify(hit));
      if (!hit || hit.改后 !== '出材料') {
        console.log('★ 红验作废：这个按钮没改到 —— ①=② 那条断言根本没被考验。');
        await closeTab(t.id); ws.close(); process.exit(3);
      }
      const rail2 = await q('(function(){var o={};document.querySelectorAll("#works .workbtn").forEach(function(b){o[b.getAttribute("data-work")]=b.textContent.trim();});return o;})()');
      const bad2 = Object.keys(cfg).filter(k => (rail2[k] || '') !== cfg[k].label);
      ok('[红验] ② 漏改一处 → 「①=②」必须红', bad2.length > 0, bad2.map(k => ({ 工位: k, config: cfg[k].label, 工位行: rail2[k] })));
    } else {
      console.log('\n★ RED=' + which + ' 不认识（只有 about / rail）');
      await closeTab(t.id); ws.close(); process.exit(3);
    }
  }

  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e); process.exit(2); });

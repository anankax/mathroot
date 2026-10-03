// 量"这一场的记忆"（js/memo.js ＋ js/chat.js 的接线）。
// 用法：node test/probe_memo.cjs
//       RED=1 node test/probe_memo.cjs   ← 先**真的**把浏览器里那份记忆删掉，
//                                          再看这把尺子会不会红。
//                                          一片红才算它在量记忆，不是在看屏幕画得像不像。
//
// 孔老师 2026-10-02 那句话拆成四件要量的事：
//   ① 说过的留在浏览器里 —— 走完两轮，localStorage 里那个键得真有东西；
//   ② 关掉再开还在 —— **真导航一次**（不是 reload，见下面那条），气泡和
//      `SR.memo.history()` 都得回到导航前那一份；
//   ③ 切工位不丢 —— 换一件之后上一场的对话还在，而且中间多一条分界线；
//   ④ 只有 ⟳ 能清 —— 真鼠标点那颗刷新按钮，键没了、屏幕空了、口袋空了。
//
// ★ 模型是**假的**（底下 stub 掉 SR.api.ask）。要量的不是"模型答得好不好"，
//   是"答完这一轮，帐记对了没有、下一场读回来了没有"。真去连一次 glm
//   会把这份尺子变成"网络通不通"的尺子——今天 429、明天 200，
//   而 429 在报告里跟"记忆坏了"长得一模一样。
//
// ★ 四条量具的坑照抄 feel.cjs / pipe.cjs 头顶那五条（都是 instrument 的毛病）：
//   ① `/json/new` 开的是**后台标签页**，鼠标事件送不到 → 每次点之前 bringToFront；
//   ② **别 reload** —— 重载后的文档不产帧，量到中间态；要"真开一次"就用
//      setCacheDisabled + navigate（这正好也是"关掉浏览器再打开"的替身）；
//   ③ 视口外的点击会被静默丢掉，读作"点不动" → 先 scrollIntoView 再取 rect；
//   ④ mouseMoved **必须显式带 button:'none'**；
//   ⑤ ★ **别等固定的毫秒数等页面起来**。这一页要从 CDN 拉 marked / DOMPurify / KaTeX，
//      网络一慢，1.4 秒时 `SR.chat` 还没装好，点什么都白点——
//      而"页面还没活"和"产品没反应"在报告里长得一模一样。
//      治法＝轮询到"能确认它活了"（SR.chat ＋ SR.memo ＋ 开场白已经在 #msgs 里）。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const URL = process.env.URL || 'http://localhost:8138/index.html';
const RED = process.env.RED === '1';
const KEY = 'mathroot_memo';

const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res));

let red = 0, tot = 0;
const eq = (name, got, want) => {
  tot++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log('  ✓ ' + name);
  else { red++; console.log('  ✗ ' + name + '\n      量到 ' + JSON.stringify(got) + '\n      该是 ' + JSON.stringify(want)); }
  return ok;
};
const ok = (name, cond, got) => {
  tot++;
  if (cond) console.log('  ✓ ' + name); else { red++; console.log('  ✗ ' + name + '    ← 实际：' + JSON.stringify(got)); }
  return !!cond;
};

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {}; const exceptions = [];
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.method === 'Runtime.exceptionThrown') exceptions.push(r.params && r.params.exceptionDetails && r.params.exceptionDetails.text);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; }
  });
  await new Promise(r => ws.on('open', r));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面里抛了：' + JSON.stringify(r.result.exceptionDetails.exception));
    return r.result.result.value;
  };

  // ---- 等它活过来，别等一个固定的毫秒数（第 ⑤ 条）----
  const ready = () => ev(`!!(window.SR && SR.chat && SR.memo && SR.memo.__size
      && document.getElementById('onep') && document.getElementById('msgs')
      && document.getElementById('msgs').children.length > 0)`);
  const comeAlive = async () => {
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 80; i++) { if (await ready()) return true; await sleep(250); }
    return false;
  };

  if (!await comeAlive()) {
    console.log('⛔ 尺子坏了：等了 20 秒，页面都没起来（SR.chat / #onep / 开场白 差一样）。');
    console.log('   这会儿量到什么都不算数——它量的是"页面还没活"，不是"记忆坏了"。');
    await closeTab(t.id); process.exit(3);
  }
  await send('Page.bringToFront', {});

  console.log('【零】量具自己先对准：坐标落在按钮上了吗');
  const boxOf = async sel => {
    await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e)e.scrollIntoView({block:'center'});})()`);
    await sleep(220);
    return await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
  };
  const hitIs = async (sel, p) => await ev(`(function(){var e=document.elementFromPoint(${p.x},${p.y}),b=document.querySelector(${JSON.stringify(sel)});return !!(e&&b&&(e===b||b.contains(e)));})()`);
  const click = async sel => {
    const p = await boxOf(sel);
    if (!p) return { hits: false };
    const hits = await hitIs(sel, p);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(320);
    return { hits };
  };

  // ============================================================
  console.log('\n【一】先把这一场摆成"空场"，然后说两句（模型是假的）');
  await ev(`localStorage.removeItem(${JSON.stringify(KEY)});
            SR.chat.reset(SR.chat.getWork(), {wipe:true}); 1`);
  await sleep(300);
  eq('清完之后，浏览器里那个键是没的', await ev(`localStorage.getItem(${JSON.stringify(KEY)})===null`), true);
  eq('清完之后屏幕上只剩开场白', await ev(`document.querySelectorAll('#msgs .msg').length`), 1);

  // ★ 假模型：把这一轮该说的"话"直接喂回去。
  //   它替换的是**网络那一层**，submit 后面那一整条路（记账、摆气泡、口袋）照样真跑。
  const stub = reply => `SR.api.ask=function(o){o.onChunk(${JSON.stringify(reply)});return Promise.resolve({text:${JSON.stringify(reply)}});};1`;
  // ★ 等"真多出来两条气泡"，不等一个固定的毫秒数（第 ⑤ 条那条道理，换成时间上的说法：
  //   等固定的时间，量到的是"我猜它这会儿该好了"；等状态变了，量到的才是事实）。
  const send1 = async (text, reply, wantMsgs, wantTurns) => {
    await ev(stub(reply));
    await ev(`SR.chat.submit(${JSON.stringify(text)})`);
    for (let i = 0; i < 60; i++) {
      await sleep(120);
      if (await ev(`document.querySelectorAll('#msgs .msg').length`) >= wantMsgs) break;
    }
    // ★ 落盘是**节流过的**（memo.js 里 400ms 攒一次），所以还得再等它真的写下去。
    //   等"盘上有"这件事，不等一个固定的毫秒数——固定毫秒数会在慢机器上偶发地红，
    //   而那种红看着跟"记忆坏了"一模一样，最费人。
    //   ⚠ 而且不能只等"这个键存在"：第一轮之后它**早就在了**，等到的是上一版的快照
    //     （第二轮那几条断言就会读到 turns=2 而红）。要等的是**这一轮也进去了**。
    for (let i = 0; i < 40; i++) {
      const d = await ev(`(function(){try{var o=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||'null');
          return o&&o.turns?o.turns.length:0;}catch(e){return 0;}})()`);
      if (d >= wantTurns) break;
      await sleep(100);
    }
    await sleep(80);
  };

  // ⚠ 这一句回复**故意不带任何"节标题"形状的行**（底下写的是「先让学生把原话复述一遍」，
  //   不是「第 1 节 · 复述」）：带了的话 chips.js 的 parseChain 会认出 1 节，
  //   口袋里就多一项「链 1 节」，而我要断言的正是"这一轮口袋里什么都没添"。
  //   测的东西得跟断言对得上，不然红的是我自己写错的假设。
  const R1 = '这一节我先摆出来。\n先让学生把原话复述一遍。';
  await ev(`SR.main.applyWork('prep')`);
  await sleep(250);
  await send1('3.1 用代数式表示数量关系', R1, 3, 2);

  const stored = () => ev(`(function(){try{return JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||'null');}catch(e){return null;}})()`);
  let s = await stored();
  ok('★ 说完一轮，浏览器里真的落了一份记忆', !!(s && s.turns && s.turns.length === 2), s && s.turns && s.turns.length);
  eq('记的是**这一轮的两条**（老师一条、模型一条）',
    s && s.turns.map(x => x.r), ['u', 'a']);
  eq('存的是模型吐的**原文**（重画要靠它）', s && s.turns[1].t, R1);
  eq('这一轮在哪个工位也记下了', s && s.turns[0].w, 'prep');
  eq('★ 课题是从第一句话里取的', s && s.pocket.topic, '3.1 用代数式表示数量关系');
  eq('★ 喂给模型的那份跟屏幕那份同源', await ev(`JSON.stringify(SR.memo.history())`),
    JSON.stringify([{ role: 'user', content: '3.1 用代数式表示数量关系' }, { role: 'assistant', content: R1 }]));

  console.log('\n【二】「这一份」那一行：人这边看得见，而且点得动');
  eq('口袋现在写着什么', await ev(`document.getElementById('op-bag').textContent`), '口袋空着');
  ok('课题已经摆到那一行上了',
    (await ev(`document.getElementById('op-topic').textContent`)).indexOf('3.1') === 0,
    await ev(`document.getElementById('op-topic').textContent`));
  ok('班级那一格在等人填（不是空白线）',
    (await ev(`document.getElementById('op-cls').textContent`)) === '哪个班',
    await ev(`document.getElementById('op-cls').textContent`));

  const pt = await boxOf('#op-cls');
  ok('★ 点得着班级那一格（坐标真落在它身上）', pt ? await hitIs('#op-cls', pt) : false, pt);
  if (pt) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(260);
  }
  ok('★ 点一下原地变成输入框', await ev(`!!document.querySelector('#op-cls input.opedit')`), true);
  await ev(`(function(){var i=document.querySelector('#op-cls input.opedit');
      i.value='七(7)班'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await sleep(260);
  eq('改完的班级落到了屏幕上', await ev(`document.getElementById('op-cls').textContent`), '七(7)班');
  // ★ 同上：回车那一下只是把写盘**排上了队**（400ms 节流），数完 260ms 去读到的
  //   是**上一版**。等它真写下去；等超时了就把实情报出来，不许替它圆。
  let diskCls = '';
  for (let i = 0; i < 30; i++) {
    diskCls = ((await stored()) || { pocket: {} }).pocket.cls;
    if (diskCls === '七(7)班') break;
    await sleep(100);
  }
  eq('★ 也落到了盘上（刷新之后还在的才是真存了）', diskCls, '七(7)班');
  ok('焦点回得来（不然老师接着敲字一个字都进不去）',
    await ev(`document.activeElement && document.activeElement.id==='input'`),
    await ev(`document.activeElement && document.activeElement.tagName+'#'+document.activeElement.id`));

  console.log('\n【三】★ 切工位：上一场的对话不丢，上一场和下一场之间接一条分界线');
  const beforeSwitch = await ev(`document.querySelectorAll('#msgs .msg').length`);
  await ev(`SR.main.applyWork('vary')`);
  await sleep(400);
  // ⚠ 这里比的**不是"气泡一条都没少"**：切过去之后那条开场白会退场，
  //   因为它本来就不是"这一场说过的话"（它是上一个工位的一句招揽）。
  //   要保证的是**这一场说过的话一条不少**——所以拿它对"记忆里有几条"。
  eq('★ 换了工位，上一场说过的话一条都不少',
    await ev(`document.querySelectorAll('#msgs .msg').length`),
    await ev(`SR.memo.turns().length`));
  const msgsTxt = await ev(`document.getElementById('msgs').textContent`);
  ok('上一场老师说的那句还在', /3\.1 用代数式表示数量关系/.test(msgsTxt), msgsTxt.slice(0, 60));
  ok('上一场模型答的那句也还在', /先让学生把原话复述一遍/.test(msgsTxt), msgsTxt.slice(0, 60));
  ok('开场白退场了（它不是这一场的话）', !/告诉我你的问题/.test(msgsTxt), msgsTxt.slice(0, 60));
  // ⓘ 这一格**现在还不该有分界线**：刚换过来、还没在新工位说任何话，
  //   "上一场／下一场"的接缝还没产生。分界线画在**下一轮的第一条**前面。
  eq('还没在新工位说话，就还不该有分界线', await ev(`document.querySelectorAll('#msgs .wdiv').length`), 0);

  // ⚠ 这份假回复**必须是命题那一格的形状**（「变式一（改条件）」这种中文小标题），
  //   不能是组卷那种裸的 `#0 第一题`：
  //   memo.js 的 countProbs 2026-10-03 改严了——只认两种**产品自己的格式契约**
  //   （```材料 围栏里的题号行 / 一行「变式N」小标题），围栏外面裸着的 `#N` 一个字都不认。
  //   还在喂旧形状的话，prob 数出来是 0，produced() 照「是 0 的一个都不记」把这一笔丢掉，
  //   口袋就空着——**红的是这份假数据，不是产品**（旧契约下它确实数得出 2）。
  //   这一格是 vary（命题），所以喂命题的形状才是对的（顺带也把新契约量上了）。
  const R2 = '好的。\n变式一（改条件）\n把它改成从大到小排。\n变式二（反过来问）\n'
    + '给了答案，问原来的数可能是几。\n';
  await send1('出两道题', R2, beforeSwitch + 2, 4);
  eq('★ 新工位说了话，接缝这就出来了', await ev(`document.querySelectorAll('#msgs .wdiv').length`), 1);
  ok('分界线上写的是换到哪一件',
    /命题/.test(await ev(`document.querySelector('#msgs .wdiv').textContent`)),
    await ev(`document.querySelector('#msgs .wdiv').textContent`));
  // ★ 分界线**不是**一条消息：它不是模型说的话，做成气泡就会被挂上
  //   "数根 / MATHROOT"那块铭牌，看着像它说过这句。
  ok('分界线没被算成一条消息',
    await ev(`!!document.querySelector('#msgs .wdiv') && !document.querySelector('#msgs .wdiv').classList.contains('msg')`),
    await ev(`document.querySelector('#msgs .wdiv').className`));

  // 口袋那笔账（produced）写在对话之后，是**第二次**落盘。所以要等的是它，
  // 不是"对话进去了"——那一次盘上还没有题。
  for (let i = 0; i < 30; i++) {
    s = await stored();
    if (s && s.pocket && s.pocket.marks && s.pocket.marks.prob === 2) break;
    await sleep(100);
  }
  eq('第二轮也记下了', s && s.turns.length, 4);
  eq('★ 这一轮的口袋添了 2 道题', await ev(`document.getElementById('op-bag').textContent`),
    '口袋：题 2 道');
  eq('四个工位里只有出题那个数会动', s && s.pocket.marks, { prob: 2 });

  console.log('\n【四】★ 真的关掉再开一次（不是 reload）');
  const wantMsgs = await ev(`document.querySelectorAll('#msgs .msg').length`);
  const wantHist = await ev(`JSON.stringify(SR.memo.history())`);

  if (RED) {
    // ★★ 红验：让"这一场没有记忆"真的发生，再开一次页面。
    //   尺子要是还全绿，说明它量的**不是记忆**（可能是别处还在替它兜着）。
    //   （动手在**导航之前**——导航之后动，动的是给下次用的，跟这次恢复无关。）
    //
    // ⚠⚠ 这里踩过一个坑，值得留在这儿：**只删 `localStorage` 那一份是不够的。**
    //   第一次就是这么写的，页面照样全恢复——因为 memo.js 的 `pagehide` 兜底
    //   在离开这一页的那一刻把内存里那份**又写回盘上了**，正好写在我删的后面。
    //   删掉的和写回的都在"导航前"，看着像删了，其实没删成。
    //   这条跟尺子无关、是**产品真实的行为**（关页面时保住记忆，是对的），
    //   但"造一个没有记忆的世界"就得连内存那份一起清——`clear()` 正是干这个的，
    //   它是产品自己的"没有记忆"状态，不是我在旁边另造一个（[[scanner-numbers-are-not-what-they-claim]]）。
    console.log('红验模式：开之前把这一场的记忆清掉（盘上那份也删掉）');
    await ev(`SR.memo.clear(); localStorage.removeItem(${JSON.stringify(KEY)}); 1`);
  }

  if (!await comeAlive()) {
    console.log('⛔ 尺子坏了：第二次开页面也没起来，这一趟不算数。');
    await closeTab(t.id); process.exit(3);
  }
  await send('Page.bringToFront', {});
  if (RED) {
    // 红验那一趟只量"恢复"这件事
    const m = await ev(`document.querySelectorAll('#msgs .msg').length`);
    const h = await ev(`JSON.stringify(SR.memo.history())`);
    eq('[红验] 开完还是原来的气泡数（记忆被删了就该不是）', m, wantMsgs);
    eq('[红验] 开完 history 还是原来那份（记忆被删了就该不是）', h, wantHist);
  } else {
    eq('★ 开完气泡还是原来那么多', await ev(`document.querySelectorAll('#msgs .msg').length`), wantMsgs);
    eq('★ 开完喂给模型的还是原来那份（连一字不差）', await ev(`JSON.stringify(SR.memo.history())`), wantHist);
    eq('★ 分界线也一起回来了', await ev(`document.querySelectorAll('#msgs .wdiv').length`), 1);
    eq('课题还在', await ev(`document.getElementById('op-topic').textContent`), '3.1 用代数式表示数量关系');
    eq('班级还在', await ev(`document.getElementById('op-cls').textContent`), '七(7)班');
    eq('口袋还在', await ev(`document.getElementById('op-bag').textContent`), '口袋：题 2 道');
    ok('★ 打包的账本也照记忆重建了（不然包会少半场）',
      await ev(`SR.pack.turns().length`) === 2, await ev(`SR.pack.turns().length`));
    ok('这一场是"已经开说过"的（首屏不该再挡一次）',
      await ev(`SR.chat.hasUser()`) === true, await ev(`SR.chat.hasUser()`));
  }

  if (!RED) {
    console.log('\n【五】★ 只有 ⟳ 能清');
    const c = await click('#newbtn');
    ok('★ 刷新按钮点得着（坐标真落在它身上）', c.hits, c);
    eq('键真的从浏览器里拿掉了', await ev(`localStorage.getItem(${JSON.stringify(KEY)})===null`), true);
    eq('屏幕回到开场白那一条', await ev(`document.querySelectorAll('#msgs .msg').length`), 1);
    eq('喂给模型的清空了', await ev(`JSON.stringify(SR.memo.history())`), '[]');
    eq('课题回到"还没定"', await ev(`document.getElementById('op-topic').textContent`), '还没定');
    eq('口袋回到空着', await ev(`document.getElementById('op-bag').textContent`), '口袋空着');
    eq('分界线也一起没了', await ev(`document.querySelectorAll('#msgs .wdiv').length`), 0);
    ok('打包的账本也清了', await ev(`SR.pack.turns().length`) === 0, await ev(`SR.pack.turns().length`));

    console.log('\n【六】清完再开一次：不许"自己长回来"');
    if (!await comeAlive()) { console.log('⛔ 尺子坏了：第三次开也没起来。'); await closeTab(t.id); process.exit(3); }
    await send('Page.bringToFront', {});
    eq('★ 开完还是空的（清了就是清了）', await ev(`document.querySelectorAll('#msgs .msg').length`), 1);
    eq('课題还是"还没定"', await ev(`document.getElementById('op-topic').textContent`), '还没定');
  }

  if (exceptions.length) console.log('\n⚠ 页面里抛过异常：' + JSON.stringify(exceptions.slice(0, 4)));

  await closeTab(t.id);
  console.log('');
  if (RED) {
    if (red === 0) { console.log('⛔ 尺子坏了：记忆都删干净了，它居然还是全绿。这份结果不能用。'); process.exit(3); }
    console.log('✓ 红验通过：真删掉记忆之后红了 ' + red + '/' + tot + ' 条——它会红，所以刚才的绿才有意义。');
    process.exit(1);
  }
  if (red) { console.log('✗ ' + red + '/' + tot + ' 条不对'); process.exit(1); }
  console.log('✓ ' + tot + '/' + tot + ' 全过');
  process.exit(0);
})().catch(async e => { console.log('炸了：' + e.message); process.exit(2); });

// 尺子：**正文让你点播放键，可画板上根本没有播放键**（孔老师 2026-10-03 截图那一档）。
//
// 这一档失败**不能靠真模型复现**：它写不写"点播放键"是随机的，而这条闸要防的
// 恰恰是"它写了、板上却没有"。所以验的是**闸本身**——喂好/坏两段原文 + 两种板子。
//
// ★ 这一把尺子最关键的一格是 ④（判别动作）：
//   `canPlay()` 必须在两种板子之间**真的翻面**。不翻面的话，②那条"好板子不补话"
//   就是恒真读数 —— 两次量的是同一个状态，绿得毫无信息。（老账：
//   判别动作要挑会变的那个量，恒绿的断言等于没量。）
//
// 判据：
//   尺子自检  `#播放 t` 那条指令真能把 canPlay() 从假翻成真（没有它，下面全废）
//   ① 坏板子 + 正文提了播放  → **必须**补一句「没有播放键」，并挂一颗按钮
//   ② 好板子 + **同一段**正文 → **必须**不补话（同上输入，只有板子变了）
//   ③ 坏板子 + 正文没提播放  → 不补话（别到处插嘴）
//   ④ 收尾：探针插进去的那条气泡、那条补话，一并清掉，不留痕
//
// 用法：node test/probe_playclaim.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 孔老师截图里那一句，**一个字都没改**。
const 真话 = '现在，点播放键，圆就会绕着点 A 旋转，可以看到它的侧面。';
const 别的话 = '我把这个圆画好了，你可以自己拖动点 B 改大小。';

let 过 = 0, 败 = 0;
const 判 = (名, ok, 附) => { console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (附 ? '　' + 附 : '')); ok ? 过++ : 败++ };

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    return R && R.result ? R.result.value : null };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 50; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});
  const 存前 = await q("(function(){var o={};['mathroot_memo','mathroot_work','mathroot_backend'].forEach(function(k){o[k]=localStorage.getItem(k)});return o})()");

  const 画 = async (行) => {
    await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(300);
    await q('window.__行=' + JSON.stringify(行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let z = 0; z < 40; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(400);
  };
  // 插一条**假气泡**当挂载点，跑一次闸，读它补了几句话。
  // ★ 走的是真口子 `SR.chat.__说播放这一茬`，不是我另写一份判断——
  //   另写一份就是两套规则，量出来的绿跟产品没关系。
  const 跑一回 = async (正文) => q(`(function(){
    var el=document.createElement('div'); el.className='msg assistant'; el.id='probe-bub';
    var b=document.createElement('div'); b.className='bubble'; b.textContent='（探针插的假气泡）';
    el.appendChild(b); document.getElementById('msgs').appendChild(el);
    SR.chat.__说播放这一茬(el, {lastVisible: ${JSON.stringify(正文)}});
    return new Promise(function(res){ setTimeout(function(){
      var ns=el.querySelectorAll('.localnote');
      var 有按钮=false;
      for(var i=0;i<ns.length;i++) if(ns[i].querySelector('.lnbtn')) 有按钮=true;
      var 文=''; for(var j=0;j<ns.length;j++) 文+=ns[j].textContent;
      // ★ 把**量的时候板子是什么样**一起记下来。这条不是装饰：
      //   第一版探针就是从自检那一格直接接了 ①，而自检留在板上的是**能播的那张**——
      //   于是 ① 量的是"好板子"，读数当然是没有补话，红得让人以为产品坏了。
      //   把板子状态跟着读数一起带出来，这种"量错了对象"当场就看得出来。
      res({条数:ns.length, 有按钮:有按钮, 提没提播放键:文.indexOf('没有播放键')>=0,
           量的时候能播:!!(SR.board&&SR.board.canPlay&&SR.board.canPlay())});
    }, 1200) });
  })()`);
  const 清气泡 = () => q("(function(){var e=document.getElementById('probe-bub'); if(e&&e.parentNode)e.parentNode.removeChild(e); return 1})()");

  // ---- 尺子自检：`#播放` 这条指令真能翻面吗 ----
  console.log('◆ 尺子自检（这一格不绿，下面全别信）');
  await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'c=圆(A,B)']);
  const 坏板 = await q('SR.board.canPlay()');
  await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'c=圆(A,B)', 't=Slider(0,2*pi,0.05)', '#隐藏 t', 'r=旋转(c, t, B)', '#播放 t']);
  const 好板 = await q('SR.board.canPlay()');
  判('自检 ④ 坏板子 canPlay()=假、好板子 canPlay()=真（它会翻面，下面才不是恒绿）',
    坏板 === false && 好板 === true, JSON.stringify({ 坏板, 好板 }));

  console.log('◆ 三个判据');
  // ★ 先把板子**重新画成不能播的**再上 ①：上面自检最后留在板上的是那张能播的。
  await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'c=圆(A,B)']);
  const 甲 = await 跑一回(真话);
  判('① 坏板子 + 正文提了播放 → 补一句「没有播放键」，且挂着按钮',
    甲.条数 === 1 && 甲.有按钮 === true && 甲.提没提播放键 === true && 甲.量的时候能播 === false,
    JSON.stringify(甲));
  await 清气泡();

  await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'c=圆(A,B)', 't=Slider(0,2*pi,0.05)', '#隐藏 t', 'r=旋转(c, t, B)', '#播放 t']);
  const 乙 = await 跑一回(真话);
  判('② 好板子 + **同一段**正文 → 一句话都不补（判别：只换了板子）',
    乙.条数 === 0 && 乙.量的时候能播 === true, JSON.stringify(乙));
  await 清气泡();

  await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'c=圆(A,B)']);
  const 丙 = await 跑一回(别的话);
  判('③ 坏板子 + 正文没提播放 → 不补话（别到处插嘴）',
    丙.条数 === 0 && 丙.量的时候能播 === false, JSON.stringify(丙));
  await 清气泡();

  判('④ 收尾：探针那条假气泡已摘掉，页面上不留痕',
    (await q("document.querySelectorAll('#probe-bub').length")) === 0);

  await q('SR.board.clear()'); await sleep(200);
  await q('(function(){var s=' + JSON.stringify(存前) + ';Object.keys(s).forEach(function(k){if(s[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,s[k])});return 1})()');
  console.log('\n结果：' + 过 + ' 通过, ' + 败 + ' 失败');
  ws.close(); await put('/json/close/' + t.id);
  process.exit(败 ? 1 : 0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

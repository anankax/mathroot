// 尺子：**这张图拖得动吗** —— 量「依赖关系」，不量「看着像不像」。
//
// 来路一：孔老师「为啥不绕着A转啊」—— 他说的就是这件事：板子是**照片**还是**机器**。
// 来路二：GeoChat（github.com/tiwe0/GeoChat，Apache-2.0）的 dynamic-construction-validation
//         技能里那两行 `equalCheck = Distance(M,A)==Distance(M,B)` /
//         `perpendicularCheck = ArePerpendicular(...)`：它把"看图"换成了**板上自证的布尔量**。
//         借的是那个轴，读数的写法是自己写的。
//
// 量法（不碰题目、不认名字，只问板子自己）：
//   ① 找**自由点**：类型 point 且 `ggbApplet.isIndependent(n)===true`
//   ② 把每个自由点挪到别处（setCoords），数**别的对象里有多少个跟着变了**，再挪回去
//   ③ 全放回后复验一遍：读数一样才作数（尺子不许改板子）
//
// 三个读数：
//   · 带动表　　每个自由点各自带动了谁
//   · 可达集　　能被**任何**自由点带动的对象（图上"活"的部分）
//   · 惰性自由点 ★ 挪了谁也不动的自由点。**这是本尺子的主读数。**
//       题目给的点（A、B）如果是惰性的，说明图上没有一处用到它 —— 那是把答案
//       摆在板上，不是作出来的。读作「照片」。
//
// ★ 尺子自检（每次跑都做）：两套只差**一行**的板子 —— 死板 `M=(2,0)` ／ 活板 `M=中点(A,B)`。
//   **按对象读**：死板里挪 A 不该动 M，活板里必须动 M。
//   ★ 第一版这里判错了：我拿"所有自由点带动数的总和"当读数，结果两套板子共用的
//     `c=圆(A,B)` 本身就是真依赖，把 M 那一行的差别盖掉了，读数成了"死 2 / 活 4"。
//     数字没错，错的是它量的是**总和**而不是**那一行**（[[scanner-numbers-are-not-what-they-claim]]）。
//
// 用法：node test/probe_drag.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 只差一行的一对板子 ───────────────────────────────────────────
const 头 = ['#清空', 'A=(0,0)', 'B=(4,0)'];
const 死板 = 头.concat(['M=(2,0)']);
const 活板 = 头.concat(['M=中点(A,B)']);

// ── 真东西：尺规中垂线，两种做法 ─────────────────────────────────
// 活：两弧交出来连成直线 —— 这是作图
const 尺规活 = ['#清空', 'A=(0,0)', 'B=(4,0)', 'c1=圆(A,B)', 'c2=圆(B,A)', 'P=交点(c1,c2,1)', 'Q=交点(c1,c2,2)', 'L=直线(P,Q)'];
// 死：把答案的坐标摆上去 —— 图上看着一样，但 A、B 谁也不影响
const 尺规死 = ['#清空', 'A=(0,0)', 'B=(4,0)', 'P=(2,3.464)', 'Q=(2,-3.464)', 'L=直线(P,Q)'];

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

  // ── 页面里的量法 ──────────────────────────────────────────────
  await q(`window.__值=function(n){
    try{
      if(ggbApplet.getObjectType(n)==='point') return ggbApplet.getXcoord(n)+','+ggbApplet.getYcoord(n);
      return String(ggbApplet.getValueString(n));
    }catch(e){ return '?ERR' }
  }`);
  await q(`window.__快照=function(名){ var o={}; 名.forEach(function(n){ o[n]=window.__值(n) }); return o }`);
  // ★ 自由点必须用 isIndependent ——
  //   实测：自由点 A=(0,0) 的 getDefinitionString 返回的是**值** "(0, 0)"，
  //   拿「定义串为空」认，一个都认不出来，读数于是成了「带动 0 个」，
  //   跟"这张图是照片"长得一模一样。（[[scanner-numbers-are-not-what-they-claim]]）
  await q(`window.__自由点=function(名){
    var r=[]; 名.forEach(function(n){
      try{ if(ggbApplet.getObjectType(n)==='point' && ggbApplet.isIndependent(n)===true) r.push(n) }catch(e){}
    }); return r;
  }`);
  await q(`window.__板上有点=function(名){ var k=0; 名.forEach(function(n){ try{ if(ggbApplet.getObjectType(n)==='point') k++ }catch(e){} }); return k }`);

  await q(`window.__拖一遍=function(dx, dy){
    var 名 = ggbApplet.getAllObjectNames();
    var 前 = window.__快照(名);
    var 自由 = window.__自由点(名);
    var 报 = [], 可达 = {};
    自由.forEach(function(n){
      var 位 = String(前[n]).split(',');
      var x0 = parseFloat(位[0]), y0 = parseFloat(位[1]);
      if(!isFinite(x0)||!isFinite(y0)) return;
      try{ ggbApplet.setCoords(n, x0+dx, y0+dy) }catch(e){ return }
      var 后 = window.__快照(名);
      try{ ggbApplet.setCoords(n, x0, y0) }catch(e){}
      var 变=[]; 名.forEach(function(m){ if(m!==n && 后[m]!==前[m]){ 变.push(m); 可达[m]=1 } });
      报.push({ 点:n, 带动:变.length, 带上:变 });
    });
    var 尾 = window.__快照(名);
    var 走样 = 名.filter(function(m){ return 尾[m]!==前[m] });
    var 惰性 = 报.filter(function(b){ return b.带动===0 }).map(function(b){ return b.点 });
    return {
      对象: 名.length, 板上有点: window.__板上有点(名), 自由点: 自由.length,
      报: 报, 可达: Object.keys(可达), 惰性自由点: 惰性,
      我动过的没复原: 走样
    };
  }`);

  const 画 = async (行) => {
    await q('window.__行=' + JSON.stringify(行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let z = 0; z < 40; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(700);
  };
  const 量 = async () => q('(function(){ try{ return window.__拖一遍(1.7, 1.3) }catch(e){ return {炸:String(e&&e.message||e)} } })()');

  const 跑 = async (名, 行) => {
    await 画(行);
    const 没认 = await q('(function(){try{return (SR.board.failed()||[])}catch(e){return []}})()');
    const r = await 量();
    console.log('\n── ' + 名 + ' ──');
    console.log('   板上：' + await q('(function(){try{return ggbApplet.getAllObjectNames().map(function(n){var t="?";try{t=ggbApplet.getObjectType(n)}catch(e){}var d="";try{d=String(ggbApplet.getDefinitionString(n))}catch(e){}return n+"["+t+"]"+(d?" = "+d:"")}).join("  |  ")}catch(e){return "?"}})()'));
    if (没认 && 没认.length) console.log('   没认：' + JSON.stringify(没认));
    if (r && r.炸) { console.log('   ★ 量的时候炸了：' + r.炸); return { 名: 名, 炸: r.炸 } }
    const 瞎了 = r.自由点 === 0 && r.板上有点 > 0;
    console.log('   对象 ' + r.对象 + '，板上有点 ' + r.板上有点 + '，自由点 ' + r.自由点 + (r['我动过的没复原'].length ? '　★ 尺子自己把板子弄脏了：' + JSON.stringify(r['我动过的没复原']) : '　（放回去复原了）'));
    if (瞎了) console.log('   ★★ 尺子瞎了：板上有 ' + r.板上有点 + ' 个点，一个自由点都没认出来 —— 下面的数不作数。');
    r.报.forEach(b => console.log('     挪 ' + (b.点 + '　').padEnd(6) + '带动 ' + String(b.带动).padStart(2) + ' 个' + (b.带动 ? '　' + b.带上.join(',') : '　← 谁也不动')));
    console.log('   可达集 ' + r.可达.length + ' 个：' + (r.可达.join(',') || '（空）'));
    console.log('   ★ 惰性自由点 ' + r.惰性自由点.length + ' 个：' + (r.惰性自由点.length ? r.惰性自由点.join(',') + '　← 图上有地方根本没用到它' : '（一个都没有）'));
    return Object.assign({ 名: 名, 瞎了: 瞎了, 脏: r['我动过的没复原'].length, 没认: (没认 || []).length }, r);
  };

  console.log('════ 一、尺子自检：只差一行的两套板子（A、B 两套都一样）════');
  const 死 = await 跑('死板：M=(2,0)', 死板);
  const 活 = await 跑('活板：M=中点(A,B)', 活板);

  console.log('\n════ 二、真东西：尺规中垂线 ════');
  const 规活 = await 跑('尺规活：两弧交点连成直线', 尺规活);
  const 规死 = await 跑('尺规死：坐标摆在板上（看着一样）', 尺规死);

  // ── 对着具体对象判，不看总和 ──
  const 拿 = (r, 点, 对象) => { const b = (r.报 || []).find(x => x.点 === 点); return b ? (b.带上.indexOf(对象) >= 0) : null };
  const 检 = [
    { 名: '死板：挪 A 不动 M（答案摆着的）', 得: 拿(死, 'A', 'M'), 期: false },
    { 名: '活板：挪 A 动了 M（算出来的）', 得: 拿(活, 'A', 'M'), 期: true },
    { 名: '尺规活：挪 A 带动 P', 得: 拿(规活, 'A', 'P'), 期: true },
    { 名: '尺规活：挪 A 带动 L', 得: 拿(规活, 'A', 'L'), 期: true },
    { 名: '尺规死：挪 A 带不动 L（A 是摆设）', 得: 拿(规死, 'A', 'L'), 期: false },
    { 名: '尺规死：挪 A 带不动 P', 得: 拿(规死, 'A', 'P'), 期: false }
  ];
  console.log('\n════ 判定（对具体对象，不看总和）════');
  let 过 = 0;
  for (const c of 检) {
    const ok = c.得 === c.期;
    if (ok) 过++;
    console.log('  ' + (ok ? ' 绿' : '★ 红') + '　' + c.名 + '　（量到 ' + JSON.stringify(c.得) + '，期望 ' + JSON.stringify(c.期) + '）');
  }

  const 健康 = [死, 活, 规活, 规死].every(r => !r.炸 && !r.瞎了 && !r.脏);
  const 翻面 = 过 === 检.length;
  console.log('\n  ★ 尺子翻面自检：' + (翻面
    ? '全过（' + 过 + '/' + 检.length + '）—— 同一句 setCoords，死板那一行读 false、活板那一行读 true。'
    : '没过（' + 过 + '/' + 检.length + '），下面所有读数都不作数。'));
  console.log('  ' + (健康 ? ' 绿' : '★ 红') + '　四张板子都没炸／没瞎／没弄脏。');

  if (!翻面 || !健康) { await q('SR.board.clear()'); ws.close(); await put('/json/close/' + t.id); process.exit(3) }

  console.log('\n════ 三、主读数：这套东西对真题怎么说 ════');
  console.log('  尺度：惰性自由点 = 0 好；题目给的点要是惰性的，那就是把答案摆在了板上。');
  [规活, 规死].forEach(r => console.log('    ' + (r.惰性自由点.length === 0 ? ' 绿' : '★ 红') +
    '　惰性 ' + r.惰性自由点.length + '/' + r.自由点 + '　可达 ' + r.可达.length + ' 个　' + r.名));

  await q('SR.board.clear()');
  await q('(function(){var s=' + JSON.stringify(存前) + ';Object.keys(s).forEach(function(k){if(s[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,s[k])});return 1})()');
  ws.close(); await put('/json/close/' + t.id);
  process.exit(0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

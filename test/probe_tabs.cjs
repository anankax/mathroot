// 量具：右栏多页标签**到底能不能做、做成什么样**。（阶段三 · 先量再写码）
//
// ★★ 这是一把**量尺**，不是一道闸。它没有"通过/失败"——它把四个问题的原始读数
//   摆出来，让写码那一步有据可依。所以退出码只在**尺子自己坏了**（连不上画板、
//   连个点都建不出来）时才非零；四组读数本身再怎么难看，也照样是有效读数。
//   反过来：如果把"我期望的答案"焊进这个脚本，它就成了自证——
//   本仓库在 test/probe_math.cjs 顶上记过这一跤（逐字比对产品输出，
//   产品一改就喊"尺子坏了"），这里不重犯。
//
// 要回答的四个问题（全部**在真 applet 上量**，不查文档、不凭记忆）：
//   ① `getBase64/setBase64/getXML/setXML/getPerspectiveXML` 这一族到底有没有、
//      叫什么名字、**同步还是异步**、取回来的到底是什么格式
//   ② 画个正方体 → 存 → 清 → 载回：**三维视角回来了吗**（还是对象回来了、视角没回来）
//   ③ **在 `SR.board.isBusy()` 为真时取快照**：是不是只装了一半对象
//      （这一条决定"切页必须串行"到底是事实还是我的洁癖）
//   ④ `setBase64` 之后**立刻** `evalCommand`：对象在不在、我那条命令会不会被吃掉
//      （这一条决定 tabs 要不要"等就绪"）
//
// ★ 为什么非要实测：GeoGebra 的源码不在本机，而这一族方法名在版本之间改过。
//   猜错的后果跟 test/probe_3d.cjs 里那条 `Vector((1,2,3))` 一模一样——
//   **不抛异常、返回 false、什么都不发生**，画板上看不出任何区别。
//   所以下面每一条都**建出对象来判**：只看返回值就说 ok 的读数一律不算数。
//
// 用法：node test/probe_tabs.cjs          （要先起 `node test/serve.cjs 8138`）
// 产出：屏幕上四组读数 + 四张截图（_tabs_*.png），另外把两个快照落到 test/_tmp/ 里
//       ——写 tabs.js 的时候可以直接拿真快照当夹具。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PORT = process.env.PORT || 8138;
const OUT = path.join(__dirname, '_tmp');
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}

// ---- 这一份"要量什么"的清单。★ 名字全部是**猜的**——列出来就是为了看哪个是真的 ----
const NAMES = [
  'getBase64', 'setBase64', 'getXML', 'setXML', 'getPerspectiveXML', 'getFileJSON',
  'getUndoXML', 'setUndoXML', 'getPNGBase64', 'getScreenshotBase64',
  'newConstruction', 'evalCommand', 'getAllObjectNames', 'exists', 'getObjectNumber',
  'setPerspective', 'getPerspective', 'setAxesVisible', 'setCoordSystem', 'getCoordSystem',
  'registerAddListener', 'unregisterAddListener', 'setErrorDialogsActive'
];

const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
  });
  r.on('error', rej); r.end();
});
// ★ 关掉自己开的那一页：`/json/new` **只管开不管关**。
//   本仓库攒过 41 个标签页（见记忆「探针两条新坑」），别再来一次。
const closeTab = id => new Promise(res => {
  http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res);
});

let TAB = null;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  TAB = t.id;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });   // ★ 别吃缓存：本仓库栽过，会把已生效判成没生效
  await send('Page.bringToFront', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) {
      const ex = R.exceptionDetails.exception || {};
      return 'THROW: ' + String(ex.description || R.exceptionDetails.text).split('\n')[0].slice(0, 160);
    }
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const D = async (expr, ms) => { const a = await q(expr); await sleep(ms || 400); return a; };
  const shot = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(s.result.data, 'base64'));
    return name;
  };
  // 画板那块的图（带署名那条路是 shootMarked；这里要的是"看得见"，shoot 就够）
  const boardPNG = async name => {
    const u = await q('new Promise(function(r){SR.board.shoot(function(u){r(u||"")})})');
    if (typeof u === 'string' && u.indexOf('data:') === 0) {
      fs.writeFileSync(path.join(__dirname, name), Buffer.from(u.replace(/^data:[^,]*,/, ''), 'base64'));
      return name + '（' + u.length + ' 字节 base64）';
    }
    return '★ 没截到（' + u + '）';
  };

  await send('Page.navigate', { url: 'http://localhost:' + PORT + '/index.html?tabs=' + Date.now() });
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady&&SR.board.isReady())')) { up = true; break; }
  }

  // ================= 尺子自检 =================
  // ★ 只问一件事：**我在不在工作。** 不问产品对不对。
  console.log('===== 尺子自检 =====');
  if (!up) { console.log('  ★ 画板 60 秒没就绪，下面所有读数都不算数'); await closeTab(TAB); process.exit(3); }
  console.log('  画板就绪 ✓');
  if (await q('typeof ggbApplet') !== 'object') { console.log('  ★ 没有 ggbApplet，量不了'); await closeTab(TAB); process.exit(3); }
  // 能不能建出一个点？建不出来的话，下面"载入之后有几个对象"这种读数全是 0，毫无意义
  await q('ggbApplet.newConstruction()');
  await sleep(600);
  await q('ggbApplet.evalCommand("Z0=(1,1)")');
  await sleep(400);
  const canBuild = await q('JSON.stringify(ggbApplet.getAllObjectNames())');
  if (String(canBuild).indexOf('Z0') < 0) {
    console.log('  ★ 连一个点都建不出来（getAllObjectNames = ' + canBuild + '）——这把尺子现在量什么都一样，先别信它');
    await closeTab(TAB); process.exit(3);
  }
  console.log('  能建对象（getAllObjectNames = ' + canBuild + '）✓');
  const delay = await q('SR.GGB_CMD_DELAY');
  console.log('  每条命令的间隔 SR.GGB_CMD_DELAY = ' + delay + 'ms（下面算"画完要多久"用它，不自己假设）');
  await q('ggbApplet.newConstruction()');
  await sleep(500);

  // ================= ① 有哪些接口 =================
  console.log('\n===== ① applet 上这一族接口长什么样 =====');
  const types = await q('JSON.stringify(' + JSON.stringify(NAMES) + '.map(function(n){return n+"="+ (typeof ggbApplet[n])}))');
  JSON.parse(types).forEach(s => console.log('  ' + (/(-|object|function)/.test(s.split('=')[1]) ? (s.endsWith('=function') ? '✓ ' : '· ') : '× ') + s));

  // ★ "有这个方法"和"它真能用"是两件事（本仓库的老坑）。所以把可疑的挨个**调一下**看返回什么。
  console.log('\n  ---- 挨个真调一次，看返回什么（不是看 typeof）----');
  const tryCall = async (label, expr) => {
    const v = await q(expr);
    console.log('  ' + label.padEnd(34) + ' → ' + String(v).slice(0, 110));
    return v;
  };
  const gb = await tryCall('getBase64()', '(function(){try{var s=ggbApplet.getBase64();return (typeof s)+" 长度"+((s&&s.length)||0)+" 头:"+String(s).slice(0,24)}catch(e){return "THROW:"+e.message}})()');
  await tryCall('getXML()', '(function(){try{var s=ggbApplet.getXML();return (typeof s)+" 长度"+((s&&s.length)||0)+" 头:"+String(s).slice(0,90)}catch(e){return "THROW:"+e.message}})()');
  await tryCall('getPerspectiveXML()', '(function(){try{var s=ggbApplet.getPerspectiveXML();return (typeof s)+" "+String(s).slice(0,90)}catch(e){return "THROW:"+e.message}})()');
  // ⚠ 第一版这里写成 `(typeof s)+" 长度"+((s&&s.length)||0)`，于是 getFileJSON
  //   打成"object 长度0"——**它根本不是"空的"**，是对象没有 length。这一行读数当时
  //   看起来像"这个方法没返回东西"，其实是尺子在说一句它没量过的话。（老坑，见记忆
  //   「检测脚本的数字不是它宣称的那件事」。）改成按类型分别说清楚。
  await tryCall('getFileJSON()', '(function(){try{var s=ggbApplet.getFileJSON();' +
    'if(s==null)return "null";if(typeof s==="string")return "string 长度"+s.length;' +
    'if(typeof s==="object")return "object 键"+Object.keys(s).length+" 头:"+Object.keys(s).slice(0,6).join(",");' +
    'return typeof s+" "+String(s)}catch(e){return "THROW:"+e.message}})()');

  // ★★ getBase64 取回来的到底是"图片"、"压缩过的存档"，还是明文 XML？
  //   这一条直接决定 tabs 怎么存页。判法是**看字节**，不是看它像什么
  //   （base64 什么都像）。
  //   ⚠ 第一版这里只认 gzip（1f 8b），实测头两个字节是 **504b = "PK"**，
  //     于是打了一句"（不是 gzip）"就收工——**而它其实是个 ZIP**。
  //     更糟的是下面③拿这段字节去数 `<element`，数出 0 个还报"不是残的"，
  //     那是一条**假绿**。所以：认三种魔数，并且**数元素一律改走 getXML()**（明文）。
  console.log('\n  ---- getBase64 取回来的那段 base64，解出来是什么？----');
  if (typeof gb === 'string' && gb.indexOf('THROW') < 0) {
    const raw = await q('ggbApplet.getBase64()');
    const buf = Buffer.from(String(raw), 'base64');
    const magic = buf.slice(0, 2).toString('hex');
    const kind = magic === '1f8b' ? 'gzip' : (magic === '504b' ? 'zip' : (buf.slice(0, 5).toString('utf8') === '<?xml' ? 'xml' : '其它'));
    const SAY = {
      gzip: 'gzip：压缩过的存档（不是图片）',
      zip: '★ ZIP（504b = "PK"）：这就是一个 .ggb 文件——GeoGebra 的存档本来就是 zip',
      xml: '明文 XML',
      其它: '没认出来，头几个字节是 ' + buf.slice(0, 8).toString('hex')
    };
    console.log('  解出来 ' + buf.length + ' 字节，魔数 ' + magic + ' → ' + SAY[kind]);
    fs.writeFileSync(path.join(OUT, 'snapshot_sample.ggb'), buf);
    console.log('  原始字节落到 test/_tmp/snapshot_sample.ggb（写 tabs 时可以直接当夹具）');
    if (kind === 'zip') {
      // 只看条目名，不做完整解压（zip 里那个 xml 条目是 deflate 的，要解它得写个读头的小循环；
      // 而"里面有几个对象"这件事 **getXML() 直接就给了**，犯不着绕这一趟）
      const names = [];
      let p = 0;
      while ((p = buf.indexOf(Buffer.from('PK\x01\x02', 'binary'), p)) >= 0) {
        const nl = buf.readUInt16LE(p + 28);
        names.push(buf.slice(p + 46, p + 46 + nl).toString('utf8'));
        p += 4;
      }
      console.log('  zip 里 ' + names.length + ' 个条目：' + names.join('、'));
    }
  }

  // ================= ② 三维能不能存回来 =================
  console.log('\n===== ② 正方体 → 存 → 清 → 载回：视角回来了吗 =====');
  // ---- "眼前这块板是平面还是三维"，怎么判 ----
  //
  // ★★ 第一版拿"getXML 里有没有 `<euclidianView3D>`"当判据，报了个 ✓——**那是个假绿**。
  //   实测：清空 + 切回 'G' 之后（对象 0 个）这一条**仍然是 true**。
  //   它说的是"这个 applet 里有没有三维窗格"，不是"眼前画的是不是三维"。
  //   拿一个**两种状态取值相同的量**去区分两种状态，当然得出"一样"——那不是量出来的，是没量。
  //
  // ★★ 第二版换了"一条只在三维里认的命令"（`Sphere((7,7,7),1)`），
  //   并在平面状态先发了同一条当**负控**——**负控当场就把这个判据否了**：
  //   它在平面里照样返回 true、照样建出对象来。也就是说拿它判"是不是三维"等于没判。
  //   （这一条是这把尺子最值钱的地方：它自己把自己的假判据拦下来了。）
  //
  // 所以第三版**不再挑一条命令就断言**，改成量一整排候选，在**两个状态各测一遍**，
  // 谁真的会翻面，让读数自己说：
  //   a) `getPerspectiveXML()` 的**全文**（不是前 150 字——那一版只比了个开头，
  //      而恰好变的就是开头那句 view 的 visible；这是运气，不是设计）
  //   b) 一排"三维才可能认"的命令，平面/载回后各发一次，看新增了几个对象
  //   c) 图纸（_tabs_before/after.png）——视角长什么样的最终凭据
  //   ⚠ 判"视角是不是三维"也不能用 `SR.board.is3D()`——那是我们自己的布尔量，
  //     快照里根本没有它，拿它判就是拿"我以为的"当"板上真有的"。
  // ★ `getPerspectiveXML()` 全文有两千多字，一大半是工具栏按钮表——直接打两遍没法看。
  //   真正会翻面的那一位是**哪个 view 的 visible 是 true**：
  //   实测 平面 = `view id="1"`、三维 = `view id="512"`，两者此消彼长。
  //   所以对外只报这一行"可见的视图是哪些"，等式仍然拿**全文**比（比的是事实，不是摘要）。
  const visViews = s => {
    const out = [], re = /<view id="(\d+)"[^>]*?\svisible="true"/g;
    let m; while ((m = re.exec(String(s)))) out.push(m[1]);
    return out.sort((a, b) => a - b).join(',') || '（一个都没有）';
  };
  const viewState = `(function(){
    var out={names:(ggbApplet.getAllObjectNames()||[]).slice().sort(), views:[]};
    try{out.persp=String(ggbApplet.getPerspectiveXML()).replace(/\\s+/g,' ')}catch(e){out.persp='THROW:'+e.message}
    try{Array.prototype.forEach.call(document.querySelectorAll('#ggb canvas, #ggb .ggbView, #ggb .applet_scaler'),function(e){
        var r=e.getBoundingClientRect(); if(r.width>0&&r.height>0) out.views.push((e.className||e.tagName)+':'+Math.round(r.width)+'x'+Math.round(r.height));});}catch(e){}
    return JSON.stringify(out);})()`;

  // 候选判据：每一条都**在两个状态各发一次**，谁也不许"因为我知道它会失败"而跳过。
  const DISCRIM = [
    ['Cube((7,0,0),(8,0,0))', 'Cube(两点)'],
    ['Sphere((7,7,7),1)', 'Sphere(点,半径)'],
    ['Prism(Polygon((0,0,0),(1,0,0),(0,1,0)),2)', 'Prism(多边形,高)'],
    ['Segment((0,0,0),(1,1,1))', '带 z 的线段']
  ];
  const battery = async () => {
    const out = [];
    for (const [cmd, label] of DISCRIM) {
      const b = JSON.parse(await q('JSON.stringify(ggbApplet.getAllObjectNames())'));
      const ret = await q('(function(){try{return String(ggbApplet.evalCommand(' + JSON.stringify(cmd) + '))}catch(e){return "THROW:"+e.message}})()');
      await sleep(600);
      const a = JSON.parse(await q('JSON.stringify(ggbApplet.getAllObjectNames())'));
      out.push({ label: label, cmd: cmd, ret: ret, added: a.filter(n => b.indexOf(n) < 0).length });
    }
    return out;
  };

  await q('ggbApplet.newConstruction()'); await sleep(500);
  await q('ggbApplet.setPerspective("T")'); await sleep(2200);
  for (const c of ['A=(0,0,0)', 'B=(2,0,0)', 'Cube(A,B)']) { await q('ggbApplet.evalCommand(' + JSON.stringify(c) + ')'); await sleep(200); }
  await sleep(1200);
  const bj = JSON.parse(await q(viewState));
  console.log('  存之前：对象 ' + bj.names.length + ' 个 ' + JSON.stringify(bj.names));
  console.log('          可见的视图 id：' + visViews(bj.persp) + '（平面=1、三维=512，见下面 b）');
  console.log('          有尺寸的视图 ' + JSON.stringify(bj.views));
  console.log('  截图：' + await boardPNG('_tabs_before.png'));
  const snap = await q('ggbApplet.getBase64()');
  console.log('  存下快照：' + String(snap).length + ' 字符 base64');

  // ★ 清得**比切页更狠**：newConstruction + 切回平面。要是这样都还能载回来，
  //   那普通的切页（不清空、只换状态）就更稳。
  await q('ggbApplet.newConstruction()');
  await q('ggbApplet.setPerspective("G")');
  await sleep(1800);
  const cleared = JSON.parse(await q(viewState));
  console.log('  清掉之后：对象 ' + JSON.stringify(cleared.names) + '（空的 = 清干净了，下面载回来的读数才算数）');
  console.log('            可见的视图 id：' + visViews(cleared.persp));
  // ★ 负控的那一半：就在这个"我刚亲手切成的平面"上量这一排候选
  const bat2D = await battery();
  console.log('          ★ 负控（已知平面）那一排：' +
    bat2D.map(x => x.label + '→' + (x.added ? '建出' + x.added + '个' : '没建出来')).join('　'));

  // ---- 载回来 ----
  // ★★ setBase64 和"立刻读一眼"必须在**同一个 CDP 往返**里做完。
  //   第一版这里分两次 q()，中间隔着一整个往返（几十毫秒），却把那次读数标成"立刻（0ms）"——
  //   那是**给一个不成立的标签配了一个真读数**，比读错还坏：它看起来像结论。
  const tR = Date.now();
  const immRes = await q('(function(){var o={};try{o.ret=String(ggbApplet.setBase64(' + JSON.stringify(snap) + '))}catch(e){o.err=e.message}' +
    'try{o.imm=(ggbApplet.getAllObjectNames()||[]).slice().sort()}catch(e){o.immErr=e.message}' +
    'return JSON.stringify(o)})()');
  const imm = JSON.parse(immRes);
  console.log('  setBase64 返回 ' + (imm.err ? 'THROW:' + imm.err : imm.ret) +
    '　★ 同一个往返里立刻点名：' + JSON.stringify(imm.imm || []));
  // 然后**轮询到收敛**，别用一个拍脑袋的 sleep（睡了多久算够？没有答案，只有读数）
  let settled = null, waited = 0;
  for (let k = 0; k < 16; k++) {
    await sleep(400); waited = Math.round((k + 1) * 0.4 * 10) / 10;
    const v = JSON.parse(await q(viewState));
    if (v.names.join(',') === bj.names.join(',')) { settled = v; break; }
  }
  const after = settled || JSON.parse(await q(viewState));
  const ms = Date.now() - tR;
  console.log('  载入收敛：等了 ' + (settled ? waited + ' 秒（对象齐了）' : '6.4 秒（★ 一直没齐）') + '　总耗时 ' + ms + 'ms');
  console.log('  载回之后：对象 ' + after.names.length + ' 个 ' + JSON.stringify(after.names));
  console.log('            可见的视图 id：' + visViews(after.persp));
  console.log('            有尺寸的视图 ' + JSON.stringify(after.views));
  console.log('  截图：' + await boardPNG('_tabs_after.png'));

  const objSame = after.names.join(',') === bj.names.join(',');
  const perspSame = after.persp === bj.persp;
  const perspBackTo3D = after.persp !== cleared.persp;
  // ★ 正向那一半：载回之后，同一个候选排再量一遍
  const bat3D = await battery();
  console.log('  ★ 正向（载回之后）那一排：' +
    bat3D.map(x => x.label + '→' + (x.added ? '建出' + x.added + '个' : '没建出来')).join('　'));

  console.log('\n  ── 这一问的读数 ──');
  console.log('  a) 对象全都回来了？     ' + (objSame ? '是 ✓（' + after.names.length + ' 个，一模一样）'
    : '★ 不是：存之前 ' + JSON.stringify(bj.names) + ' → 载回 ' + JSON.stringify(after.names)));
  console.log('  b) 可见的视图回到三维？  ' + (perspSame
    ? '是 ✓（存之前 ' + visViews(bj.persp) + ' → 平面 ' + visViews(cleared.persp) + ' → 载回 ' + visViews(after.persp) +
      '，且 getPerspectiveXML **全文**逐字相同）'
    : (after.persp === cleared.persp
      ? '★ 不是：载回来的可见视图 = 平面那一份（' + visViews(after.persp) + '）——对象回来了、视角没回来'
      : '★ 不是：存之前 ' + visViews(bj.persp) + ' / 平面 ' + visViews(cleared.persp) + ' / 载回 ' + visViews(after.persp))));
  console.log('     （另外：载回那份 != 我亲手切的平面那份？' + (perspBackTo3D ? '是 → 视角确实跟着动了' : '不是 → **它俩一样**，那 b 说明的是"视角一直在平面"') + '）');
  // ★ 候选判据里**哪些真的会翻面**——让读数自己说，别由我挑一条然后当结论
  const flipped = DISCRIM.map((d, i) => ({ label: d[1], a2: bat2D[i].added, a3: bat3D[i].added }))
    .filter(x => (x.a2 > 0) !== (x.a3 > 0));
  console.log('  c) 候选判据里真会翻面的：' + (flipped.length
    ? flipped.map(x => x.label + '（平面' + x.a2 + '个 → 载回' + x.a3 + '个）').join('、')
    : '★ **一条都没有**——所有候选在两个状态里表现相同，也就是说这一整排都判不了"是不是三维"（这正是上一版 Sphere 栽的地方）'));
  console.log('  d) 说人话：把 _tabs_before.png 和 _tabs_after.png 两张图对一眼。');
  console.log('     a/b 判的是**板子自己报的字**，c 是行为，d 是外观——三条要说的话不一致，以 d 为准再回头查。');

  // ================= ③ 画到一半取快照，是不是半张 =================
  console.log('\n===== ③ 正在画（isBusy 为真）时取快照：是半张吗 =====');
  await q('ggbApplet.setPerspective("G")'); await sleep(1200);
  // ★★ 数"快照里装了几个对象"，**必须数 getXML()（明文），不能数 getBase64() 解出来的字节**。
  //   第一版就是拿 getBase64 解出的 buffer 去 match(`<element `) —— 而它里面是 **ZIP**，
  //   一个 XML 标签都没有，于是**两次都数出 0 个**，两次相等，脚本报"不是残的"：
  //   一条彻头彻尾的**假绿**。它错在我让尺子去数一个它根本读不懂的东西，还照样给了结论。
  //   （这就是"数字不是它宣称的那件事"这一族，本仓库记了十一个实例，这是第十二个。）
  const xmlCount = async () => {
    const x = await q('ggbApplet.getXML()');
    if (typeof x !== 'string') return { els: -1, len: 0 };
    return { els: (x.match(/<element /g) || []).length, len: x.length };
  };
  // 夹具是**够长的多行图**：命令数 × 间隔 = 画完要多久；太短的话根本来不及在中途取值。
  const FIG = ['#清空', '数轴', 'A=(-3,0)', 'B=(3,0)', 'Segment(A,B)', 'c=Circle(A,1)', 'f(x)=x^2', 'Slider(0,3,0.1)'];
  await q('ggbApplet.newConstruction()'); await sleep(500);
  await q('SR.board.run(' + JSON.stringify(FIG) + ')');
  await sleep(Math.round(delay * 2.5));                     // 走到第三条上下的样子
  const busyNow = await q('SR.board.isBusy()');
  const midNames = JSON.parse(await q('JSON.stringify(ggbApplet.getAllObjectNames())'));
  const midX = await xmlCount();
  // 等画完（轮询到 isBusy 假，不是睡一个猜的数）
  let done = false;
  for (let k = 0; k < 40; k++) { await sleep(400); if (!(await q('SR.board.isBusy()'))) { done = true; break; } }
  const endNames = JSON.parse(await q('JSON.stringify(ggbApplet.getAllObjectNames())'));
  const endX = await xmlCount();
  console.log('  这套图 ' + FIG.length + ' 条命令，每条隔 ' + delay + 'ms → 画完大约要 ' + (FIG.length * delay / 1000).toFixed(1) + ' 秒');
  console.log('  中途取值那一刻：isBusy=' + busyNow + '　对象 ' + midNames.length + ' 个 ' + JSON.stringify(midNames));
  console.log('                  getXML 里 <element> ' + midX.els + ' 个（' + midX.len + ' 字符）');
  console.log('  画完之后：      对象 ' + endNames.length + ' 个 ' + JSON.stringify(endNames));
  console.log('                  getXML 里 <element> ' + endX.els + ' 个（等到了' + (done ? '收敛' : '★超时') + '）');
  console.log('  ── 这一问的读数 ──');
  console.log('  中途拿到的快照比画完的少？ ' + (midX.els >= 0 && endX.els >= 0
    ? (midX.els < endX.els ? '★ 是：' + midX.els + ' < ' + endX.els + ' —— **画到一半的快照就是残的**（切页必须串行）'
      : (midX.els === endX.els ? '不是：' + midX.els + ' vs ' + endX.els + '（一样多）'
        : '★ 反而更多（' + midX.els + ' > ' + endX.els + '），这不对劲，得看一眼'))
    : '量不到（读快照失败）'));
  console.log('  ⚠ 这一问只说了"快照残不残"。**"该不该等"是设计决定，不是这里的读数**——');
  console.log('    但既然画板只有一块、切页要换掉板上的东西，串行是唯一不互相踩的做法。');

  // ================= ④ 载入之后立刻发命令，会不会被吃掉 =================
  console.log('\n===== ④ setBase64 之后立刻 evalCommand：在不在、会不会被吃 =====');
  await q('ggbApplet.newConstruction()'); await sleep(500);
  for (const c of ['P1=(1,1)', 'P2=(4,1)', 'Seg=Segment(P1,P2)']) { await q('ggbApplet.evalCommand(' + JSON.stringify(c) + ')'); await sleep(150); }
  await sleep(500);
  const snap4 = await q('ggbApplet.getBase64()');
  const base = JSON.parse(await q('JSON.stringify(ggbApplet.getAllObjectNames())'));
  await q('ggbApplet.newConstruction()'); await sleep(500);
  console.log('  存下 ' + JSON.stringify(base));
  // 一次表达式里把三件事连着做完：载入 → 立刻点名 → 立刻发一条新命令。
  // 分成三个 CDP 往返的话，中间那几十毫秒就把"立刻"给磨没了。
  const imm4 = await q('(function(){var o={};try{ggbApplet.setBase64(' + JSON.stringify(snap4) + ');}catch(e){o.err=e.message}' +
    'try{o.imm=(ggbApplet.getAllObjectNames()||[]).slice().sort()}catch(e){o.immErr=e.message}' +
    'try{o.cmdRet=String(ggbApplet.evalCommand("NEWP=(9,9)"))}catch(e){o.cmdErr=e.message}' +
    'try{o.after=(ggbApplet.getAllObjectNames()||[]).slice().sort()}catch(e){o.afterErr=e.message}' +
    'return JSON.stringify(o)})()');
  console.log('  同一个 CDP 往返里连着做（载入→点名→发命令→再点名）：');
  console.log('    ' + imm4);
  await sleep(1200);
  const end4 = JSON.parse(await q('JSON.stringify(ggbApplet.getAllObjectNames())'));
  console.log('  等 1.2 秒之后：' + JSON.stringify(end4));
  const hasNew = end4.indexOf('NEWP') >= 0;
  const backAll = base.every(n => end4.indexOf(n) >= 0);
  console.log('  ── 这一问的读数 ──');
  console.log('  载入后**立刻**就能点名？  ' + (JSON.parse(imm4).imm || []).length + ' 个（收敛之后 ' + end4.length + ' 个）');
  console.log('  我那条立刻发的命令留下了吗？ ' + (hasNew ? '留下来了 ✓（NEWP 在）' : '★ 被吃掉了（NEWP 不在）'));
  console.log('  存档里那几个对象都在吗？     ' + (backAll ? '都在 ✓' : '★ 缺了：' + base.filter(n => end4.indexOf(n) < 0).join('、')));
  console.log('  → 结论用不着猜：**载入之后要等到对象齐了再发命令**，而且"齐了"要轮询判，不能睡一个猜的数。');

  // ================= 顺带：连续切页会不会越切越脏 =================
  console.log('\n===== 顺带量：同一份快照来回载 5 次，对象会不会越滚越多 =====');
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await q('ggbApplet.newConstruction()'); await sleep(300);
    await q('ggbApplet.setBase64(' + JSON.stringify(snap4) + ')');
    let n = [], tries = 0;
    for (let k = 0; k < 12; k++) { await sleep(300); tries++; n = JSON.parse(await q('JSON.stringify(ggbApplet.getAllObjectNames())')); if (n.length >= base.length) break; }
    seen.push('第' + (i + 1) + '次 ' + n.length + ' 个/等了' + (tries * 0.3).toFixed(1) + 's');
  }
  console.log('  ' + seen.join('　'));
  console.log('  （每次都是 ' + base.length + ' 个 = 不滚；越切越多就是脏了）');

  // ================= 汇总 =================
  console.log('\n===== 要紧的读数，摆在一起 =====');
  console.log('  ① getBase64/setBase64 存在，取回的是一份 **.ggb 存档（zip）**——' + (typeof gb === 'string' && gb.indexOf('THROW') < 0 ? '亲测' : '★ 没测到'));
  console.log('  ② 对象来回：' + (objSame ? '一模一样' : '★ 对不上') +
    '；窗格布局：' + (perspSame ? '一模一样' : '★ 不一样') +
    '；会翻面的候选判据：' + (flipped.length ? flipped.map(x => x.label).join('、') : '★ 一条都没有'));
  console.log('  ③ 画到一半的快照：' + (midX.els >= 0 && endX.els >= 0
    ? (midX.els < endX.els ? '★ 是残的（' + midX.els + '/' + endX.els + '）→ 切页串行是事实，不是洁癖'
      : '取到的跟画完的一样多（' + midX.els + '/' + endX.els + '）') : '量不到'));
  console.log('  ④ 载入后立刻发命令：' + (hasNew ? '没被吃，但立刻点名只有 ' + (JSON.parse(imm4).imm || []).length + ' 个 → 仍要等' : '★ 被吃了 → 必须等'));
  console.log('\n  截图：_tabs_before.png / _tabs_after.png（两张的板子**应该长得一样**——三维视角那一问的真凭据）');
  console.log('  ★ 这把尺子只摆读数，不判对错。判"该怎么做"是下一步写 js/tabs.js 的事。');

  await closeTab(TAB);
  process.exit(0);
})().catch(async e => {
  console.error('坏：' + e.message + '\n' + String(e.stack).split('\n').slice(1, 4).join('\n'));
  if (TAB) await closeTab(TAB);
  process.exit(2);
});

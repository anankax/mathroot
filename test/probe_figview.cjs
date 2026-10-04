// 尺子：2026-10-04 孔老师提的那两件事，到底做出来了没有。
//
//   「还有就是为啥不让图直接显示出来，一定要我点一下才画出来」
//   「应该是这个 geogebra 窗口直接就在中央的位置蹦出来一个放大的窗口，
//     然后也可以叉掉的那种……还有也不应该叫"再摆弄"」
//
// ★★ 这把尺子只量**端到端**：不量"函数在不在"，量屏幕上发生的事。
//   一 与 二 是一对**红验**，量的是**同一个量**（屏幕上的真图张数）：
//     · 大窗开着 → 补图必须让路 → 那 8 秒里真图必须**一动不动**；
//     · 大窗一关 → 同一队接着跑 → 真图必须**自己长出来**（一次都不点）。
//   只有两格都量，才排得掉"它压根就不会补图"这种解释 ——
//   光有第二格的话，把整个补图删掉、换成"图刚画出来就贴缓存"，照样绿。
//   三 量名字。四 量**宽度**：抽屉里 vs 大窗里，两个数必须不一样 ——
//   只量"挂上了 open 类"的话，板根本没跟着变大（还是 520 宽）也照样绿。
// ★ "看得见吗"一律走 `getClientRects().length`，不走 `getComputedStyle().display`：
//   藏起来的可能是它的**父级**，孩子照样报 flex（踩过，见记忆 46 号那一族）。
//
// 用法：node test/probe_figview.cjs
//   前置：Chrome 在 9222（**要看得见**，不许 --headless）、serve 在 8138。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 过 = 0, 败 = 0;
const 判 = (名, ok, 附) => { console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (附 ? '　' + 附 : '')); ok ? 过++ : 败++ };

// 种进 memo 的那一条：正文里带一道 ```ggb 围栏，命令是探针里验证过画得出来的那一串。
const 假的回复 = [
  '先画一条线段 AB，再取它的中点。',
  '',
  '```ggb',
  '#清空',
  'A=(0,0)',
  'B=(3,0)',
  's=线段(A,B)',
  'm=中点(A,B)',
  '```'
].join('\n');

const 数图 = "(function(){return {真图:document.querySelectorAll('.figimg').length,占位:document.querySelectorAll('.figph').length,正在出图:document.querySelectorAll('.figph.pending').length,框:document.querySelectorAll('.figbox').length}})()";

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  // ★★ 一只**耳朵**：把页面里抛出来的异常全收下来。
  //   为什么非有不可：2026-10-04 这把尺子第一次跑，"补图"一声不吭、图一张没出来，
  //   而屏幕上、探针的读数里**一点痕迹都没有** —— 因为它死在 `setTimeout` 里，
  //   那种异常不会经由 `Runtime.evaluate` 回来（`q()` 那道判据量不到它）。
  //   光把异常打印出来还不够，末尾**要断言它为 0**：打印出来没人看的东西
  //   等于不存在（同族：写死的件数在"加一件"那天报成"仪器不对"）。
  const 页面异常 = [];
  ws.on('message', m => {
    const o = JSON.parse(m);
    if (o.method === 'Runtime.exceptionThrown') {
      const d = (o.params && o.params.exceptionDetails) || {};
      const 详 = (d.exception && d.exception.description) || d.text || '';
      页面异常.push(String(详).split('\n')[0].slice(0, 160));
    }
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] }
  });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });

  // ★ q：页面里炸了（exceptionDetails）**抛**，读回 undefined **返回 null**。
  //   （记忆 46 号那一族：`q()` 抛异常返回真值字符串、被当条件用 → 25 条假红。）
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    return R && R.result ? R.result.value : null;
  };
  // 等到某个表达式**严格 === true**（不是"真值"）。超时抛，不静默放行。
  const 等真 = async (式, 秒, 步) => {
    const n = Math.round(秒 * 1000 / (步 || 200));
    for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 200); await sleep(步 || 200) }
    return -1;
  };
  // 轮询到**值本身**（不是布尔）就把它拿回来，超时回 null。
  // ★ 什么时候要它而不是 `等真`：`等真` 只回"第几次成的"，
  //   而这一处我要的不是"成了没有"，是"成了的时候板上**是些什么**"——
  //   同一个问句里，`false` 是"还没好"，拿到数组才是"好且长这样"。
  const 等到值 = async (式, 秒, 步) => {
    const 到 = Date.now() + (秒 || 10) * 1000;
    let 第 = 0;
    while (Date.now() < 到) {
      const v = await q(式);
      if (v) return v;
      await sleep(步 || 300);
      第++;
    }
    return null;
  };
  // 量"画布摆在宿主里的哪一处"（相对 `#ggb` 的**内容盒**，左右各留多少）。
  // ★ 为什么量画布而不量那两个盒子宽不宽：盒子全都"报告满宽"，
  //   唯一会露馅的是画布**实际画在哪**（同族：别量声明，量落地）。
  const 量居中 = `(function(){
    var g = document.getElementById('ggb'), cv = document.querySelector('#ggb canvas');
    if (!g || !cv) return null;
    var gr = g.getBoundingClientRect(), cr = cv.getBoundingClientRect(), cs = getComputedStyle(g);
    var 内容左 = gr.left + (parseFloat(cs.paddingLeft) || 0);
    var 内容右 = gr.right - (parseFloat(cs.paddingRight) || 0);
    return {
      左: Math.round(cr.left - 内容左),
      右: Math.round(内容右 - cr.right),
      画布宽: Math.round(cr.width),
      宿主内容宽: Math.round(内容右 - 内容左)
    };
  })()`;

  // ── 种一条带图的对话，然后重开页（老师按 F5 那一下）────────────────────
  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=seed&t=' + Date.now() });
  await 等真('!!(window.SR&&SR.board&&SR.board.isReady())', 60);
  await sleep(400);
  const 存前 = await q("(function(){var o={};['mathroot_memo','mathroot_work','mathroot_backend'].forEach(function(k){o[k]=localStorage.getItem(k)});return o})()");
  const 种了 = await q(`(function(){
    SR.memo.clear();
    SR.memo.pushTurn('u', '画一条线段 AB，取中点。', 'draw');
    SR.memo.pushTurn('a', ${JSON.stringify(假的回复)}, 'draw');
    SR.memo.flush();
    return { 轮数: SR.memo.log().length, 存档字节: SR.memo.__size() };
  })()`);
  console.log('\n（种一条带 ```ggb 的对话：' + JSON.stringify(种了) + '，然后重开页）');

  // ── 重开页，**在板还没就绪的时候**就把大窗开上 ────────────────────────
  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=cold&t=' + Date.now() });
  const 开窗用时 = await 等真('!!(window.SR && SR.main && SR.main.openBigFig)', 30, 100);
  判('尺子够得着 `SR.main.openBigFig`（够不着底下全不用量了）', 开窗用时 >= 0);
  await q('(function(){try{SR.main.openBigFig()}catch(e){}return 1})()');
  await 等真('!!(window.SR&&SR.board&&SR.board.isReady())', 60, 500);
  await send('Page.bringToFront', {});
  // ★ 万一刚才那一下没开上（比如 `.boardwrap` 那一刻还不在文档里，openBigFig 会
  //   静默 return），再补一下 —— 但把"补过没补过"如实报出来：
  //   要是靠补才开上的，那"冷启动第一秒就开窗"这件事本身就没量到，别拿它当结论。
  const 一次就开上 = await q('SR.main.bigFigOpen() === true');
  if (!一次就开上) { await q('(function(){SR.main.openBigFig();return 1})()'); await sleep(300) }
  console.log('  （大窗是"冷启动第一下就开上"的：' + 一次就开上 + '）');
  判('尺子自检：大窗**开得起来**（开不起来的话底下"真图没多"是废话 —— 补图本来也不会跑）',
    一次就开上 === true);

  // ── 一、红验：大窗开着，补图必须让路 ──────────────────────────────────
  console.log('\n── 一、红验：大窗开着的那几秒，补图不许在老师眼皮底下借板 ──');
  const 起手 = await q(数图);
  console.log('  大窗刚开上（板还没画好时就开的）　' + JSON.stringify(起手) + '　窗=' + !!await q('SR.main.bigFigOpen()'));
  let 红验里出图 = 0;
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const s = await q(数图);
    if (s && s.真图 > 红验里出图) 红验里出图 = s.真图;
  }
  const 红验尾 = await q(数图);
  console.log('  8 秒之后 → ' + JSON.stringify(红验尾));
  判('前提：这一刻大窗**确实开着**（不开着的话这一格量的是别的东西）', await q('SR.main.bigFigOpen() === true'));
  判('前提：这一屏**确实有一张等着补的图**（框 >= 1，不然下面"没动"是废话）', 起手.框 >= 1, JSON.stringify(起手));
  判('★★ 红验：大窗开着的 8 秒里，真图**一张都没多**（补图让路了）', 红验里出图 === 0, '最多见过 ' + 红验里出图 + ' 张');

  // ── 二、正验：关掉大窗，同一个量必须自己动 ────────────────────────────
  console.log('\n── 二、正验：关掉大窗，图自己长出来（全程不点）──');
  await q('(function(){SR.main.closeBigFig();return 1})()');
  let 见真图 = -1, 见正在出图 = false;
  for (let i = 0; i < 300; i++) {
    await sleep(400);
    const s = await q(数图);
    if (s && s.正在出图 > 0) 见正在出图 = true;
    if (s && s.真图 > 0) { 见真图 = (i + 1) * 0.4; break }
  }
  console.log('  ' + (见真图 < 0 ? '等 120 秒没等到' : 见真图.toFixed(1) + ' 秒时出来的'));
  判('★ 中途真出现过「正在出图…」（说明走的是补图那条路，不是凭空蹦出来的）', 见正在出图);
  判('★★ 一次都没点，真图自己出来了（跟"红验"是同一个量，那格不动、这格得动）', 见真图 >= 0);
  const 看得见 = await q("(function(){var im=document.querySelector('.figimg');return im?im.getClientRects().length:0})()");
  判('★ 而且它**真看得见**（`getClientRects().length`，不是"类名挂上了"）', 看得见 >= 1, String(看得见));

  // ── 三、名字 ──────────────────────────────────────────────────────────
  console.log('\n── 三、那个按钮还叫不叫「再摆弄」 ──');
  const 字 = await q("(function(){var b=document.querySelector('.figagain');return b?String(b.textContent):null})()");
  判('图底下那颗按钮在', typeof 字 === 'string', JSON.stringify(字));
  判('★ 它不叫「再摆弄」了', 字 !== '再摆弄', JSON.stringify(字));
  判('★ 它叫「放大看」', 字 === '放大看', JSON.stringify(字));

  // ── 四、放大看：板是真变大，还是只是换了个类名 ────────────────────────
  console.log('\n── 四、点「放大看」：量宽度，两个数必须不一样 ──');
  const 前 = await q("(function(){var g=document.getElementById('ggb');var r=g.getBoundingClientRect();return {板宽:Math.round(r.width),板高:Math.round(r.height)}})()");
  const 板前 = await q("(function(){try{return SR.board.objects()}catch(e){return 'THROW:'+e.message}})()");
  console.log('  点之前，板上是 → ' + JSON.stringify(板前));
  // ★ 抽屉里（还没点）也量一次居中度 —— 这是"别把原来好的改坏了"那一格。
  const 正前 = await q(量居中);
  console.log('  抽屉里画布摆在宿主里 → ' + JSON.stringify(正前));
  判('★ 抽屉里也是**正的**（改动别把原来好的那条路改坏）',
     !!正前 && Math.abs(正前.左 - 正前.右) <= 6 && 正前.右 >= -2,
     JSON.stringify(正前));
  // 点那颗真的按钮 —— 走老师走的那条路，不直接调 openBigFig
  await q("(function(){var b=document.querySelector('.figagain');if(b)b.click();return 1})()");
  await sleep(1400);
  const 后 = await q(`(function(){
    var g=document.getElementById('ggb'), w=document.querySelector('.boardwrap'), L=document.getElementById('bigfig');
    var r=g.getBoundingClientRect();
    return {
      开: SR.main.bigFigOpen() === true,
      板在窗里: !!(w && document.getElementById('bigfigbody').contains(w)),
      板宽: Math.round(r.width), 板高: Math.round(r.height),
      窗宽: Math.round(L.getBoundingClientRect().width),
      窗看得见: L.getClientRects().length,
      窗visibility: getComputedStyle(L).visibility
    };
  })()`);
  console.log('  抽屉里 ' + 前.板宽 + '×' + 前.板高 + '　→　大窗里 ' + 后.板宽 + '×' + 后.板高 + '（窗宽 ' + 后.窗宽 + '）');

  // ── 四之二、**整条父链**的左右边距 ────────────────────────────────
  // ★ 孔老师 2026-10-04 看完截图说：「为啥放大以后不是居中的，是歪的」。
  //   **肉眼估像素估不准，所以量。** 而且只量 `#ggb` 一个盒子不够 ——
  //   偏的可能是它的**父级**，孩子照样老老实实报满宽（记忆 46 号那一族）。
  //   这一格把 `#bigfig` 往下每一层都量一遍左右留白，偏在哪一层当场现形。
  const 链 = await q(`(function(){
    var out = [];
    function 记(名, el){
      if(!el){ out.push({名:名, 缺:1}); return }
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      var p = el.parentElement, pr = p ? p.getBoundingClientRect() : null;
      var 左 = r.left - (pr ? pr.left : 0);
      var 右 = (pr ? pr.right : window.innerWidth) - r.right;
      out.push({
        名: 名,
        宽: Math.round(r.width),
        左: Math.round(左), 右: Math.round(右),
        差: Math.round(Math.abs(左 - 右)),
        显示: cs.display, 定位: cs.position,
        // ★ 那个"旧数"到底存在哪里：行内样式（谁写的）还是 CSS 规则。
        //   不量这个就只能猜是哪一层没跟上。
        行内: String(el.getAttribute('style') || '').replace(/\s+/g, ' ').slice(0, 90),
        变换: cs.transform && cs.transform !== 'none' ? cs.transform.slice(0, 46) : ''
      });
    }
    记('窗 #bigfig', document.getElementById('bigfig'));
    记('体 #bigfigbody', document.getElementById('bigfigbody'));
    记('板 .boardwrap', document.querySelector('.boardwrap'));
    记('洞 #ggb', document.getElementById('ggb'));
    记('缩放 .applet_scaler', document.querySelector('#ggb .applet_scaler'));
    记('画布 canvas', document.querySelector('#ggb canvas'));
    记('图 .mmwrap', document.querySelector('.mmwrap'));
    return out;
  })()`);
  console.log('  ─ 父链实测（「左/右」＝相对自己父级的留白，差＝两边差多少）─');
  for (const r of (链 || [])) {
    if (!r || r.缺) { console.log('    ' + (r && r.名) + ' → 不存在'); continue }
    console.log('    ' + r.名.padEnd(16) + ' 宽' + String(r.宽).padStart(5) +
      '  左' + String(r.左).padStart(4) + ' 右' + String(r.右).padStart(4) +
      '  差' + String(r.差).padStart(4) + '  ' + r.显示 + '/' + r.定位 +
      (r.行内 ? '  行内[' + r.行内 + ']' : '') + (r.变换 ? '  tf[' + r.变换 + ']' : ''));
  }

  // ── 四之三、歪没歪：量**画布**在 `#ggb` 里的左右留白 ──────────────
  // ★ 这一格是孔老师那句「为啥放大以后不是居中的，是歪的」的正式验收。
  //   修之前实测是 左 331 / 右 -327（画布从 `.applet_scaler` 那个旧盒子起算，
  //   往右戳出宿主 358px 被切掉）—— 这两条当时都是红的，红得对。
  //   为什么量"画布在宿主里的位置"而不是量那两个盒子宽不宽：盒子都"报告满宽"，
  //   唯一露馅的是画布**实际画在哪**（同族：别量声明，量落地）。
  //   ⚠ 这一段原来写进了上面那个 for 的**循环体里**，于是打了七遍 ——
  //     一眼看着像"七次都过"，其实量的是同一个东西七次（同族：整节断言量同一个元素）。
  //   ★ 抽屉那一趟（点之前）也量同一个式子：**改的是 `syncHost`，两条路都走它**，
  //     只验大窗就等于"只验了我想改的那半"（同族：改了共用的那层，另一头却没验）。
  const 正 = await q(量居中);
  console.log('  画布摆在宿主里 → ' + JSON.stringify(正));
  判('★★ 画布在宿主里**居中**（左右留白之差 ≤ 6px）',
     !!正 && Math.abs(正.左 - 正.右) <= 6, 正 ? ('左' + 正.左 + ' / 右' + 正.右) : '量不到画布');
  判('★★ 画布**没戳出宿主**（右边留白不许是负的 —— 负的就是被 `overflow:hidden` 切掉）',
     !!正 && 正.右 >= -2, 正 ? ('右边留白 ' + 正.右 + 'px') : '量不到画布');

  // ── 四之四、大窗里那块板上**真有东西吗** ──────────────────────────
  // ★★ 2026-10-04 加的，起因是我自己拍的那张截图上**板是空的**（连坐标轴都没有）——
  //   而他发给我的那张是好的。两张图差在哪，不能靠猜，所以问板子自己。
  //   ⚠ 这条**问的是板子，不是 DOM**：`inject` 600ms 就注进来一个空壳，
  //     "`#ggb` 里有元素"什么都证明不了；`#清空` 又绕过 `clear()`，
  //     "有个对象"也不等于"老师要的那张图在"。要问就问名字。
  //   让它是**会变绿也会变红**的：围栏头一条就是 `#清空`，所以
  //   "点之前板上剩什么"和"点之后板上该有 A/B/s/m"是两个不同的量。
  const 板后 = await 等到值("(function(){try{var o=SR.board.objects()||[];return (o.indexOf('A')>=0&&o.indexOf('B')>=0&&o.indexOf('m')>=0)?o:false}catch(e){return false}})()", 9, 300);
  console.log('  点「放大看」之后，板上是 → ' + JSON.stringify(板后));
  判('★★ 点完「放大看」，**大窗里的板上真有那段图形**（问板子要名字，A/B/m 都在）',
     Array.isArray(板后), JSON.stringify(板后));
  判('★ 它**不是**点之前那张（`#清空` 那条围栏真跑过）',
     Array.isArray(板后) && JSON.stringify(板后) !== JSON.stringify(板前),
     JSON.stringify(板前) + ' → ' + JSON.stringify(板后));
  判('★ 点一下 → 大窗开着', 后.开 === true);
  判('★★ 那块板**搬进**了大窗（`#bigfigbody` 真的 contain 它 —— 不是开了个空窗）', 后.板在窗里 === true);
  判('★★ 板**真的变大了**（量出来的宽度：大窗里 > 抽屉里 ×1.4）', 后.板宽 > 前.板宽 * 1.4, 前.板宽 + ' → ' + 后.板宽);
  // ★ 这一格原来写的是"高也要变大"，**量错了对象**：抽屉 `.drawer` 本来就是
  //   `inset: 0 0 0 auto` 的满高面板（874px），大窗不可能比它高，那条断言
  //   永远红、而且红得没道理。真正该问的是**这块板能用的地方大了没有** → 量面积。
  //   （同族：判别动作要挑会变的那个量。）
  const 面积前 = 前.板宽 * 前.板高, 面积后 = 后.板宽 * 后.板高;
  判('★★ 板能用的**面积**大了（不是"只换个类名"）', 面积后 > 面积前 * 1.5,
    Math.round(面积前 / 1000) + 'k → ' + Math.round(面积后 / 1000) + 'k px²');
  判('★ 纵向也没吃亏（抽屉是满高的，大窗至少不许比它矮太多）', 后.板高 > 前.板高 * 0.93, 前.板高 + ' → ' + 后.板高);
  判('★ 大窗自己看得见（`getClientRects().length` + visibility）', 后.窗看得见 === 1 && 后.窗visibility === 'visible', JSON.stringify([后.窗看得见, 后.窗visibility]));
  // ★ 图本身也得是**真图**：`src` 非空 + 已经解码出来（`naturalWidth > 0`）。
  //   只量"有个 .figimg"的话，一个 src 空的破图也算数（同族：把"有对象"当成"板上有东西"）。
  const 真图 = await q("(function(){var im=document.querySelector('.figimg');if(!im)return null;return {有src:!!im.src,src头:String(im.src).slice(0,22),naturalWidth:im.naturalWidth,naturalHeight:im.naturalHeight}})()");
  console.log('  那张图 → ' + JSON.stringify(真图 && { src头: 真图.src头, naturalWidth: 真图.naturalWidth, naturalHeight: 真图.naturalHeight }));
  判('★★ 它是一张**真解出来的图**（src 非空 + `naturalWidth > 0`）',
     !!(真图 && 真图.有src && 真图.naturalWidth > 0), JSON.stringify(真图));
  // ---- 拍一张，让人自己看（读数说"看得见"，不等于它长对了）----
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      const 图 = path.join(require('os').tmpdir(), 'bigfig_shot.png');
      require('fs').writeFileSync(图, Buffer.from(shot.result.data, 'base64'));
      console.log('  （大窗开着的样子拍到 → ' + 图 + '）');
    }
  } catch (e) { console.log('  （截图没拍成：' + e.message + '）') }

  // Esc 收（走真实的键盘事件，不直接调 closeBigFig）
  await q("(function(){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1})()");
  await sleep(1400);
  const 收 = await q(`(function(){
    var g=document.getElementById('ggb'), w=document.querySelector('.boardwrap');
    return { 开: SR.main.bigFigOpen() === true,
             板回原位: !!(w && document.querySelector('.boardbox').contains(w)),
             板宽: Math.round(g.getBoundingClientRect().width) };
  })()`);
  console.log('  Esc 之后 → ' + JSON.stringify(收));
  判('★ Esc 收得掉', 收.开 === false);
  判('★★ 板**回了原位**（还在 `.boardbox` 里，没被搬丢）', 收.板回原位 === true);
  判('★ 收回去宽度也回去了（大窗那一趟没把尺寸留在板上）', Math.abs(收.板宽 - 前.板宽) <= 2, 前.板宽 + ' → ' + 收.板宽);

  // × 也收得掉（另一条路，各自量一次）
  await q("(function(){var b=document.querySelector('.figagain');if(b)b.click();return 1})()");
  await sleep(900);
  const 开2 = await q('SR.main.bigFigOpen() === true');
  await q("(function(){var c=document.getElementById('bigfigclose');if(c)c.click();return 1})()");
  await sleep(1200);
  const 关2 = await q('SR.main.bigFigOpen() === true');
  判('★ × 也收得掉（开了→' + 开2 + '，关后→' + 关2 + '）', 开2 === true && 关2 === false);

  // ── 五、耳朵：整趟跑下来，页面里炸过没有 ──────────────────────────────
  console.log('\n── 五、页面里炸过没有（`setTimeout` 里抛的也算）──');
  if (页面异常.length) 页面异常.slice(0, 6).forEach(x => console.log('    ! ' + x));
  判('★ 整趟没有未捕获的异常（有的话上面那些读数得重看，可能量的是个已经死掉的东西）',
    页面异常.length === 0, 页面异常.length + ' 条');

  console.log('\n══ 汇总 ══　过 ' + 过 + ' / 败 ' + 败);
  console.log([
    '（一 与 二 是一对：同一个量（屏幕上的真图张数），一次"不该动"、一次"该动"。',
    '  只有两格都量，才排得掉"它压根不会补图"这个解释。）'
  ].join('\n'));

  // ---- 收摊：把状态还回去（铁律：探针不许把东西留在他的浏览器里）----
  await q('SR.board.clear()');
  await q('(function(){return (SR.main&&SR.main.closeBigFig)?SR.main.closeBigFig():0})()');
  await q('(function(){return (SR.main&&SR.main.closeDrawer)?SR.main.closeDrawer():0})()');
  await q('(function(){var s=' + JSON.stringify(存前) + ';Object.keys(s).forEach(function(k){if(s[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,s[k])});return 1})()');
  ws.close(); await put('/json/close/' + t.id);
  process.exit(败 ? 3 : 0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

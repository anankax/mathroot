// 「画板没认 → 让模型自己改一次」那条回路（js/chat.js 的 试自修 / js/tabs.js 的 relines）。
//
// 为什么单独立一把尺子：
//   · 这条回路**动了老师眼前的板**（同一页重画），画错页、多开页、把图吃掉，
//     这些都不会报错，只会让标签条上悄悄多一张或少一张 —— 同族：探针伪造出一份世上不存在的存档格式。
//   · 它还是个**开关**：`SR.NO_SELF_REPAIR` 置真就整条关掉。所以这把尺子能拿同一道题
//     跑 A/B（开/关），而不是"改了之后看起来好像好了"。
//
// 两段：
//   甲、机械那一半（**确定性**）：relines 真的"同页重画"吗？failed() 真的是自修的输入吗？
//       自带红验 —— 用 drawHere 做对照，证明"页数不变"这条判据**会变**，不是恒绿。
//   乙、端到端那一半（**随机**）：同一道题（② 转出五份铺一圈，实测这条最难）
//       开/关各跑 N 轮，比板上最后到底出没出图。
//       ⚠ 乙那半的读数**不能单独信**：同一个模型同提示词不可复现（见
//         [[llm-judgment-not-reproducible]]）。它只用来判断"有没有效果量级上的差别"。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const 轮数 = parseInt(process.argv[2] || '3', 10);
const 问句 = '画一个三角形，把它绕顶点 A 转出另外五份，六份同时铺成一圈图案';

const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200));
    return R && R.result ? R.result.value : null
  };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 40; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});
  // ★ 首屏那道闸（js/landing.js）：这一场还没开口时，`submit` 会先被 intercept()
  //   拦去"归一件"，`route()` 认不出来就**扣着不发**（held）。探针直接调 submit，
  //   绕不过那道闸，于是"发出去了"其实是"被扣住了"，等半天等出个空读数。
  //   先 pick 一次把 picked 置真 —— 这是**老师点按钮**那条路，产品自己就这么走的。
  await q("SR.landing && SR.landing.pick && SR.landing.pick('draw', true)");
  await sleep(500);

  // 量板上"到底出了什么"：跟着 probe_rotate 那把尺子的口径 —— 光数件数会放过"六份全叠一处"。
  const 取状态 = () => q(`(function(){
    var a = ggbApplet.getAllObjectNames(), 面 = 0, 点 = {}, 列 = 0;
    for (var i = 0; i < a.length; i++) {
      var ty = ggbApplet.getObjectType(a[i]);
      if (/polygon|triangle|quadrilateral/.test(ty)) 面++;
      if (ty === 'list') 列++;
      if (ty === 'point') { try { 点[ggbApplet.getXcoord(a[i]).toFixed(2) + ',' + ggbApplet.getYcoord(a[i]).toFixed(2)] = 1 } catch (e) {} }
    }
    return { 件: a.length, 面: 面, 列: 列, 异点: Object.keys(点).length, 没认: (SR.board.failed() || []).length,
             页数: (SR.tabs ? SR.tabs.count() : -1), 标题: (SR.tabs ? SR.tabs.titles() : []) }
  })()`);
  // 铺成一圈的长相：`序列` 出的那张算 list；一行一份的算 6 件多边形 + 散开
  const 摊开了 = s => (s.列 >= 1) || (s.面 >= 5 && s.异点 >= 8);
  const 画 = async (行) => {
    await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(200);
    await q('window.__行=' + JSON.stringify(行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let z = 0; z < 30; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(300);
    return 取状态();
  };
  const 三 = ['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)', 'α=60°',
    'r1=旋转(q, 1*α, A)', 'r2=旋转(q, 2*α, A)', 'r3=旋转(q, 3*α, A)', 'r4=旋转(q, 4*α, A)', 'r5=旋转(q, 5*α, A)'];

  // ════════ 甲、机械那一半 ════════
  console.log('══ 甲、机械那一半（确定性）══');
  {
    const 有relines = await q('!!(SR.tabs && typeof SR.tabs.relines === "function")');
    console.log('  ' + (有relines ? '✓' : '✗') + '  SR.tabs.relines 在');
    if (!有relines) { console.log('  ✗✗ 没有 relines，端到端那半量不了 → 先修产品'); ws.close(); await put('/json/close/' + t.id); process.exit(3) }

    // ① 先画一张三角形
    await q('SR.tabs.reset()'); await sleep(200);
    const 甲一 = await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)']);
    const 页1 = 甲一.页数, 题1 = JSON.stringify(甲一.标题);

    // ② relines 换成一个正方形 —— **页数必须一样**，形状必须变
    await q('SR.tabs.relines(' + JSON.stringify(['#清空', 'P=(0,0)', 'Q=(2,0)', 'R=(2,2)', 'S=(0,2)', 'sq=多边形(P,Q,R,S)']) + ',"方形")');
    for (let z = 0; z < 30; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(400);
    const 甲二 = await 取状态();
    const 形状变了 = (甲二.异点 !== 甲一.异点);
    console.log('  ' + (甲二.页数 === 页1 ? '✓' : '✗') + '  relines 不另开页：页数 ' + 页1 + ' → ' + 甲二.页数 + '（该一样）');
    console.log('  ' + (形状变了 ? '✓' : '✗') + '  relines 真换了板上的图：异点 ' + 甲一.异点 + ' → ' + 甲二.异点 + '（该不一样）');
    console.log('       标题 ' + 题1 + ' → ' + JSON.stringify(甲二.标题));
    if (甲二.页数 !== 页1) { console.log('  ✗✗ relines 把图开到别页去了 —— 这正是它要防的事'); ws.close(); await put('/json/close/' + t.id); process.exit(3) }
    if (!形状变了) { console.log('  ✗✗ relines 喊了没动板 —— 老师会以为"改好了"而板还是破的'); ws.close(); await put('/json/close/' + t.id); process.exit(3) }

    // ③ 红验：drawHere 走的是另一条路，**页数必须 +1**。
    //    不做这一格的话，"页数不变"这个判据是恒绿的 —— 换了谁实现都过。
    await q('SR.tabs.drawHere(' + JSON.stringify(['#清空', 'X=(0,0)', 'Y=(1,0)', 'Z=(0,1)', 't3=多边形(X,Y,Z)']) + ',"第三张")');
    for (let z = 0; z < 30; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(400);
    const 甲三 = await 取状态();
    console.log('  ' + (甲三.页数 === 页1 + 1 ? '✓' : '✗') + '  红验·drawHere 会另开一页：页数 ' + 甲二.页数 + ' → ' + 甲三.页数 + '（该 +1）'
      + (甲三.页数 === 页1 + 1 ? ' —— 所以上面那条"页数不变"不是恒绿' : ''));
    if (甲三.页数 !== 页1 + 1) { console.log('  ✗✗ 判据分不开这两条路，读数是空的'); ws.close(); await put('/json/close/' + t.id); process.exit(3) }

    // ④ 自修的**输入**是不是真的：坏命令必须进 failed()，好命令必须不进
    const 坏 = await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)', 'α=60°', '旋转(q, α*A, A)']);
    const 好 = await 画(三);
    console.log('  ' + (坏.没认 >= 1 ? '✓' : '✗') + '  坏命令进 failed()：`旋转(q, α*A, A)` → 没认 ' + 坏.没认 + ' 条');
    console.log('       它当时板上：面 ' + 坏.面 + '／异点 ' + 坏.异点 + ' —— 这就是老师看见的那张（一份都没转出来）');
    console.log('  ' + (好.没认 === 0 ? '✓' : '✗') + '  阳性对照·好命令不进 failed()：`1*α…5*α` 那六行 → 没认 ' + 好.没认 + ' 条'
      + '，摊开 ' + (摊开了(好) ? '✓' : '✗') + '（面 ' + 好.面 + '／异点 ' + 好.异点 + '）');
    if (坏.没认 < 1 || 好.没认 !== 0 || !摊开了(好)) {
      console.log('  ✗✗ failed() 这把尺子或"摊开"那判据坏了，乙那半不算数');
      ws.close(); await put('/json/close/' + t.id); process.exit(3)
    }

    // ⑤ `revertHere`：**只换账、不动板**。红验就长在这条判据里——它必须**不同时**改板。
    //    （它跟 relines 是一对：relines 重画、revertHere 不画。两条要能分开，回滚才有意义。）
    await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)']);
    const 五前 = await 取状态();
    const 有rev = await q('!!(SR.tabs && typeof SR.tabs.revertHere === "function")');
    await q('SR.tabs.revertHere(' + JSON.stringify(['#清空', 'X=(0,0)', 'Y=(1,0)', 'Z=(0,1)', 't3=多边形(X,Y,Z)']) + ',"换过的名")');
    await sleep(300);
    const 五后 = await 取状态();
    console.log('  ' + (有rev ? '✓' : '✗') + '  SR.tabs.revertHere 在');
    console.log('  ' + (五后.异点 === 五前.异点 ? '✓' : '✗') + '  revertHere 一根汗毛没动板：异点 '
      + 五前.异点 + ' → ' + 五后.异点 + '（该一样 —— 一动就说明它偷偷重画了）');
    console.log('  ' + (JSON.stringify(五后.标题) !== JSON.stringify(五前.标题) ? '✓' : '✗')
      + '  但它把账换了：标题 ' + JSON.stringify(五前.标题) + ' → ' + JSON.stringify(五后.标题));
    if (!有rev || 五后.异点 !== 五前.异点 || JSON.stringify(五后.标题) === JSON.stringify(五前.标题)) {
      console.log('  ✗✗ revertHere 要么没换账、要么动了板 —— 回滚那条路不算数');
      ws.close(); await put('/json/close/' + t.id); process.exit(3)
    }

    // ⑥ **回滚的关键一步**：存档真能把板还原吗？
    //    这一格不验的话，"改坏了就还回去"整个是一句空话 —— 还回去这一步本身没人量过。
    await q('SR.tabs.reset()'); await sleep(200);
    const 六前 = await 画(['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)']);
    const 存 = await q('(function(){var s=SR.board.snapshot();return s?{data:s.data,n:s.n}:null})()');
    await q('window.__存=' + JSON.stringify(存));
    const 六小 = await 画(['#清空', 'Z=(5,5)']);          // 板上只剩 1 件
    const 六还 = await q('(function(){return new Promise(function(res){SR.board.restore(window.__存,function(r){res(r.ok?1:("没还成："+r.why))})})})()');
    for (let z = 0; z < 40; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(500);
    const 六后 = await 取状态();
    console.log('  ' + (六还 === 1 ? '✓' : '✗') + '  存档拿得到（' + (存 ? 存.n + ' 件' : '拿不到') + '）'
      + '，restore 报成功');
    console.log('  ' + (六后.异点 === 六前.异点 && 六小.异点 < 六前.异点 ? '✓' : '✗')
      + '  存档真把板还原了：异点 ' + 六前.异点 + ' →（画少点）' + 六小.异点 + ' →（还回去）' + 六后.异点
      + '（该回到 ' + 六前.异点 + '）');
    if (六还 !== 1 || 六后.异点 !== 六前.异点) {
      console.log('  ✗✗ 还原这一步本身是坏的 —— 那么"改坏了还回去"根本没兑现');
      ws.close(); await put('/json/close/' + t.id); process.exit(3)
    }

    // ⑦⑧ 端到端那一趟，但**把模型换成桩**——这样能确定性地量到"更坏就回滚"这条判据。
    //    ★ 为什么非要做成桩：真模型跑一轮是一分钟起，而且同一提示词**不可复现**
    //      （见文件顶上那段）。判据坏没坏这种事，不能靠"多跑几轮看着像"。
    //    ★ 桩必须**照真接口的规矩**喂：`onChunk` 得真调 ——
    //      `msg.raw` 是 onChunk 一条条攒出来的（js/chat.js:1856），
    //      不调它 `paint` 解到的是一段空文，`ggbDone` 永远是 0，**画板一条命令都收不到**，
    //      而读数会"很正常"（面 0／没认 0），看着像"这轮没什么可画的"。
    //    ⚠ 桩装完**必须还原**（下面 ⑧ 之后有断言）——不还原的话，乙那半量的是桩，不是真模型。
    const 跑一轮 = async (答1, 答2) => {
      await q('window.__答1=' + JSON.stringify(答1) + ';window.__答2=' + JSON.stringify(答2));
      // ★ 顺带**记下判据真正看到的几个数**：`snapshot()` 每次返回多少件、`restore` 被调过没有。
      //   为什么非要记：甲⑦第一遍跑出来是"板上 7 件（= 原来那份）**而**补的话说'改了一遍'"——
      //   两件事只能有一件是真的，光看最后的板分不出是哪件。
      //   记完这四个数，判据说的是哪一档就**不用猜**了。
      await q('(function(){if(!window.__真snap){window.__真snap=SR.board.snapshot;window.__真restore=SR.board.restore}'
        + 'window.__snap=[];window.__回滚=0;'
        + 'SR.board.snapshot=function(){var s=window.__真snap.apply(SR.board,arguments);'
        + 'var 谁=String((new Error()).stack||"").split("\\n")[2]||"?";'
        + 'window.__snap.push((s?s.n:null)+" @"+谁.replace(/^\\s*at\\s*/,"").replace(/\\(.*/,"").trim());return s};'
        + 'SR.board.restore=function(a,b){window.__回滚++;return window.__真restore.call(SR.board,a,b)};return 1})()');
      await q('(function(){if(!window.__真ask){window.__真ask=SR.api.ask;window.__真ready=SR.api.ready}'
        + 'window.__askN=0;SR.api.ready=function(){return true};'
        + 'SR.api.ask=function(o){window.__askN++;var t=(window.__askN===1?window.__答1:window.__答2);'
        + 'try{if(o&&o.onChunk)o.onChunk(t)}catch(e){}return Promise.resolve({text:t})};return 1})()');
      await q("SR.chat.reset('draw', {wipe:true})");
      for (let z = 0; z < 30; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
      await sleep(300);
      await q('(function(){var a=document.querySelectorAll(".localnote");for(var i=0;i<a.length;i++)a[i].parentNode.removeChild(a[i]);return a.length})()');
      await q('SR.chat.submit("画一个三角形，再把它转出一圈")');
      // 等收工：两趟 ask（原答 + 自修）+ 板子跑完。桩是秒回的，等的是画板。
      for (let z = 0; z < 60; z++) {
        await sleep(400);
        const bz = await q('SR.board.isBusy()'), n = await q('window.__askN');
        if (bz === false && n >= 2) break;
      }
      for (let z = 0; z < 30; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
      await sleep(600);
      const 注 = await q('(function(){var a=document.querySelectorAll(".localnote");var o=[];for(var i=0;i<a.length;i++)o.push(a[i].textContent);return o.join(" ／ ")})()');
      return { 状态: await 取状态(), 注: 注, 问了几趟: await q('window.__askN'),
               看到的件数: await q('window.__snap'), 回滚次数: await q('window.__回滚') };
    };
    // 头那份：**板上 7 件，递过去 10 条**，差 3 条 → "板上的东西比命令少"这条闸稳稳成立。
    //
    // ★ 那 7 件是怎么来的，我一开始是**推错的**（推成 5 件），实测数出来的
    //   （test/_count.cjs）是一行 `q=多边形(A,B,C)` 落成 **4 件**：
    //      q[triangle] + a,b,c[segments]  —— 三条边是它自己长出来的。
    //   所以"A 点、B 点、C 点 + 一条多边形" = 3 + 4 = **7 件**。
    //   ⚠ 这个方向对闸是**有利**的：对象通常比命令**多**，所以 `递 > 板上件数`
    //     只在"真有整块东西没落地"时才成立 —— 闸是**保守**的，不会动不动就重画。
    //   （余量要留够：留 1~2 条的话，产品改一行就会让这格变成随机。）
    const 空 = '甲=转一圈(q, 60°, A)\n乙=转一圈(q, 90°, A)\n丙=转一圈(q, 120°, A)'
      + '\n丁=转一圈(q, 150°, A)\n戊=转一圈(q, 180°, A)\n己=转一圈(q, 210°, A)';
    const 头 = '#清空\nA=(0,0)\nB=(2,0)\nC=(1,1.7)\nq=多边形(A,B,C)\n' + 空;   // 10 条 → 7 件 → 该改
    // 更坏：件数掉到 **0**，**而且那 6 条照样没认** → 丢了东西、一点好处没换到 → 该回滚
    const 更坏 = '#清空\n' + 空;
    // 更好：件数也掉（7 → 3），但**一条都没认不出的**（模型把图重写紧凑了）→ 该认，不回滚。
    //   ★ 这一格专门盯判据的**后半句**：少了件数就回滚 → 圆括号里那个
    //     "而没认的条数没跟着变少"就是白写的。两格一起才分得开这两种"件数变少"。
    const 更好 = '#清空\nA=(0,0)\nB=(2,0)\nC=(1,1.7)';

    const 七 = await 跑一轮('```ggb\n' + 头 + '\n```', '```ggb\n' + 更坏 + '\n```');
    const 七回滚 = /还回来了/.test(七.注 || '');
    console.log('  ' + (七回滚 ? '✓' : '✗') + '  ⑦ 改坏了会回滚：问了两趟（' + 七.问了几趟 + '）'
      + '，板上 **7 件**该回来，实测 ' + 七.状态.件 + ' 件／异点 ' + 七.状态.异点
      + '，补的那句里' + (七回滚 ? '有' : '**没有**') + '「还回来了」');
    console.log('       判据看到的件数（老→新）：' + JSON.stringify(七.看到的件数) + '　restore 被调用 ' + 七.回滚次数 + ' 次');
    if (七.注) console.log('       本机补的那句：' + String(七.注).slice(0, 150));
    if (!七回滚 || 七.状态.件 !== 7 || 七.状态.异点 !== 3) {
      console.log('  ✗✗ 更坏的那一份没被挡下来 —— 老师眼前那张好图就白丢了（这正是首轮 A/B 的病根）');
      ws.close(); await put('/json/close/' + t.id); process.exit(3)
    }

    const 八 = await 跑一轮('```ggb\n' + 头 + '\n```', '```ggb\n' + 更好 + '\n```');
    const 八回滚 = /还回来了/.test(八.注 || '');
    console.log('  ' + (!八回滚 ? '✓' : '✗') + '  红验·件数也变少、但**零没认**时不回滚：板上 '
      + 八.状态.件 + ' 件／异点 ' + 八.状态.异点 + '（该是 3 件 3 点 —— 新版那份）'
      + (八回滚 ? '；它回滚了，说明⑦那条判据退化成"件数一少就回滚"，等于恒真' : ''));
    if (八回滚 || 八.状态.件 !== 3 || 八.状态.异点 !== 3) {
      console.log('  ✗✗ 这条判据分不开"改坏了"和"改得更紧凑了" —— ⑦那格不算数');
      ws.close(); await put('/json/close/' + t.id); process.exit(3)
    }

    // ⚠ 桩必须还原，否则乙那半量的是桩。**并且要断言它真还原了**——
    //    "我还原了"和"还原生效了"是两回事（同族：探针往真浏览器里留下的假状态）。
    //
    // ★★ 2026-10-04 夜修：这里原来**只还了 board 那两个，没还 api 那两个**，而下面那句断言
    //   把四个一起查 —— 于是它**每一趟都是红的**（`SR.api.ask` 明明还是桩，断言要它等于真的），
    //   并且 `exit(3)` 把**乙那半（真模型 A/B）整段挡在门外**：尺子自己坏了，报出来的样子
    //   跟"产品坏了"长得一模一样，还顺带把后面半场锁死。同族：尺子递的选项名还是旧的
    //   `student`、产品早改名 `stripAssign` —— **长期假红**。（甲那半的读数全是真的，别把它一起扔了。）
    await q('(function(){if(window.__真snap){SR.board.snapshot=window.__真snap;SR.board.restore=window.__真restore}'
      + 'if(window.__真ask){SR.api.ask=window.__真ask;SR.api.ready=window.__真ready}return 1})()');
    const 还原了 = await q('SR.api.ask===window.__真ask && SR.api.ready===window.__真ready'
      + ' && SR.board.snapshot===window.__真snap && SR.board.restore===window.__真restore'
      + ' && typeof window.__真ask==="function"');
    console.log('  ' + (还原了 ? '✓' : '✗') + '  桩已拆干净（api.ask / api.ready / board.snapshot / board.restore 都换回真的了）');
    if (!还原了) { console.log('  ✗✗ 桩还留在页面上，乙那半会量到桩 —— 停'); ws.close(); await put('/json/close/' + t.id); process.exit(3) }
    if (await q('!!SR.NO_SELF_REPAIR')) console.log('  ⚠ SR.NO_SELF_REPAIR 还是真 —— 乙那半的"开"臂量不到东西');
    await q('SR.NO_SELF_REPAIR = false');
  }

  // ════════ 乙、端到端（随机）════════
  console.log('\n══ 乙、端到端 A/B（同一道题，自修 开/关 各 ' + 轮数 + ' 轮）══');
  console.log('  问：「' + 问句 + '」');
  let 开好 = 0, 关好 = 0;
  for (let k = 0; k < 轮数; k++) {
    for (const 臂 of [{ 名: '开', 值: false }, { 名: '关', 值: true }]) {
      await q('SR.NO_SELF_REPAIR = ' + 臂.值);
      // `wipe:true` 走的是 ⟳ 那条路 —— 这场对话清空、工位回到 draw。
      // ⚠ 这个浏览器是**临时 profile**（--user-data-dir=chrome-debug-…），
      //   清的是它自己那份 memo，碰不到老师真实的那个。
      await q("SR.chat.reset('draw', {wipe:true})");
      for (let z = 0; z < 30; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
      await sleep(400);
      // 清掉上一轮的本地提示，免得把它的出现当成这一轮的
      await q('(function(){var a=document.querySelectorAll(".localnote");for(var i=0;i<a.length;i++)a[i].parentNode.removeChild(a[i]);return a.length})()');
      await q('SR.chat.submit(' + JSON.stringify(问句) + ')');
      // 等这一轮收工：发送键先是 disabled，答完放开；自修若跑，会再 disabled 一次。
      await sleep(1200);
      let 已放开 = 0, 见过忙 = 0, 秒 = 0;
      while (秒++ < 120) {
        await sleep(500);
        const busyNow = await q('!!(document.getElementById("send") && document.getElementById("send").disabled)');
        if (busyNow) { 见过忙 = 0; continue }
        已放开++;
        // 连续 8 次（4 秒）都放开，且板子不忙 → 当作真的收工了
        const bz = await q('SR.board.isBusy()');
        if (已放开 >= 8 && bz === false) break;
      }
      const 注 = await q('(function(){var a=document.querySelectorAll(".localnote");var o=[];for(var i=0;i<a.length;i++)o.push(a[i].textContent);return o.join(" ／ ")})()');
      const s = await 取状态();
      const ok = 摊开了(s);
      if (臂.名 === '开') { if (ok) 开好++ } else { if (ok) 关好++ }
      console.log('  第' + (k + 1) + '轮·自修' + 臂.名 + '：' + (ok ? '✓ 出图了' : '✗ 没出图')
        + '（面 ' + s.面 + '／列 ' + s.列 + '／异点 ' + s.异点 + '／最后没认 ' + s.没认 + ' 条）');
      if (注) console.log('       本机补的那句：' + 注.slice(0, 160));
    }
  }
  console.log('\n  结果：自修**开** ' + 开好 + '/' + 轮数 + '　自修**关** ' + 关好 + '/' + 轮数
    + '（n=' + 轮数 + '，这个量级的噪声见文件顶上那段，**别拿单轮说事**）');

  ws.close(); await put('/json/close/' + t.id);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

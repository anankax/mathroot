// 全面扫一遍：**初中数学常要的图，这个智能体到底做得出几张**。
//
// 来历就是孔老师那句话：「把初中数学可能做的图，都让智能体做一遍……
//   我希望这个智能体能很万能。还有根据试卷上的几何图做动起来的图。」
// ——"很万能"不是一句感觉，得有一张表。这张表就是它。
//
// 跟 `_ruler*.cjs` 那一族的区别（**别搞混，两把尺子量的不是一个东西**）：
//   `_rulerN` 喂的是**我手写的 DSL**——量的是"画板认不认这几条命令"；
//   这一把喂的是**孔老师会说的那种话**，让模型自己去写 DSL——
//   量的是"整条链子（提示词 → 模型 → 围栏 → 画板）通不通"。
//   板子认而我手写的命令对，不等于模型写得出对的那一份。
//
// 每一格量四件事（都是**看得见摸得着**的，不看它怎么自夸）：
//   板上对象数   —— 0 = 白板
//   没认         —— `SR.board.failed()`：命令行不通 / 跑完板上一件没多
//   空壳         —— 名字建出来了但 `isDefined` 假（算不出结果，画出来是废的）
//   能播放       —— 问的是动图的话，`canPlay()` 必须真（暗键 = 他白找一趟）
//
// ★ 这一把**不判对错，只出表**：图"画得好不好看""符不符合题意"机器判不了，
//   得他眼睛看。机器能判的只有"有没有东西、报没报错、动不动"。
//   所以最后留一行"这几格你得自己看图"。
//
// 用法：node test/probe_breadth.cjs [从第几格] [到第几格]
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 每一格就是**老师会打的一句话**，不是我写的命令。（动图那几格另标 动:1）
// ★ 表本身在 `_breadth_items.cjs`，不写在这儿：`_replay.cjs` 要拿同一张表回放。
const 题 = require('./_breadth_items.cjs');

let 过 = 0, 败 = 0; const 行表 = [];
const 判 = (名, ok, 附) => { console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (附 ? '　' + 附 : '')); ok ? 过++ : 败++ };

(async () => {
  const 从 = Number(process.argv[2] || 1), 到 = Number(process.argv[3] || 题.length);
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 250));
    return R && R.result ? R.result.value : null };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 50; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});
  // 开工前的 localStorage（这一把会真发消息、真写台账）——收工原样写回
  const 存前 = await q("(function(){var o={};['mathroot_memo','mathroot_work','mathroot_backend'].forEach(function(k){o[k]=localStorage.getItem(k)});return o})()");
  await q("SR.landing && SR.landing.pick && SR.landing.pick('draw', true)");
  await sleep(400);

  // 量板上：对象数 / 空壳 / 没认 / 能播 / 能不能播的那个真是滑块
  //
  // ★ 「播的是谁」从**播放键上那句话**读，不从 board.js 里掏：
  //   `playTarget` 是 board.js 的模块级私有变量，没有出口（只有 `canPlay()` 一个布尔）。
  //   而按钮上的字是 chat.js 的 `onPlayState` 照它写的（`▶ 播放 <名字>`，见 js/chat.js:206），
  //   —— 那句话本来就是**给老师看的**，读它比去掏内部变量更接近老师看到的事实。
  //   ⚠ 键亮没亮要量两样：行内 `style.display`（它在 index.html 里就是 `display:none` 起步）
  //     和 `getClientRects().length`（防它哪天改成由样式表来藏——那时清行内样式反而藏起来，
  //     这坑 #thumb 上踩过）。
  const 量 = `(function(){
    var o={对象数:0,空壳:[],没认:[],能播:false,播的是:null,是滑块:null,键亮:null};
    try{ var a=ggbApplet.getAllObjectNames(); o.对象数=a.length;
      for(var i=0;i<a.length;i++){ try{ if(!ggbApplet.isDefined(a[i])) o.空壳.push(a[i]) }catch(e){} }
    }catch(e){ o.对象数='量不了' }
    try{ o.没认=(SR.board.failed()||[]).slice(0,3) }catch(e){}
    try{ o.能播=!!SR.board.canPlay() }catch(e){}
    var bp=document.getElementById('btn-play');
    if(bp){
      o.键亮 = (bp.style.display!=='none') && bp.getClientRects().length>0;
      var 文=(bp.textContent||'').replace(/^[▶⏸]\\s*(播放|停)\\s*/,'').trim();
      o.播的是 = 文 || null;
    }
    try{ var n=o.播的是;
      o.是滑块 = n ? (ggbApplet.getObjectType(n)==='numeric' && String(ggbApplet.getDefinitionString(n))==='') : null
    }catch(e){}
    o.图 = document.querySelectorAll('#msgs img.figimg').length;
    o.占位 = document.querySelectorAll('#msgs .figph').length;
    return o })()`;

  // ★★ ④ 改成**量后果**：不问"它是不是滑块"，问"**按下去图动没动**"。
  //
  //   为什么换（第一版就是量错的）：第一版量的是「播放键指着的是不是真滑块」
  //   （`getObjectType==='numeric' && getDefinitionString===''`）。第 7 格因此报红——
  //   可板子**已经在状态条里说了那句提醒**（js/board.js 的 playWarn：「『#播放 t』
  //   指着的 t 不是滑块…按下去不会动」），产品这一面是好的，红的是尺子。
  //   真正该量的是他抱怨的那件事——「按下去一动不动」。
  //   ★ 更有讲究的一点：board.js 那段注释专门写了「宁可多亮一个键，也不能弄哑一个
  //     真能播的图」——**"路径上的点"这类对象本来就是能播的**。拿"是不是滑块"当判据，
  //     正是产品自己不肯用的那条。
  //   （老账：判别动作要挑会变的那个量，别挑代理量。见 [[scanner-numbers-are-not-what-they-claim]]。）
  const 指纹 = `(function(){var o={};try{var a=ggbApplet.getAllObjectNames();
    for(var i=0;i<a.length;i++){var n=a[i],v='';
      try{var t=ggbApplet.getObjectType(n);
        if(t==='point'||t==='point3d'){v=ggbApplet.getXcoord(n)+','+ggbApplet.getYcoord(n)+','+ggbApplet.getZcoord(n)}
        else{v=String(ggbApplet.getValueString(n))}}catch(e){v='?'}
      o[n]=v}}catch(e){}return o})()`;
  // ★★ ⑤ 「这张图拖得动吗」—— 量**依赖关系**，不量"看着像不像"。
  //
  //   来路：孔老师「为啥不绕着A转啊」。他说的就是：板子是**照片**还是**机器**。
  //   做法借自 GeoChat（github.com/tiwe0/GeoChat，Apache-2.0）的
  //   dynamic-construction-validation 技能 —— 它把"看图"换成了**板上自证的量**。
  //   独立那把尺子在 `test/probe_drag.cjs`，这里是把同一个量法接进总表。
  //
  //   主读数 = **惰性自由点**：挪了谁也不动的自由点。题目给的 A、B 要是惰性的，
  //   说明图上一处都没用到它们 —— 那就是把答案摆在了板上。这正是他抱怨的那件事。
  //   ★ 自由点必须用 `isIndependent()` 认，不能用「定义串为空」——
  //     实测自由点 A=(0,0) 的 getDefinitionString 返回的是**值** "(0, 0)"，永远不空。
  //     第一版照空串认，一个都认不出，读数成了"带动 0 个"，跟"这张图是照片"长得一模一样。
  //     （[[scanner-numbers-are-not-what-they-claim]]）
  await q(`window.__值=function(n){
    try{
      if(ggbApplet.getObjectType(n)==='point') return ggbApplet.getXcoord(n)+','+ggbApplet.getYcoord(n);
      return String(ggbApplet.getValueString(n));
    }catch(e){ return '?ERR' }
  }`);
  await q(`window.__快照=function(名){ var o={}; 名.forEach(function(n){ o[n]=window.__值(n) }); return o }`);
  await q(`window.__自由点=function(名){
    var r=[]; 名.forEach(function(n){
      try{ if(ggbApplet.getObjectType(n)==='point' && ggbApplet.isIndependent(n)===true) r.push(n) }catch(e){}
    }); return r;
  }`);
  await q(`window.__板上有点=function(名){ var k=0; 名.forEach(function(n){ try{ if(ggbApplet.getObjectType(n)==='point') k++ }catch(e){} }); return k }`);

  // ★★ ⑥ 「这一轮它写了几页、有没有替老师说话」—— 2026-10-04 加。
  //
  //   来路：第 18 格（数轴·表示不等式解集）总表读成「对象 0」。回放（`node test/_replay.cjs 18`）
  //   把原话摊开，看见的完全是另一件事：模型一口气写了**四个** ```ggb 围栏，**每个都从 `#清空` 开头**，
  //   中间还自己编了 `老师：「再详细讲一讲，还有别的画法吗？」` 这种**没人问过**的话，然后再自己答。
  //   四页里三页只剩一条数轴 —— 老师一页页翻过去，看到的是三张空图。
  //
  //   ★ 为什么这不能并进 ① 那条判：`#清空` 会让**后一页把前一页擦掉**，
  //     所以"对象 0"有两个长得一模一样的原因 ——「它画不出来」和「它画了又被自己擦掉」。
  //     不把"几页""有没有自导自演"一起读出来，就会照着错的那个原因去修。
  //     （[[scanner-numbers-are-not-what-they-claim]]）
  //
  //   ★ `SR.chat.lastRaw` 实测就是**模型这一轮流出来的字**（js/chat.js:1966 `msg.raw += piece`，
  //     js/chat.js:1888 存下），不含我们的提问 —— 所以正文里出现 `老师：` 一定是它**自己编的**。
  //     判据拿不准时别猜，去看那两行。
  //
  //   ★ 正则用 `String.fromCharCode(96,96,96)` 拼那三个反引号：这段是模板字符串，
  //     字面写反引号会把模板提前截断（[[scanner-numbers-are-not-what-they-claim]] 同族）。
  // ★★ ⑦ 「板上有东西」不能只看**命名对象数** —— 2026-10-04 量出来的。
  //
  //   来路：第 18 格（"画一条数轴，表示 x<3 的解集"）连着两趟报「对象 0」，
  //   可屏幕上明明有一条数轴。`test/_axisink.cjs` 单独量了这件事：
  //     · `#清空` + `数轴` → 命名对象 **0 个**，像素却变了 **3993** 个；
  //     · `#清空` + `数轴` + `A=(1,0)` → 命名对象才 1 个；
  //     · 负对照：`#清空` 跟空板子比，**0 像素**。
  //   原因：数轴是 `setPerspective` 配出来的**坐标轴**，压根不是命名对象，
  //   `getAllObjectNames()` 里本来就没有它。
  //
  //   ★ 所以"对象 0"有两个长得一模一样的意思：① 它什么都没画（真红）
  //     ② 它画了一条数轴，只是那条轴没名字（**假红**）。不分这两种，就会拿着假红去修好代码。
  //     （[[scanner-numbers-are-not-what-they-claim]]）
  //
  //   量法：拿**同一格开工前**那张清空图当基线，比像素。基线每格重取一次，
  //   因为 `数轴`／`#三维` 会把视角换掉 —— 拿整场开头那一次当基线就是"两把尺子比差值"。
  await q(`window.__照=function(){return new Promise(function(res){
    try{ var im=new Image();
      im.onload=function(){ try{ var c=document.createElement('canvas'); c.width=im.width; c.height=im.height;
        var g=c.getContext('2d'); g.drawImage(im,0,0); res(g.getImageData(0,0,c.width,c.height)) }catch(e){res(null)} };
      im.onerror=function(){res(null)};
      im.src='data:image/png;base64,'+SR.board.toPNG();
    }catch(e){res(null)} })}`);
  // ★★ 2026-10-04 夜改。原来这一句开头是
  //     `if(!a||!b||a.data.length!==b.data.length) return {坏:1}`
  //   ——"两张图尺寸不一样"就直接认输。可尺寸不一样**本身就是个读数**：
  //   `数轴`／`#三维` 会把画布的视角换掉，PNG 的宽高跟着变。实测第 7、9 格
  //   （都是"要动图"、都要 `#三维`）报的就是 `墨 -1`，
  //   那不是"板子是空的"，是**这把尺子在最需要它的那两格上失灵了**。
  //   （[[scanner-numbers-are-not-what-they-claim]]：数字没错，错的是它没量到东西还装作量了。）
  //
  //   ★ 改法：尺寸不一致时**比重叠的那块**，另外把"换尺了"如实报出来（`换尺` 字段）。
  //     换过视角的格子，`墨` 只算重叠区域，读数**偏小**——偏小总比 -1 强，
  //     而且 `换尺` 会写在那一行上，谁看都知道这一格的分母变了。
  await q(`window.__比2=function(a,b){
    if(!a||!b) return {坏:1};
    var w=Math.min(a.width,b.width), h=Math.min(a.height,b.height);
    var n=0, da=a.data, db=b.data;
    for(var y=0;y<h;y++){ var ia=y*a.width*4, ib=y*b.width*4;
      for(var x=0;x<w;x++){ var i=ia+x*4, j=ib+x*4;
        if(da[i]!==db[j]||da[i+1]!==db[j+1]||da[i+2]!==db[j+2]) n++ } }
    var o={变了:n};
    if(a.width!==b.width||a.height!==b.height) o.换尺=a.width+'x'+a.height+'>'+b.width+'x'+b.height;
    return o }`);

  await q(`window.__围栏数=function(){
    try{
      var r=String(SR.chat.lastRaw||'');
      var m=r.match(new RegExp(String.fromCharCode(96,96,96)+'[ \\t]*ggb','g'));
      return m?m.length:0;
    }catch(e){ return -1 }
  }`);
  await q(`window.__自称老师=function(){
    try{
      var r=String(SR.chat.lastRaw||'');
      var m=r.match(new RegExp('老师[ \\t]*[：:]','g'));
      return m?m.length:0;
    }catch(e){ return -1 }
  }`);
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
    return {
      对象: 名.length, 板上有点: window.__板上有点(名), 自由点: 自由.length,
      报: 报, 可达: Object.keys(可达),
      惰性自由点: 报.filter(function(b){ return b.带动===0 }).map(function(b){ return b.点 }),
      没复原: 名.filter(function(m){ return 尾[m]!==前[m] })
    };
  }`);

  // 按一下播放，看画板上有没有东西**真的变了**。返回"第几秒变的"，一秒都没变返回 null。
  const 按播放看动不动 = async () => {
    await q('SR.board.stopPlay()'); await sleep(300);
    const 前 = await q(指纹);
    await q('SR.board.togglePlay()');
    let 变的 = null;
    for (let z = 0; z < 16 && !变的; z++) {                 // 16 × 250ms = 4 秒
      await sleep(250);
      const 后 = await q(指纹);
      for (const k in 前) { if (String(前[k]) !== String(后 && 后[k])) { 变的 = ((z + 1) * 0.25).toFixed(2) + 's'; break } }
    }
    await q('SR.board.stopPlay()');
    return 变的;
  };

  // ---- 尺子自检：这把"动不动"的尺子，两种板子上**必须翻面** ----
  //   ★ 不做这一步，下面"动图"那几格全报"没动"时，你分不清是产品不动、
  //     还是尺子根本读不出"动"。（老账：判别动作要挑会变的那个量。）
  console.log('\n◆ 尺子自检（这一格不绿，下面"动图"那几格别信）');
  const 画一下 = async (行) => {
    await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(300);
    await q('window.__行=' + JSON.stringify(行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let z = 0; z < 40; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(400);
  };
  await 画一下(['#清空', 'A=(0,0)', 'B=(2,0)', 'c=圆(A,B)']);
  const 死板 = await 按播放看动不动();
  await 画一下(['#清空', 'A=(0,0)', 'B=(2,0)', 'c=圆(A,B)', 't=Slider(0,2*pi,0.05)', '#隐藏 t', 'r=旋转(c, t, B)', '#播放 t']);
  const 活板 = await 按播放看动不动();
  判('自检 ④ 死板子读得出「没动」、活板子读得出「动了」（会翻面，"动不动"才不是恒真读数）',
    死板 === null && 活板 !== null, JSON.stringify({ 死板, 活板 }));
  await q('SR.board.clear()');   // ★ 清干净再进正式那几格——自检最后留在板上的是能播的那张
  await sleep(300);

  // ---- 尺子自检：这把"拖得动吗"的尺子，也要会翻面 ----
  //   ★ 对着**具体的那个对象**判（挪 A 到底动没动 M），不看"总共带动了几个"。
  //     第一版拿总和当读数，两套板子共用的东西把差别盖掉了，
  //     读数成了"死 2 / 活 4"，看着像分开了其实没量到那一行。
  console.log('◆ 尺子自检（这一格不绿，下面"惰性自由点"那几栏别信）');
  await 画一下(['#清空', 'A=(0,0)', 'B=(4,0)', 'M=(2,0)']);
  const 拖死 = await q('(function(){try{return window.__拖一遍(1.7,1.3)}catch(e){return {炸:String(e&&e.message||e)}}})()');
  await 画一下(['#清空', 'A=(0,0)', 'B=(4,0)', 'M=中点(A,B)']);
  const 拖活 = await q('(function(){try{return window.__拖一遍(1.7,1.3)}catch(e){return {炸:String(e&&e.message||e)}}})()');
  const 带 = (r, 点, 对象) => { const b = ((r || {}).报 || []).find(x => x.点 === 点); return b ? (b.带上.indexOf(对象) >= 0) : null };
  判('自检 ⑤ 死板：挪 A 不动 M（答案摆着的）；活板：挪 A 动了 M（算出来的）',
    带(拖死, 'A', 'M') === false && 带(拖活, 'A', 'M') === true && !拖死.炸 && !拖活.炸,
     JSON.stringify({ 死板动M: 带(拖死, 'A', 'M'), 活板动M: 带(拖活, 'A', 'M'), 死板惰性: (拖死 || {}).惰性自由点, 活板惰性: (拖活 || {}).惰性自由点 }));
  await q('SR.board.clear()');
  await sleep(300);

  // ---- 尺子自检：⑥ 这两栏也要会翻面 ----
  //   ★ 一把只会在真回答上跑的正则，和一把"永远返回 0"的正则，读数长得一模一样。
  //     这里塞一段**手写的**"两个围栏 + 一句自己编的老师话"，它必须读出 2 和 1；
  //     再塞一段干净的，必须读出 0 和 0。★ 用完把 `lastRaw` 原样放回（这是产品状态）。
  console.log('◆ 尺子自检（这一格不绿，下面"自说"那两栏别信）');
  {
    const 存 = await q('(function(){try{return SR.chat.lastRaw==null?"":String(SR.chat.lastRaw)}catch(e){return null}})()');
    await q('(function(){try{SR.chat.lastRaw="```ggb\\n#清空\\n数轴\\n```\\n老师：「嗯」\\n```ggb\\n#清空\\n```";return 1}catch(e){return 0}})()');
    const 栏2 = await q('window.__围栏数()'), 自2 = await q('window.__自称老师()');
    await q('(function(){try{SR.chat.lastRaw="画好了，这是图";return 1}catch(e){return 0}})()');
    const 栏0 = await q('window.__围栏数()'), 自0 = await q('window.__自称老师()');
    await q('(function(){try{SR.chat.lastRaw=' + JSON.stringify(存) + ';return 1}catch(e){return 0}})()');
    判('自检 ⑥ 手写「2 页 + 1 次自称老师」读得出 2/1，干净的读得出 0/0',
      栏2 === 2 && 自2 === 1 && 栏0 === 0 && 自0 === 0,
      JSON.stringify({ 栏2, 自2, 栏0, 自0 }));
  }

  // ---- 尺子自检：⑦ 那把"有墨吗"的尺子，也要会翻面 ----
  //   ★ 空板子必须读 0，只有一条数轴的板子必须读 > 0，
  //     否则"有东西"那一栏要么恒真、要么还是漏掉数轴这一档。
  console.log('◆ 尺子自检（这一格不绿，下面"对象/墨"那两栏别信）');
  {
    await 画一下(['#清空']);
    await q('(async function(){ window.__空0 = await window.__照(); return 1 })()');
    const 空空 = await q('window.__比2(window.__空0, window.__空0)');
    await 画一下(['#清空', '数轴']);
    await q('(async function(){ window.__轴0 = await window.__照(); return 1 })()');
    const 空轴 = await q('window.__比2(window.__空0, window.__轴0)');
    const 轴物 = await q('(function(){try{return ggbApplet.getAllObjectNames().length}catch(e){return -1}})()');
    判('自检 ⑦ 清空读 0 像素、只有一条数轴读 > 0 像素（而且命名对象是 0）',
      (空空.变了 || 0) === 0 && (空轴.变了 || 0) > 0 && 轴物 === 0,
      JSON.stringify({ 清空比清空: 空空.变了, 清空比数轴: 空轴.变了, 数轴的命名对象: 轴物 }));

    // ★ 2026-10-04 夜加这一格。上面两句只验了"尺寸一样"那条路。
    //   改 `__比2` 是因为**尺寸不一样**那条路原来直接返回 `{坏:1}`，
    //   而那正是第 7、9 格（都要 `#三维`）走的那条 —— 尺子失灵 = `墨 -1`。
    //   ★ 所以这里必须**当场把那条路走一遍**：造两张尺寸不同的假图，
    //     它得报出"变了 n"并且带上 `换尺`。不绿就说明我改的这个分支没生效，
    //     那第 7、9 格的 `墨` 还是不能信。
    const 换尺试 = await q('(function(){ var a=new ImageData(4,4), b=new ImageData(4,2); a.data[0]=255; return window.__比2(a,b) })()');
    const 同图试 = await q('(function(){ var a=new ImageData(4,4), b=new ImageData(4,4); a.data[0]=255; b.data[0]=255; return window.__比2(a,b) })()');
    判('自检 ⑦b 尺寸不同的两张假图读得出「变了」且带 `换尺`；尺寸相同的一张都不变',
      (换尺试.变了 || 0) > 0 && !!换尺试.换尺 && (同图试.变了 || 0) === 0 && !同图试.换尺,
      JSON.stringify({ 换尺试, 同图试 }));
    await q('SR.board.clear()'); await sleep(300);
  }

  for (let i = 从 - 1; i < 到 && i < 题.length; i++) {
    const c = 题[i];
    console.log('\n── ' + (i + 1) + '／' + 题.length + '　' + c.标 + (c.动 ? '（要动图）' : '') + ' ──');
    console.log('  问：' + c.问);
    await q("SR.chat.reset('draw', {wipe:true})");
    await sleep(400);
    // ★ ⑦ 每格开工前重取一次"清空"基线：`数轴`／`#三维` 会换视角，
    //   拿整场开头那一次当基线，比出来的差值说明不了这一格。
    await q('(async function(){ window.__空 = await window.__照(); return 1 })()');
    await q('SR.chat.submit(' + JSON.stringify(c.问) + ')');
    // 等它答完：发送键放开 + 板不忙 + 正文连着两次不再变长（够用，且不依赖内部变量）
    let 上长 = -1, 静 = 0;
    for (let z = 0; z < 240; z++) {
      await sleep(600);
      const 忙 = await q('!!(SR.board.isBusy&&SR.board.isBusy())');
      const 在发 = await q('!!(document.getElementById("send")&&document.getElementById("send").disabled)');
      const 长 = await q('(function(){var b=document.querySelectorAll("#msgs .bubble");return b.length?b[b.length-1].textContent.length:0})()');
      if (!忙 && !在发 && 长 > 0 && 长 === 上长) { if (++静 >= 3) break } else 静 = 0;
      上长 = 长;
    }
    await sleep(1500);                       // 冻图是收流之后才做的，得给它几步
    const m = await q(量);
    // ⑦ 取墨：放在 ④⑤ 之前 —— 那两步会开关播放、挪自由点，量到的是被它们动过的板子。
    await q('(async function(){ window.__P = await window.__照(); return 1 })()');
    const 墨 = await q('window.__比2(window.__空, window.__P)');
    const 墨数 = (墨 && !墨.坏) ? (墨.变了 || 0) : -1;
    // ★ ④ 放在 push 之前量：要"按下去动不动"这件事跟着整行一起进表。
    const 动 = c.动 ? await 按播放看动不动() : null;
    // ★ ⑤ 最后量，因为这套量法会**挪自由点再放回**。放在冻图之后，动不了那张冻图。
    const 拖 = await q('(function(){try{return window.__拖一遍(1.7, 1.3)}catch(e){return {炸:String(e&&e.message||e)}}})()');
    // ⑦ 「有东西」= 有命名对象 **或** 有墨（见上面那段注释：光一条数轴是 0 个命名对象但有墨）
    const 有物 = (m.对象数 > 0) || (墨数 > 0);
    const 净 = 有物 && m.没认.length === 0 && m.空壳.length === 0;
    const 动好 = !c.动 || 动 !== null;
    // 惰性自由点：题给的点要是挪了谁也不动，那就是把答案摆在了板上。
    // 自由点 0 个 = 图上没有可拖的东西（全由已知量算出）→ **不可判**，不算红。
    const 惰 = 拖.炸 ? null : 拖.惰性自由点.length;
    const 拖好 = 拖.炸 ? false : (拖.自由点 === 0 || 惰 === 0);
    // ⑥ 这一轮写了几页、有没有替老师说话（判据见上面 `__围栏数` 那段注释）
    const 栏 = await q('window.__围栏数()');
    const 自称 = await q('window.__自称老师()');
    行表.push({ n: i + 1, 标: c.标, 动: !!c.动, 对象: m.对象数, 没认: m.没认.length, 空壳: m.空壳.length,
      能播: m.能播, 键亮: m.键亮, 是滑块: m.是滑块, 动的: 动, 图: m.图, 占位: m.占位, 净: 净, 动好: 动好,
      栏: 栏, 自称: 自称, 墨: 墨数, 换尺: 墨 && 墨.换尺 || null,
      自由点: 拖.炸 ? null : 拖.自由点, 惰性: 惰, 可达: 拖.炸 ? null : 拖.可达.length,
      惰性是谁: 拖.炸 ? null : 拖.惰性自由点, 拖好: 拖好, 拖炸: 拖.炸 || null, 拖脏: 拖.炸 ? null : 拖.没复原.length });
    判('① 板上有东西（**有命名对象 或 有墨**）', 有物,
      '对象 ' + m.对象数 + ' / 墨 ' + 墨数 + ' / 冻图 ' + m.图 + ' / 占位 ' + m.占位 + ' / 围栏 ' + 栏
      + (m.对象数 === 0 && 墨数 > 0 ? '　★ 只有轴、没有命名对象 —— 旧判据在这儿是**假红**' : '')
      + (墨 && 墨.换尺 ? '　⚠ 这一格换过视角（' + 墨.换尺 + '），墨只算了重叠那块，读到的是**下限**' : '')
      + (栏 > 1 && !有物 ? '　★ 它写了 ' + 栏 + ' 页、页页 `#清空` —— 后一页把前一页擦了，"全是空的"不等于"画不出来"' : ''));
    判('② 一条没认的都没有', m.没认.length === 0, m.没认.length ? JSON.stringify(m.没认) : '');
    判('③ 没有空壳（建了名字却算不出结果）', m.空壳.length === 0, m.空壳.length ? JSON.stringify(m.空壳.slice(0, 4)) : '');
    判('⑥ 没替老师说话（正文里的 `老师：` 都是它自己编的）', 自称 === 0,
      '自称老师 ' + 自称 + ' 次' + (自称 > 0 ? '　★ 老师会在气泡里看见自己"问"了一句他从没问过的话' : ''));
    if (c.动) 判('④ 要的是动图：**按一下播放键，图真的动了**', 动 !== null,
      '第 ' + (动 || '—') + ' 变 / 能播 ' + m.能播 + ' / 键亮 ' + m.键亮
      + ' / 指着 ' + JSON.stringify(m.播的是) + ' / 是滑块 ' + m.是滑块);
    if (拖.炸) 判('⑤ 拖动测试：**量不出来**', false, 拖.炸);
    else 判('⑤ 题给的点不许是摆设（挪一下，图要跟着变）', 拖好,
      '自由点 ' + 拖.自由点 + ' / 惰性 ' + 拖.惰性自由点.length + (拖.惰性自由点.length ? ' → ' + JSON.stringify(拖.惰性自由点) : '')
      + ' / 可达 ' + 拖.可达.length + (拖.自由点 === 0 ? '　（无自由点，不可判，不算红）' : '')
      + (拖.没复原.length ? '　★ 尺子弄脏了板子：' + JSON.stringify(拖.没复原) : ''));
  }

  console.log('\n══ 汇总 ══');
  console.log(' 序号  干净  动图  拖动  自说  对象   墨  没认  空壳  自由点/惰性  可达  按了播放之后  题目');
  for (const r of 行表) {
    const 动col = r.动 ? ('第 ' + (r.动的 || '—') + (r.动的 ? ' 动了' : ' 没动')) : '－';
    const 拖col = r.拖炸 ? ' ✗ ' : (r.自由点 === 0 ? ' － ' : (r.拖好 ? ' ✓ ' : ' ✗ '));
    console.log('  ' + String(r.n).padStart(3) + '  ' + (r.净 ? ' ✓ ' : ' ✗ ') + '  '
      + (r.动 ? (r.动好 ? ' ✓ ' : ' ✗ ') : ' － ') + '  ' + 拖col + '  '
      + (r.自称 > 0 ? ('✗' + r.自称).padStart(4) : ('·' + r.栏).padStart(4)) + '  '
      + String(r.对象).padStart(3) + '  '
      + String(r.墨).padStart(5) + '  '
      + String(r.没认).padStart(3) + '  ' + String(r.空壳).padStart(3) + '  '
      + ((r.自由点 === null ? '—' : r.自由点) + '/' + (r.惰性 === null ? '—' : r.惰性)).padStart(10) + '  '
      + String(r.可达 === null ? '—' : r.可达).padStart(4) + '  '
      + 动col.padEnd(12) + '  ' + r.标);
  }
  const 净数 = 行表.filter(r => r.净).length, 动表 = 行表.filter(r => r.动), 动好数 = 动表.filter(r => r.动好).length;
  const 可判 = 行表.filter(r => r.自由点 !== null && r.自由点 > 0);
  const 拖好数 = 可判.filter(r => r.拖好).length;
  console.log('\n  干净（有东西 + 无没认 + 无空壳）：' + 净数 + '／' + 行表.length);
  if (动表.length) console.log('  动图真能动            ：' + 动好数 + '／' + 动表.length);
  console.log('  题给的点不是摆设      ：' + 拖好数 + '／' + 可判.length
    + '（还有 ' + 行表.filter(r => r.自由点 === 0).length + ' 格无自由点、不可判）');
  const 多页 = 行表.filter(r => r.栏 > 1), 自说 = 行表.filter(r => r.自称 > 0);
  console.log('  一页讲完（只给一个围栏）：' + 行表.filter(r => r.栏 === 1).length + '／' + 行表.length
    + (多页.length ? '　多页的：' + JSON.stringify(多页.map(r => r.n + '(' + r.栏 + '页)')) : ''));
  console.log('  没替老师说话          ：' + (行表.length - 自说.length) + '／' + 行表.length
    + (自说.length ? '　★ 自问自答的：' + JSON.stringify(自说.map(r => r.n + '(' + r.自称 + '次)')) : ''));
  console.log('  ★ 自说那一栏：`·N` = 这一轮出了 N 个围栏（N>1 就是多页）；`✗N` = 正文里编了 N 次「老师：」。');
  console.log('  ⚠ 这一把只判"有没有东西/报没报错/动不动/拖得动吗"，**图对不对、好不好看得你自己翻一遍**。');

  // ── 落盘：这就是那张**测评集**。下次改提示词，跑同一条命令，比这两个文件。──
  const fs = require('fs');
  const 出 = path.join(__dirname, '_bench_out');
  try { fs.mkdirSync(出, { recursive: true }) } catch (e) {}
  const 快照 = {
    跑的时候: new Date().toISOString(),
    哪几格: 从 + '–' + Math.min(到, 题.length),
    件: 行表
  };
  const 名 = path.join(出, 'bench_' + Date.now() + '.json');
  fs.writeFileSync(名, JSON.stringify(快照, null, 1), 'utf8');
  try { fs.writeFileSync(path.join(出, 'latest.json'), JSON.stringify(快照, null, 1), 'utf8') } catch (e) {}
  console.log('  测评集已落盘：test/_bench_out/' + path.basename(名) + '（同一份也写成 latest.json）');

  await q('(function(){var s=' + JSON.stringify(存前) + ';Object.keys(s).forEach(function(k){if(s[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,s[k])});return 1})()');
  console.log('  （开工前那份 localStorage 已原样写回）');
  ws.close(); await put('/json/close/' + t.id);
  process.exit(0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

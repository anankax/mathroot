// 量「作图模板」的界面那一半（js/drawui.js）。
//
// ★★ 这条探针要证明的最要紧的一件事，不是"面板能打开"，而是
//    **老师点了「照着画」之后，那份算好的骨架真的进了这一轮的 system 提示词**。
//    面板长得再好看，骨架没送到模型手上，这一趟就是白做的。
//    所以第 5 组把 `SR.WORKS.draw.extra` 包了一层**记流水**——它每被调一次就记下
//    返回了什么。这是唯一能证明"进了 system"的地方（`extra` 的返回值就是
//    api.js 的 buildSystem 拼接到 system 末尾的那一段）。
//    ⚠ 包这一层只在本探针所在的页面里有效，不写回文件，也不改产品的一个字节。
//
// ★★ 第 6 组是**反例**：随便打一句普通的话（不点模板），同一层流水必须记到
//    **空**。没有这一条，第 5 组那条绿可能是恒绿的（"extra 永远返回点东西"）。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 值) => { if (真) { 绿++; console.log('  OK  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } else { 红++; console.log('  XX  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } };

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    return R && R.result ? R.result.value : null };
  const 等真 = async (式, 秒, 步) => { const n = Math.round(秒 * 1000 / (步 || 400)); for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 400); await sleep(步 || 400) } return -1 };
  // ★★ 产品自己的"跑完了"信号 —— 别再拿 `turns().length` 涨没涨去猜。
  //   轮数是在**轮末**才涨的（SR.pack.note，chat.js:2233），可"涨了"只说明这一轮
  //   走到过半路；真正的收工判据产品自己写着（test/_round.cjs:50）：
  //     发送键放开 && 画板不忙（SR.board.isBusy 把画板队列、补图、打包都算进去了）
  //   ⚠ 少这一条，第 6 组那句 submit 会撞上 `if (busy) return` 被静默弹回来，
  //     而"没发出去"和"产品不发"长得一模一样 —— 我会把锅算到产品头上。
  const 闲 = '(function(){ var b=document.getElementById("send"); if (b.disabled) return false;' +
             ' if (SR.board && SR.board.isBusy && SR.board.isBusy()) return false; return true })()';
  const 等闲 = 秒 => 等真(闲, 秒 || 150, 400);
  const 跑一轮 = async (触发, 秒, 中途) => {
    await 等闲(40);                                  // 上一轮先收干净，否则这一句根本进不去
    const 前 = await q('(SR.pack.turns()||[]).length');
    await 触发();
    const 开 = await 等真('document.getElementById("send").disabled === true', 8, 150);   // 先看它真开跑
    // ★ 中途是给"刚点下去那一刻"的量留的位置（比如"面板是不是当场收了"）。
    //   放到 `等闲` 后头就变成"这一轮结束时收没收"，那是另一码事，量不出"当场"。
    if (中途) await 中途();
    const 完 = await 等闲(秒 || 150);
    const 后 = await q('(SR.pack.turns()||[]).length');
    return { 前: 前, 后: 后, 开跑: 开 >= 0, 收工: 完 >= 0 };
  };
  const 拍 = async (名) => { const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r && r.result && r.result.data) { fs.mkdirSync(path.join('test', '_shots'), { recursive: true }); fs.writeFileSync(path.join('test', '_shots', 名), Buffer.from(r.result.data, 'base64')); return 名 } return '(没拍到)' };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=drawui&t=' + Date.now() });
  const 起 = await 等真('!!(window.SR && SR.board && SR.board.isReady() === true && !!SR.DRAWUI)', 150, 500);
  console.log('等就绪 ' + 起 + 'ms');
  if (起 < 0) { console.log('★ 没起来，本次不作数'); ws.close(); process.exit(3) }
  await sleep(2000);

  // 走到作图工位。★ 必须走 `SR.main.applyWork` —— 那才是写 `body[data-work]` 的那一句
  //   （js/main.js:58）。`SR.chat.setWork` 只是 `work = w` 一个变量赋值（chat.js:2459），
  //   拿它当开关用，两次读到的都是同一个值，第 1 组会假红成"产品两个工位都露着按钮"。
  await q(`(function(){ SR.main.applyWork('draw'); return 1 })()`);
  await sleep(900);

  console.log('\n════════ 1. 入口那颗 📐：六个工位都露、都算数 ════════');
  // ★★ 2026-10-05：**这一组原来是反过来的**——老版本断言「切到备课工位，📐 必须收起来」。
  //   孔老师问「为什么三角尺只在作图工位，不是全部通用的工具栏呢」之后，那条断言
  //   变成**在替一个已经作废的约定站岗**：产品改对了它反而报红。
  //   ⇒ 探针记的是"当时说好的规矩"，规矩改了就得回来改探针——**这一步不能省**，
  //     不然红的样子跟"产品坏了"长得一模一样，下一次我会照着旧规矩把它改回去。
  {
    const 六 = await q(`SR.WORK_ORDER`);
    const 看 = async w => {
      await q(`(function(){ SR.main.applyWork(${JSON.stringify(w)}); return 1 })()`);
      await sleep(800);
      return await q(`(function(){ var b=document.getElementById('drawtplbtn'), r=document.getElementById('toolrail');
        return { 工位:document.body.getAttribute('data-work'),
                 钮显:b?getComputedStyle(b).display:null, 钮盒:b?b.getClientRects().length:-1,
                 栏显:r?getComputedStyle(r).display:null,
                 左内:getComputedStyle(document.querySelector('main')).paddingLeft } })()`);
    };
    const 结果 = {};
    for (const w of 六) 结果[w] = await 看(w);
    console.log('   ' + JSON.stringify(结果));
    判('1 [先核尺子] 六个工位都走了一遍，`data-work` 真的跟着变了（不是量了同一屏六次）',
       Object.values(结果).map(x => x.工位).join() === 六.join(),
       { 走到的: Object.values(结果).map(x => x.工位), 该走的: 六 });
    判('1 ★ 六个工位里 📐 全都看得见（getClientRects 不为 0，不是量 display）',
        Object.values(结果).every(x => x.钮盒 > 0), Object.values(结果).map(x => [x.工位, x.钮盒]));
    判('1 ★ 六条工位上，整条工具栏都在（栏是页面的家具，不跟着工位忽隐忽现）',
        Object.values(结果).every(x => x.栏显 === 'flex'), Object.values(结果).map(x => [x.工位, x.栏显]));
    判('1 六个工位都给内容栏让了左边的地方（main 左内边距 > 0）',
        Object.values(结果).every(x => parseFloat(x.左内) > 0), Object.values(结果).map(x => x.左内));
  }

  console.log('\n════════ 1b. ★★ 关键：点了「画」之后，**非作图工位**也真的收得到骨架 ════════');
  // ★ 这一组才是这次改动的命门。前半句"六个工位都露"是**看得见的**，
  //   后半句"露出来的那个真能发出去"才是会静默坏掉的那半：
  //   料原来挂在各工位自己的 `extra` 上（组卷挂 slotBrief、作图挂骨架、另外四个压根没这字段），
  //   所以光把按钮放出来，老师在备课工位点「画」会**打开、能填、点了——然后什么也不发**。
  //   界面全对，只有模型那边少一段话。**这种坏法量不出来就永远发现不了。**
  {
    // 给六个工位的 `extra` 各包一层记流水（只在这一张页面上，产品文件一个字不动）
    await q(`(function(){ if (SR.__料流水) return 1;
      SR.__料流水 = {}; SR.__装了 = 0;
      Object.keys(SR.WORKS).forEach(function(w){
        var 原 = SR.WORKS[w].extra;
        SR.WORKS[w].extra = function(){ var r = 原 ? 原.apply(this, arguments) : '';
          (SR.__料流水[w] = SR.__料流水[w] || []).push(String(r || '')); return r };
        SR.__装了++;   // ★ 计数器要跟着【工位】加，不能跟着"这个代码块跑了几次"加：
                       //   这一整块开头有"已经挂过就 return"的早退，跑第二次就跳过了。
                       //   上一版把它加在外面，于是它恒等于 1，而断言要的是 6 —— 又是尺子错。
                       //   ⚠ 这行注释里**不准出现反引号**：这段整块是个模板字符串，
                       //     反引号会当场把它截断（报的是 "missing ) after argument list"）。
      });
      return 1 })()`);
    // ★ 原来这里断言的是 `Object.keys(SR.__料流水).length === 6` —— **尺子错了**：
    //   流水表是空的建好，key 要等某一轮 `extra` 真的被调过才出现，
    //   所以紧接着量它就是 `[]`，产品是对的、尺子报红。
    //   要核的其实是"六个工位的 extra 都**换成了**我包过的那一层"。
    // ⚠ 上一版这儿写成了 `({...})()` —— 一个对象字面量后面跟了调用括号，
    //   浏览器直接抛 "{(intermediate value)...} is not a function"。**又是尺子自己的错。**
    //   要返回一个对象，就老老实实包成函数：`(function(){ return {...} })()`。
    const 挂了 = await q(`(function(){ return { 装了几层: SR.__装了,
      六个都有extra: Object.keys(SR.WORKS).filter(function(k){ return typeof SR.WORKS[k].extra === 'function' }).length,
      收料口: typeof SR.料 } })()`);
    判('1b [先核尺子] 记流水挂上了六个工位', 挂了.装了几层 === 6 && 挂了.六个都有extra === 6, 挂了);
    判('1b [先核尺子] 六个工位**每格都有 `extra` 收料口**（改之前 prep/vary/grade/review 四个压根没这个字段）',
       挂了.六个都有extra === 6, 挂了.六个都有extra);

    // 在**备课**工位（不是作图）走一遍：开面板 → 点「照着画」→ 真跑一轮
    await q(`(function(){ SR.main.applyWork('prep'); return 1 })()`); await sleep(900);
    await q(`document.getElementById('drawtplbtn').click()`); await sleep(600);
    const 面开着 = await q(`document.getElementById('tplp').hidden === false`);
    判('1b 备课工位上，📐 点得开面板（这一步只是好看，下面才是命门）', 面开着 === true);

    const 轮 = await 跑一轮(() => q(`document.getElementById('tplp-go').click()`), 150);
    判('1b 备课工位上这一轮真的开跑了、也收了工（"没发出去"和"产品不发"要分清）',
       轮.开跑 && 轮.收工, 轮);
    const 流 = await q(`SR.__料流水.prep || []`);
    console.log('   备课工位 extra 收到的 = ' + JSON.stringify(流.map(x => x.length)));
    判('1b ★★ 备课工位的 extra **收到东西了**（不是一串空串）——这就是"点了算不算数"',
       流.some(x => x.length > 0), 流.map(x => x.length));
    判('1b ★★ 收到的那段里有作图骨架（射线、角、以及"顶点在中间"那套规矩）',
       流.some(x => /作图模板/.test(x) && /射线\(/.test(x)), (流.filter(x => x.length > 0)[0] || '').split('\n').slice(0, 2));
    判('1b ★ 对照：**作图**工位这一轮没收（因为这一轮走的是备课，骨架只发一次）',
       (await q(`(SR.__料流水.draw || []).length`)) === 0, await q(`(SR.__料流水.draw || []).length`));

    // ★★ 范围检查（2026-10-05 加）：**一件料只发给它本来该给的工位。**
    //   起因：共用口的第一版写的是"六个工位收所有料"，跑出来**组卷那份格式号表
    //   跟着进了备课那一轮**（663 个字）。这份表说的是"这所学校卷子长什么样"，
    //   备课用不上，是纯噪音。这条断言就是钉死"别再漏过去"。
    //   ⚠ 它是**纯函数检查**（不跑网络）：给每个工位问一次 `SR.WORKS[w].extra()`。
    const 范围 = await q(`(function(){
      // ★ 把"取骨架"这一格换成一句认得出来的假话——只在这一张页面上，产品文件没动。
      //   这样量的就是**线路通不通**（哪个工位收得到），跟模板本身对不对无关。
      SR.__骨架备份 = SR.DRAWT.骨架简报;
      SR.DRAWT.骨架简报 = function(){ return '【作图模板】探针用的假骨架' };
      var out = {};
      Object.keys(SR.WORKS).forEach(function(w){ out[w] = String(SR.WORKS[w].extra.call(SR.WORKS[w]) || '') });
      SR.DRAWT.骨架简报 = SR.__骨架备份; delete SR.__骨架备份;
      return out })()`);
    const 带图 = Object.keys(范围).filter(w => /假骨架/.test(范围[w]));
    判('1b ★★ 作图骨架进了**全部六个**工位（这刀要的就是这个）',
       带图.length === 6, 带图);
    const 带表 = Object.keys(范围).filter(w => /格式号|格式/.test(范围[w]));
    判('1b ★★ 组卷那份"格式号表"**只进组卷**，没跟着漏进备课（第一版就漏了，663 个字）',
       带表.length === 0 || (带表.length === 1 && 带表[0] === 'material'), 带表);
    await q(`SR.__料流水 && Object.keys(SR.__料流水).forEach(function(k){ SR.__料流水[k].length = 0 })`);
    await q(`(function(){ SR.main.applyWork('draw'); return 1 })()`); await sleep(900);
  }

  console.log('\n════════ 2. 点开面板：左栏把模板全摆出来了 ════════');
  {
    await q(`document.getElementById('drawtplbtn').click()`);
    await sleep(500);
    const 面 = await q(`(function(){ var p=document.getElementById('tplp');
      return { 开着: !p.hidden, 量得到: p.getClientRects().length > 0,
               项: Array.prototype.map.call(document.querySelectorAll('.tplp-i'), function(b){return b.textContent}),
               选中的: (document.querySelector('.tplp-i.on')||{}).textContent,
               格子数: document.querySelectorAll('#tplp-fields .tplp-in').length,
               预报: document.getElementById('tplp-prev').textContent } })()`);
    判('2 面板打开了，而且真的画在屏幕上（不是 hidden 也不是 0 高度）', 面.开着 && 面.量得到, { 开着: 面.开着, 量得到: 面.量得到 });
    判('2 八块模板都摆出来了', 面.项.length === 8, 面.项);
    判('2 一打开就默认选中第一块（别让老师对着一片空白）', !!面.选中的, 面.选中的);
    判('2 角这块把格子铺出来了', 面.格子数 >= 4, 面.格子数);
    判('2 预报框里有话、也有命令原文', /画一个角/.test(面.预报) && /射线\(O,A\)/.test(面.预报), 面.预报.split('\n').slice(0, 3));
    console.log('   截图 ' + await 拍('_模板面板.png'));
  }

  console.log('\n════════ 3. 改一个格子 → 预报跟着变（不是照着死值念）════════');
  {
    // 度数从 60 改成 90
    const 改 = await q(`(function(){ var sels=document.querySelectorAll('#tplp-fields select');
      for (var i=0;i<sels.length;i++){ var s=sels[i];
        if (Array.prototype.some.call(s.options, function(o){return o.value==='90'})) {
          s.value='90'; s.dispatchEvent(new Event('change', {bubbles:true})); return '改了' } }
      return '没找到度数那一格' })()`);
    判('3 找到了度数那一格并改成 90', 改 === '改了', 改);
    await sleep(300);
    const 报 = await q(`document.getElementById('tplp-prev').textContent`);
    判('3 预报里的角度跟着变成 90°', /90°/.test(报), 报.split('\n')[0]);
    判('3 预报里 B 的坐标真的换到 90° 那一格 (0,3)', /B=\(0,3\)/.test(报), (报.match(/B=\([^)]*\)/) || [])[0]);
    // ★ 再改一个：顶点从 O 改成 P —— 四个字母全得跟着换，不能只换一处
    const 改2 = await q(`(function(){ var ins=document.querySelectorAll('#tplp-fields input');
      if (!ins.length) return '没有文字格';
      ins[0].value='P'; ins[0].dispatchEvent(new Event('input', {bubbles:true})); return '改了' })()`);
    判('3 把顶点改成 P', 改2 === '改了', 改2);
    await sleep(300);
    const 报2 = await q(`document.getElementById('tplp-prev').textContent`);
    判('3 顶点换成 P 之后，四条命令里的 O 全变成了 P（不是只换一处）',
      /射线\(P,A\)/.test(报2) && /射线\(P,B\)/.test(报2) && /角\(A,P,B\)/.test(报2) && !/射线\(O,/.test(报2),
      (报2.match(/射线\([^)]*\)/g) || []).concat((报2.match(/角\([^)]*\)/g) || [])));
    // 改回 O，免得后面那一轮画出来是 P
    await q(`(function(){ var ins=document.querySelectorAll('#tplp-fields input');
      ins[0].value='O'; ins[0].dispatchEvent(new Event('input', {bubbles:true}));
      var sels=document.querySelectorAll('#tplp-fields select');
      for (var i=0;i<sels.length;i++){ var s=sels[i]; if (Array.prototype.some.call(s.options,function(o){return o.value==='60'})){ s.value='60'; s.dispatchEvent(new Event('change',{bubbles:true})) } }
      return 1 })()`);
    await sleep(300);
  }

  console.log('\n════════ 4. 面板「预报」和 SR.DRAWT.拼 是同一份（老师看见的 = 要发出去的）════════');
  {
    const 比 = await q(`(function(){
      var 报 = document.getElementById('tplp-prev').textContent;
      var 值 = {}; // 屏幕上那几个格子的当前值，从 DOM 里重新收一遍——**不读内存**，
                   // 万一 drawui 忘了把改动写回内存，这一条就得红
      var tpl = SR.DRAWT.找('角');
      var ins = document.querySelectorAll('#tplp-fields input');
      var sels = document.querySelectorAll('#tplp-fields select');
      var ii=0, si=0;
      (tpl.字段||[]).forEach(function(x){ if (x.类型==='选') { 值[x.键] = sels[si].value; si++ } else { 值[x.键] = ins[ii].value; ii++ } });
      var r = SR.DRAWT.拼('角', 值);
      return { 报: 报, 算的: r.话 + '\\n\\n' + r.骨架.join('\\n'), 值: 值 } })()`);
    判('4 屏幕上报的那段字，跟照着屏幕上的值算出来的一模一样', 比.报 === 比.算的,
      { 报: 比.报.split('\n')[0], 算: 比.算的.split('\n')[0], 值: 比.值 });
  }

  console.log('\n════════ 5. 点「照着画」：骨架真的进了这一轮的 system ════════');
  {
    // 在 extra 上挂一层流水。★ 只挂在这一张页面上，产品文件一个字没动。
    await q(`(function(){ if (SR.__extra流水) return 1;
      SR.__extra流水 = [];
      var 原 = SR.WORKS.draw.extra;
      SR.WORKS.draw.extra = function(){ var r = 原.apply(this, arguments); SR.__extra流水.push(String(r||'')); return r };
      return 1 })()`);
    const 开 = await q(`(function(){ return document.getElementById('tplp').hidden !== true })()`);
    判('5 [先核尺子] 点之前面板是开着的（不然下面那条"收起来了"是恒真的）', 开 === true);
    let 关 = null;
    const 轮 = await 跑一轮(() => q(`document.getElementById('tplp-go').click()`), 150,
      async () => { 关 = await q(`document.getElementById('tplp').hidden === true`) });
    判('5 这一轮真的开跑了、也收了工（不是"没发出去"）', 轮.开跑 && 轮.收工, 轮);
    判('5 轮数涨了', 轮.后 > 轮.前, { 前: 轮.前, 后: 轮.后 });
    判('5 点了「照着画」之后，刚开跑那会儿面板就已经收起来了（不挡着看画）', 关 === true);
    const 流水 = await q('SR.__extra流水');
    判('5 extra 被调过，而且**至少有一次**返回了骨架（不是空串）',
      流水.length > 0 && 流水.some(x => x.indexOf('作图模板') >= 0), 流水.map(x => x.length));
    const 那一份 = 流水.filter(x => x.indexOf('作图模板') >= 0)[0] || '';
    判('5 送出去的那一段里有老师那句话', /画一个角 ∠AOB/.test(那一份), (那一份.split('\n').filter(l => /画一个角/.test(l))[0] || ''));
    判('5 送出去的那一段里有算好的骨架原文（射线、角都在）',
      /射线\(O,A\)/.test(那一份) && /角\(A,O,B\)/.test(那一份), (那一份.split('\n').filter(l => /角\(A,O,B\)/.test(l))[0] || ''));
    判('5 送出去的那一段里明确说了「顶点在中间」这套规矩',
      /一个字都不要改/.test(那一份) && /加行/.test(那一份), '规矩三条');
    // 对话里那条消息是**人话**，不是九行命令。
    // ★ 从 DOM 上捞他看见的那个气泡，不读 `turns()` ——
    //   turns() 的一条是助手回复（{visible, ggb}），压根没有"老师说了什么"这一格。
    const 末 = await q(`(function(){ var u=document.querySelectorAll('.msg.user .bubble');
      return u.length ? String(u[u.length-1].innerText||'') : '' })()`);
    判('5 对话气泡里是那句人话（不是九行 GeoGebra）', /画一个角/.test(末) && !/射线\(/.test(末), 末.replace(/\n/g, ' ⏎ ').slice(0, 70));
    console.log('   截图 ' + await 拍('_模板画完.png'));
  }

  console.log('\n════════ 6. [反例] 随手打一句普通的话：extra 必须返回空 ════════');
  {
    // ★ 没有这一条，第 5 组那条绿可能是恒绿的（"extra 总会返回点东西"）。
    await q(`SR.__extra流水.length = 0`);
    const 轮 = await 跑一轮(() => q(`SR.chat.submit('把刚才那个角的两条边延长一点')`));
    判('6 [反例] 这一轮真的跑了（开跑 + 收工都看见了）', 轮.开跑 && 轮.收工 && 轮.后 > 轮.前, 轮);
    const 流水 = await q('SR.__extra流水');
    判('6 [反例] extra 被调了，但**一次都没返回骨架**（骨架已经用完作废了）',
      流水.length > 0 && 流水.every(x => x.indexOf('作图模板') < 0), 流水.map(x => x.length));
  }

  console.log('\n════════ 7. [回归] 压在最下面 —— 别人家的「模板库」有没有被我碰坏 ════════');
  {
    // ★★ 2026-10-05 我把新按钮的 id 写成 `tplbtn`，跟底下工具条那颗「模板库」
    //    （`<button class="tool tplbtn" id="tplbtn">`）**撞了名**。后果是三重的，
    //    而且第一副面孔完全不像 bug：
    //      ① `$('tplbtn')`（main.js:615）拿到文档里靠前的那颗 = 我的 📐，
    //         于是「模板库」的点击挂到了 📐 上 —— 点 📐 弹出"传一份你学校给的模板"；
    //      ② 真正的「模板库」按钮**成了死的**（没人给它挂监听）；
    //      ③ css 那条 `#tplbtn{display:none}` 也套到它身上 ——
    //         它在除作图外的每个工位**消失**，而且消失得干干净净、不留一句报错。
    //    这几条钉的就是"只查我自己那颗 📐 查不出来的事"。
    const 库 = await q(`(function(){ var bs=document.querySelectorAll('#tplbtn');
      var b=null; for (var i=0;i<bs.length;i++) if (bs[i].classList && bs[i].classList.contains('tool')) b=bs[i];
      return { 同名的有几颗: bs.length, 找得到: !!b, 工位: document.body.getAttribute('data-work'),
               看得见: b ? b.getClientRects().length > 0 : false, 显示: b?getComputedStyle(b).display:null } })()`);
    判('7 [回归] `#tplbtn` 全站只有一颗了（跟「模板库」不再同名）', 库.同名的有几颗 === 1, 库);
    // ★ 那颗按钮住在 `.outbox` 里，而 `.outbox` **本来就**只在组卷工位显示
    //   （css `body:not([data-work="material"]) .outbox{display:none}`，见 index.html:619）。
    //   所以量它必须站在**它自己那一格**上 —— 在作图/备课量"它怎么不在了"，
    //   是拿一把量错地方的尺子去报产品的红（我第一次就是这么写的，两条假红）。
    判('7 [先核尺子] 作图工位上它本来就该收着（它不是作图工位的东西）', 库.看得见 === false, 库.看得见);
    await q(`(function(){ SR.main.applyWork('material'); return 1 })()`); await sleep(900);
    const 材 = await q(`(function(){ var bs=document.querySelectorAll('#tplbtn');
      var b=null; for (var i=0;i<bs.length;i++) if (bs[i].classList && bs[i].classList.contains('tool')) b=bs[i];
      return { 看得见: b ? b.getClientRects().length > 0 : false, 工位: document.body.getAttribute('data-work'),
               显示: b?getComputedStyle(b).display:null } })()`);
    判('7 [回归] **组卷工位**上「模板库」按钮照旧看得见（这才是我过去会藏掉它的那一格）',
      材.工位 === 'material' && 材.看得见, 材);
    // 两颗按钮各开各的框 —— 光看"按钮在不在"不够，得看**点下去开的是哪个框**。
    // ★ 就在组卷这一格上点它（它自己那一格），跟老师真会做的一模一样。
    await q(`(function(){ if (SR.DRAWUI) SR.DRAWUI.关(); return 1 })()`); await sleep(300);
    await q(`(function(){ var bs=document.querySelectorAll('#tplbtn');
      for (var i=0;i<bs.length;i++) if (bs[i].classList && bs[i].classList.contains('tool')) { bs[i].click(); return 1 } return 0 })()`);
    await sleep(700);
    const 库开 = await q(`(function(){ return { 校模板框: document.getElementById('tpl').getClientRects().length > 0,
      作图面板: document.getElementById('tplp').getClientRects().length > 0 } })()`);
    判('7 [回归] 点「模板库」开的是传 .docx 的校模板框，**不是**作图面板',
      库开.校模板框 === true && 库开.作图面板 === false, 库开);
    await q(`(function(){ var b=document.querySelector('[data-close="tpl"]'); if (b) b.click(); return 1 })()`);
    await sleep(700);

    await q(`(function(){ SR.main.applyWork('draw'); return 1 })()`); await sleep(900);
    await q(`document.getElementById('drawtplbtn').click()`); await sleep(600);
    const 图开 = await q(`(function(){ return { 校模板框: document.getElementById('tpl').getClientRects().length > 0,
      作图面板: document.getElementById('tplp').getClientRects().length > 0 } })()`);
    判('7 [回归] 反过来：点 📐 开的是作图面板，**不是**传 .docx 的框',
      图开.作图面板 === true && 图开.校模板框 === false, 图开);
    console.log('   截图 ' + await 拍('_回归_两个框各归各.png'));
  }

  console.log('\n──────── 绿 ' + 绿 + ' / 红 ' + 红 + ' ────────');
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });

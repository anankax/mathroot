// 尺子：命题工位给一道**纯式子题**（解方程），它出几个围栏？几个是重复的？
//
// 背景（2026-10-03 看 test/_shot/sw-vary.png 发现的）：
//   老师问「把这道题改一改：解方程 2x+3=7」，模型出了三个变式，
//   每个后面跟一个 ```ggb 围栏——**三条命令一字不差**：
//        #清空 / 数轴 / A=(2,0) / 文本("x=2", A+(0,-0.6))
//   屏幕上就是**同一条数轴画了三遍**，而且第三道变式的答案是 x=(c-b)/a，
//   图上还标着 x=2。
//
// ★ 要命的是：js/prompt-vary.js:54 早就写着
//     「纯式子题不要硬配图（解方程、化简求值、代数式求值这一类）。
//       硬配的结果是三张长得一模一样的空数轴」
//   ——提示词**预言的正是这个病**，而病照发。所以这一把量的不是"提示词里有没有这句话"，
//     是"模型守不守"。
//
// ★ 一次不算数。这是颗小模型（glm-4v-flash，见 js/config.js 的 chain:'board'），
//   同一句话跑两遍能给你两种结果（[[llm-judgment-not-reproducible]]）。
//   所以**同一句跑 N 遍**，报的是"几遍里有几遍"。
//
// ★ 每一遍都从**白纸**开始（SR.memo.clear() + 硬重载），
//   不让上一遍的输出变成这一遍的上下文——那样量到的就不是提示词的效力，
//   是模型在学自己上一轮（那正是 test/probe_varydrift.cjs 那条线要分的事）。
//
// 用法：node test/probe_varyfence.cjs [遍数=3] [问题] [文件名前缀=vf] [对照开关]
//
// ══════ 2026-10-03 实测记账（同一把尺子，白纸开局）══════
//
//  改动：js/prompt-vary.js 末尾那段示范，从「**一种**形状」（三个数轴样例 + 一句"没图可配就别画"）
//        改成「**两种**形状」——【第一种·题里有图】…【第二种·题里没图】…，两段各自带标签。
//
//  纯式子题（解方程 2x+3=7）：
//    改动前           0/6  一个围栏都不出
//    现版            17/25 (68%)
//    对照（§第5个参数，标签换回老说法）11/25 (44%)        Fisher p = 0.15  ← **不显著**
//
//  守骨架（有「答案：」、不堆 ### 小标题、不重述原题）：
//    现版 25/25 vs 对照 12/25                              Fisher p = 2.9e-5 ← **显著**
//
//  该配图的题（在数轴上表示 -2 和 3）：现版 10/10 都出围栏、0/10 重复 —— **没拿这头换那头**。
//
//  ★ 结论只敢下到这里：
//     · "两种形状"这两行标签**确实**治住了格式漂移（### / 重述原题），这条 p=2.9e-5，站稳了。
//     · 至于"纯式子题不配图"这件事，方向是对的（68% vs 44%），但 **n=25 还判不了**
//       ——n=10 时是 8/10 vs 4/10，加到 25 就缩到 17/25 vs 11/25，典型的均值回归。
//       想判它得再堆样本，或者换个杠杆（例：把示范里 3 个配图例 : 2 个不配图例 的比例改掉）。
//  ★ 一条教训（[[llm-judgment-not-reproducible]] 那一族）：**n=3 在这台尺子上什么都说明不了**。
//    我先拿 3 遍的"0/3 → 2/3"当成补丁生效，对照臂跑出来**一样是 2/3**。差一点就报了个假绿。
//    这类读数要么 n≥25，要么别用它下结论。
//  ★ 第 5 个参数给的对照，是**在页面内存里**把标签换回老说法（`window.SR.PROMPT_VARY` 是
//    `promptOf → w.prompt()` 每次发送现读的字符串），**绝不改 js/ 文件**；
//    换完先断言"真换掉了"（长度变了、三个标签都没了），换不掉就判尺子坏、不判产品。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:8138/index.html';
const 遍数 = Number(process.argv[2] || 3);
const 问 = process.argv[3] || '把这道题改一改：解方程 2x+3=7';
// ★ 存档前缀。同一把尺子要能在**两种题**上各量一遍：
//   纯式子题（这里，期盼 0 个围栏）和真该配图的题（期盼 ≥1 个）。
//   只量半边会把"一条都不画"当成胜利——那是把尺子量歪，不是把产品改好。
const 前缀 = process.argv[4] || 'vf';
// ★ 第 5 个参数：对照开关。给了值就把**「两种形状」这两行标签**在**页面内存里**
//   换回改之前的老说法再发问——用来回答"读数变好，到底是不是这两行标签干的"。
//   ★ 只动 window.SR.PROMPT_VARY 这个字符串，**绝不改 js/ 文件**。
//     （prompt 是 promptOf → w.prompt() → window.SR.PROMPT_VARY，每次发送时现读，
//       所以内存里换掉就生效。）
//   ★ 换完必须**断言它真换掉了**，否则量的是没换过的原文，判"尺子坏"，不判产品。
const 对照 = process.argv[5] || '';

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面里炸了：' + String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 400));
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const 结果 = [];
  for (let n = 1; n <= 遍数; n++) {
    // 洗成白纸：只清**这一场的对话**（产品自己的口子），绝不 localStorage.clear()
    await send('Page.navigate', { url: PAGE + '?vf' + n + '=' + Date.now() });
    for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
    await ev('(function(){try{SR.memo.clear();}catch(e){}return 1})()');
    await send('Page.navigate', { url: PAGE + '?vf' + n + 'b=' + Date.now() });
    for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
    await sleep(1200);

    const 切 = await ev('(function(){var b=document.querySelector(".workbtn[data-work=\\"vary\\"]");if(!b)return false;b.click();return true;})()');
    if (!切) { console.log('★ 找不到命题工位的按钮，停。'); break; }
    await sleep(600);

    if (对照) {
      // ★ 三段分开换，**一句里不带任何转义**——上一版把两行之间的空行写成 "\\n\\n"，
      //   而数组元素之间其实只有**一个** \n（文件里那些空行是源码排版，不是 "" 元素），
      //   于是第一条 replace 根本没匹配上。闸门当场抓住（长度变了、但标签还在），没让它蒙混过去。
      const 换 = await ev('(function(){var s=window.SR.PROMPT_VARY||"";var 前=s.length;'
        + 's=s.replace("完整的回复是**两种形状**，先判断老师给的这道题属于哪一种，再照着写：","完整的回复长这样，照着这个形状写：");'
        + 's=s.replace("【第一种 · 题里有图】数轴上的点、几何图形、函数图象。每题一段，**每题一个围栏**：","");'
        + 's=s.replace("【第二种 · 题里没图】解方程、化简求值、代数式求值。每题一段，**一个围栏都不写**：","★ 上面三道都是**不给图就说不清**的题。要是老师给的**本来就没图可配**（解方程、化简求值、代数式求值），那**一个围栏都不写**——长这样：");'
        + 'window.SR.PROMPT_VARY=s;'
        + 'return {长度前:前, 长度后:s.length, 两种形状还在吗:s.indexOf("两种形状")>=0, 第一种还在吗:s.indexOf("第一种")>=0, 第二种还在吗:s.indexOf("第二种")>=0};})()');
      console.log('──── 对照：把标签换回老说法 ────');
      console.log('   ' + JSON.stringify(换));
      if (换.两种形状还在吗 || 换.第一种还在吗 || 换.第二种还在吗 || 换.长度前 === 换.长度后) {
        console.log('★ 换没生效 —— 这一遍量的是没换过的原文，尺子坏，不算数。停。');
        break;
      }
    }

    const t0 = Date.now();
    await ev('(function(){var i=document.getElementById("input");i.focus();i.value=' + JSON.stringify(问) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
    await sleep(150);
    await ev('document.getElementById("send").click(); 1');

    // 等它说完：气泡出来 + 发送键不忙 + 两秒不变
    let 稳 = 0, 上 = '';
    for (let s = 0; s < 400; s++) {
      const st = await ev('(function(){var ms=document.querySelectorAll("#msgs .msg.assistant");var m=ms[ms.length-1];'
        + 'var b=document.getElementById("send")||{};'
        + 'return {n:ms.length,发着:!!b.disabled,字:m?(m.innerText||""):""};})()');
      if (st.n > 0 && !st.发着) { if (st.字 && st.字 === 上) 稳++; else 稳 = 0; 上 = st.字; if (稳 >= 4) break; } else 稳 = 0;
      await sleep(500);
    }
    const 用时 = ((Date.now() - t0) / 1000).toFixed(1);

    // 拿模型的**原文**（带围栏的那份），从账本里取
    const 原文 = await ev('(function(){var lg=(SR.memo&&SR.memo.log)?SR.memo.log():[];'
      + 'for(var i=lg.length-1;i>=0;i--){if(lg[i].r==="a")return String(lg[i].t||"");}return "";})()');

    // ★ 解析走**产品自己的那个唯一入口**（SR.render.parseFences），不另写正则。
    //   自己写正则的下场是"量的跟产品用的不是一回事"，那已经在 [[scanner-numbers-are-not-what-they-claim]] 里栽过。
    const 解 = await ev('(function(){try{'
      // 命题工位是 stripAssign:false（只有备课/讲评开），所以这里也传 {}，跟产品一致
      + 'var p=SR.render.parseFences(' + JSON.stringify(原文) + ',{});'
      + '/* ggb 的每一格可能是"字符串"也可能是"若干行"的数组，两种都拼成一行比 */'
      + 'return {围栏数:(p.ggb||[]).length,'
      + '  围栏:(p.ggb||[]).map(function(x){return [].concat(x).join(" ").replace(/\\s+/g," ").trim();}),'
      // ★ **老师真正看见的**那份正文（规则一~四都过完了），不是模型原文。
      //   判"标签有没有漏到老师眼前"必须看这一份——看原文的话，出口处那道闸白加了。
      + '  看得见的正文:String(p.visible||""),'
      + '  看得见的第一行:((String(p.visible||"").split("\\n").filter(function(x){return x.trim();})[0])||"").slice(0,60)'
      + '};}catch(e){return {炸了:String(e&&e.message||e)};}})()');

    const 围栏 = (解.围栏 || []);
    const 去重 = Array.from(new Set(围栏));
    // ★ 2026-10-03 加的这道闸：**回复里有没有把提示词自己的话抄出来**。
    //   为什么非加不可：我先只看 `###`，于是"两种形状"标签让 ### 从 13/25 掉到 0/25，
    //   我记了个 守骨架 25/25 / p=2.9e-5。跑人眼验收才发现，**每一遍的开头就是那句标签原文**：
    //       【第二种 · 题里没图】解方程、化简求值、代数式求值。每题一段，一个围栏都不写：
    //   ——### 没被治好，是**换了个抄法**。老尺子只认 ###，所以量了个"绿"，而东西没变好。
    //   （[[scanner-numbers-are-not-what-they-claim]]：数字没错，错的是它量的那个东西。）
    //   对照臂 25 遍里 0 遍带这些字——它没有这两行标签。这条反向对照说明这道闸认的是真东西。
    const 提示词的话 = ['【第', '题里有图', '题里没图', '每题一个围栏', '一个围栏都不写',
      '照着这个形状写', '完整的回复', '先数一数', '这种长这样'];
    const 抄了 = 提示词的话.filter(p => 原文.indexOf(p) >= 0);
    // ★ 出口那道闸（render.js 规则四）有没有真的把它拦下来：看**看得见的正文**里还剩没剩
    const 漏到眼前 = 提示词的话.filter(p => String(解.看得见的正文 || '').indexOf(p) >= 0);
    const 行 = {
      第几遍: n,
      用时秒: 用时,
      围栏数: 解.围栏数 || 0,
      不同围栏数: 去重.length,
      有没有答案冒号: /(^|\n)\s*答案[：:]/.test(原文),
      有没有井号小标题: /(^|\n)#{1,6}\s/.test(原文),
      有没有原题重述: /(^|\n)#{1,6}\s*原题/.test(原文),
      抄了提示词的话: 抄了,
      漏到眼前的话: 漏到眼前,
      首行: (原文.split('\n').find(x => x.trim()) || '').slice(0, 60),
      看得见的第一行: 解.看得见的第一行 || '',
      是数轴图吗: 围栏.every(x => /数轴|坐标系/.test(x)) && 围栏.length > 0,
      字数: 原文.length
    };
    结果.push(行);
    fs.mkdirSync(path.join(__dirname, '_shot'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '_shot', 前缀 + '-' + n + '.txt'), String(原文));

    console.log('──── 第 ' + n + ' 遍（' + 用时 + 's）────');
    console.log('  围栏 ' + 行.围栏数 + ' 个，去掉重复还剩 ' + 行.不同围栏数 + ' 个'
      + '   答案：=' + 行.有没有答案冒号 + '   ###小标题=' + 行.有没有井号小标题 + '   重述原题=' + 行.有没有原题重述);
    if (抄了.length) console.log('  ★ 模型抄了提示词自己的话（原文）：' + JSON.stringify(抄了));
    console.log('  老师看见的第一行 = 「' + 行.看得见的第一行 + '」'
      + (漏到眼前.length ? '   ★★ 标签漏到眼前了：' + JSON.stringify(漏到眼前) : ''));
    围栏.forEach((x, i) => console.log('    [' + (i + 1) + '] ' + x));
    console.log('');
  }

  // ---- 报事实，不下"好不好" ----
  console.log('══════ 汇总（' + 结果.length + ' 遍）══════');
  console.log('  问的是：' + 问);
  const 有重复 = 结果.filter(r => r.围栏数 > r.不同围栏数).length;
  const 三张一样 = 结果.filter(r => r.围栏数 >= 3 && r.不同围栏数 === 1).length;
  // ★ 守骨架 = 老师扫一眼不硌眼：有「答案：」、不堆 ###、**也不许把提示词自己的话抄出来**。
  //   最后那一条是 2026-10-03 补的——少了它，抄标签会被算成绿。
  const 守骨架 = 结果.filter(r => r.有没有答案冒号 && !r.有没有井号小标题 && !(r.漏到眼前的话 || []).length).length;
  const 抄话 = 结果.filter(r => (r.抄了提示词的话 || []).length).length;
  const 漏眼 = 结果.filter(r => (r.漏到眼前的话 || []).length).length;
  console.log('  出了 ≥3 个围栏、而且**三条一字不差**的：' + 三张一样 + '/' + 结果.length);
  console.log('  围栏里有重复内容的：' + 有重复 + '/' + 结果.length);
  console.log('  一个围栏都没出的（提示词要的就是这个）：' + 结果.filter(r => r.围栏数 === 0).length + '/' + 结果.length);
  console.log('  ★ 模型把提示词自己的话抄进**原文**的：' + 抄话 + '/' + 结果.length);
  console.log('  ★★ **老师眼前**还看得见这些标签的：' + 漏眼 + '/' + 结果.length + '   ← 出口那道闸管的就是这个');
  console.log('  守骨架（有「答案：」+ 不堆 ### + 标签没漏到眼前）：' + 守骨架 + '/' + 结果.length);
  console.log(JSON.stringify(结果, null, 1));
  await closeTab(t.id); ws.close();
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

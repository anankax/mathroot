// 尺子：作图工位底下那三颗按钮，**跟着刚才那张图走吗**？
//
// 病灶是孔老师 2026-10-03 一张截图指出来的：
//   他画了一条数轴、标了三个点，底下摆的还是
//   「画个正方体，让它转起来」「换成三维，再画个球」——
//   跟这张图一点关系都没有。他的原话："这个提示并不智能，并没有跟着对话的思路继续"。
//
// 查下来的实情：网页里"跟着对话走"那条路早就修好了（render.js 认 ```想说 围栏、
// chat.js 优先用模型写的那三句），可**六份提示词里「想说」一次都没出现过**，
// 门从来没开过，于是永远落回 js/chips.js 里写死的那张表。
//   ① 那三条只按**工位 id** 挑（SR.fallbackChips 只看 work），跟画了什么无关；
//   ② 更要命的是它们对**立体**说的（正方体／球／三维），
//      而这一问画的是**平面**——所以跑题是一眼可见的那种。
//
// ★★ 2026-10-04：① ② 都修了。作图那一档按"图上是立体还是平面"分成了
//   `SR.CHIPS.draw`（平面：标字母／加滑动条／画辅助线）和 `SR.CHIPS.draw3d`
//   （立体），判据是 `SR.dimFromTexts`（读助手回复原文，见 js/chips.js）。
//   这一把尺子**留着**，量的是"修完之后跑题还冒不冒头"——
//   尤其是模型偶尔真写了 ```想说 的那几遍（那一档不归兜底表管）。
//   ⚠ 兜底那几遍的跑题率现在是**代码决定的**（0 就是 0），所以 n 小也说明得了问题；
//     但"模型自己写的那三句跑不跑题"仍然要看运气，按下面那条 n≥25 的老规矩来。
//   ⚠ 下面 201 行那句模拟**故意不传 is3D**：这一问画的是数轴，
//     产品那条路算出来也是平面，两边得落到同一档才对得上（见汇总里那条自检）。
//
// 这一把要量的四件事：
//   ① 命中率     —— 几遍里模型真写了 ```想说 围栏
//   ② 抄示范     —— 几遍是照抄提示词那段示范（产品的 filterCopiedChips 会整组作废）
//   ③ 跑题率 ★★ —— **老师最后看见的那三句**里，出现了这一问根本没有的维度
//                   （正方体／球／三维／立体）。这条量的就是他截图上那个毛病。
//   ④ 贴题率     —— 那三句里提到了这张图上**真有的**东西（数轴／点／原点／标／滑动…）
//
// ★ ③ 必须量**老师最后看见的那三句**，不能量模型原文。
//   因为抄示范会被 filterCopiedChips 整组作废，chat.js 就落回那张写死的表——
//   那张表里**全是**正方体、球。也就是说：模型抄一次，跑题一次。
//   只量原文的话，② 和 ③ 会各算各的，"抄了"这件事在 ③ 上完全看不见。
//   （[[scanner-numbers-are-not-what-they-claim]]：量"看得见吗"要量真去看的那一处。）
//
// ★ 两条对照臂（在**页面内存里**改，绝不改 js/ 文件）：
//     off —— 完全不加这份收尾块。这是**改动之前那条路**：基线。它要证明的是
//            "现在量到的想说，是这段提示词带来的，不是模型本来就会写"。
//            基线不是 0 的话，下面所有读数都不干净，脚本会当场说出来。
//     head —— 同一段字，**整个排在 PROMPT_DRAW 前面**。用来回答
//             "读数变好，到底是不是**位置**干的"。api.js 里那段实测就是这么说的：
//             小模型只认最后读到的东西，同一份提示词格式要求放中段 ```想说 只中 0/6～1/6。
//             ★ 为什么不是"塞进提示词末尾、排在附注前面"那种更像现场的对照：
//               「老师手上正在办的那一件事」那段附注**不是每轮都有**（口袋空着就不发），
//               它一不发，"排在它前面"跟"排在最后"就是**同一个字符串**——
//               对照臂会当场退化成现版，量出来的差是 0，而我会以为"位置不重要"。
//               排到最前面则**永远**跟前两臂不同，不管附注在不在。
//
// ★ 一次不算数（[[llm-judgment-not-reproducible]]）。n=3 在这台尺子上什么都说明不了
//   ——同提示词重复跑，档位会大面积翻盘。**要么 n≥25，要么别拿它下结论。**
//
// 用法：node test/probe_say.cjs [遍数=5] [问] [存档前缀=say] [对照臂: ''|off|mid]

const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:8138/index.html';

const 遍数 = Number(process.argv[2] || 5);
// ★ 问一句**平面**的话。跑题词（正方体/球/三维）本来就是给立体准备的，
//   所以只有画平面的这一问，"冒出立体词"才是一门真判据。
const 问 = process.argv[3] || '画个数轴，把 -2、0、3 这三个点在数轴上标出来';
const 前缀 = process.argv[4] || 'say';
const 臂 = process.argv[5] || '';

// ---- 判据词表 ----
// ★ 跑题词：这一问（平面数轴）根本不可能用得上的维度。
//   跟写死那张表**同源**——SR.CHIPS.draw 那三条就在这几个词上翻的车。
const 跑题词 = ['正方体', '球', '三维', '立体', '转起来'];
// ★ 贴题词：这张图上真有的东西。出现一个就算贴题。
//   ⚠⚠ 这一条**不判别**，别拿它当证据：兜底那张死表里「切回平面，画条数轴加个动点」
//      本身就含「数轴」「动点」，所以三条臂它都是 25/25 —— 一个恒定的数，量不出差别。
//      （2026-10-03 实测：off 25/25、head 25/25、现版 25/25。留着只为打印出来好看。）
const 贴题词 = ['数轴', '原点', '点', '-2', '0', '3', '坐标', '标', '滑动', '动点',
  '刻度', '单位', '刻度线', '移', '拖动', '颜色', '虚线', '字母', '范围'];
// ★ 空话词：换哪张图都成立的那种。提示词里（差）那段举的就是这些。
const 空话词 = ['再详细', '讲一讲', '详细一点', '还有别的', '别的画法', '换个例子', '换个题'];
// ★★ 重复词：**图上已经有的东西**再叫老师加一遍。
//   这一问画的是内置 `数轴`，出图就自带箭头和刻度（见 js/prompt-draw.js 里 `数轴` 那条），
//   所以「添个箭头表示正方向」是一句废话。孔老师那轮人眼验收当场看出来的就是这个
//   （截图 test/_shot/seesay.png 上轴右端的箭头明明已经有了）。
//   ⚠ 只收**最没有争议**的三个词。刻度那一族（"增加刻度线"/"标上刻度"）边界糊，
//     不放进机械判据里，靠人眼看档案 —— 别把糊的东西写成判据。
const 重复词 = ['箭头', '正方向', '正无穷'];

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
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const 结果 = [];
  for (let n = 1; n <= 遍数; n++) {
    // 洗成白纸：只清**这一场对话**（产品自己的口子），绝不 localStorage.clear()
    await send('Page.navigate', { url: PAGE + '?sy' + n + '=' + Date.now() });
    for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
    await ev('(function(){try{SR.memo.clear();}catch(e){}return 1})()');
    await send('Page.navigate', { url: PAGE + '?sy' + n + 'b=' + Date.now() });
    for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
    await sleep(1200);

    const 切 = await ev('(function(){var b=document.querySelector(".workbtn[data-work=\\"draw\\"]");if(!b)return false;b.click();return true;})()');
    if (!切) { console.log('★ 找不到作图工位的按钮，停。'); break; }
    await sleep(600);

    // ---- 装对照臂。改的是 SR.WORKS.draw 上的两个钩子（buildSystem 每次现读）----
    // ★ 换完**先断言真换掉了**，换不掉就判尺子坏、不判产品。
    if (臂) {
      const 换 = await ev('(function(){var w=SR.WORKS.draw;'
        + 'var 原样={say:w.say,有prompt:typeof w.prompt==="function",'
        + '  尾部在提示词里:!!(SR.PROMPT_SAY_TAIL&&String(SR.PROMPT_DRAW).indexOf(SR.PROMPT_SAY_TAIL)>=0),'
        + '  收尾块开头:"# 最后一步（发出去之前，再往后多想一步）"};'
        + 'if(' + JSON.stringify(臂) + '==="off"){ w.say=false; }'
        + 'else if(' + JSON.stringify(臂) + '==="head"){ w.say=false;'
        + '  w.prompt=function(){return SR.PROMPT_SAY_TAIL+"\\n\\n---\\n\\n"+String(SR.PROMPT_DRAW);}; }'
        + 'var 后={say:w.say,尾部在提示词里:!!(SR.PROMPT_SAY_TAIL&&String(w.prompt()).indexOf(SR.PROMPT_SAY_TAIL)>=0)};'
        + 'return {原样:原样,后:后};})()');
      console.log('──── 对照臂 ' + 臂 + ' ────');
      console.log('   ' + JSON.stringify(换));
      const 真换了吗 = (臂 === 'off')
        ? (换.原样.say === true && 换.后.say === false)
        : (换.原样.say === true && 换.后.say === false && 换.后.尾部在提示词里 === true && 换.原样.尾部在提示词里 === false);
      if (!真换了吗) {
        console.log('★ 换没生效 —— 这一遍量的是没换过的原文，尺子坏，不算数。停。');
        break;
      }
    }

    // ---- 抄一份请求体，为的是断言 system 里那份收尾块**真在/真不在** ----
    await ev('(function(){'
      + 'window.__抄=null;'
      + 'var 原=window.fetch;'
      + 'window.fetch=function(u,o){'
      + '  try{ if(o&&o.body&&typeof o.body==="string"&&o.body.indexOf("messages")>=0) window.__抄=o.body; }catch(e){}'
      + '  return 原.apply(this,arguments);'
      + '};'
      + 'window.__还原=function(){window.fetch=原;};'
      + 'return 1;})()');

    const t0 = Date.now();
    await ev('(function(){var i=document.getElementById("input");i.focus();i.value=' + JSON.stringify(问) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
    await sleep(150);
    await ev('document.getElementById("send").click(); 1');

    let 抄 = null;
    for (let i = 0; i < 60; i++) { 抄 = await ev('window.__抄'); if (抄) break; await sleep(500); }
    await ev('window.__还原(); 1');

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

    // ★ system 里到底有没有那份收尾块 —— 换成/关掉都要在这份**真发出去的东西**上验，
    //   光看内存里那两个钩子是"我改了变量"，不是"发出去的真是改过的"。
    const sys = 抄 ? String(((JSON.parse(抄).messages || []).filter(m => m.role === 'system')[0] || {}).content || '') : '';
    const 块头 = '# 最后一步（发出去之前，再往后多想一步）';
    const 尾块在system里 = sys.indexOf(块头) >= 0;
    // 顺便记一句：那段附注在不在、收尾块跟它谁前谁后。**只作事实记，不参与判定**
    // （附注不发的时候这段就是空的，拿它下判据会得到"位置对不对"的假结论）。
    const 附注位 = sys.indexOf('老师手上正在办的那一件事');
    const 尾块在最后一段 = 尾块在system里 && (附注位 < 0 ? sys.length - sys.indexOf(块头) < 1600 : sys.indexOf(块头) > 附注位);
    // ★ 这一条是整套读数的地基：收尾块没真发出去，下面的"命中率"就是别的什么东西的命中率。
    //   要拿**真发出去的那份 system** 验，不是验我在内存里改没改变量。
    const 该在 = (臂 !== 'off');
    if (该在 !== 尾块在system里) {
      console.log('★★ 收尾块在 system 里的样子跟这一臂该有的样子对不上'
        + '（臂=' + (臂 || '(现版)') + '，该在=' + 该在 + '，实际在=' + 尾块在system里 + '）—— 尺子坏，停。');
      await closeTab(t.id); ws.close(); return;
    }
    if (臂 === 'head' && 尾块在最后一段) {
      console.log('★★ 对照臂 head 说好了排在最前面，可收尾块**还在最后一段**——换没生效，尺子坏，停。');
      await closeTab(t.id); ws.close(); return;
    }

    const 原文 = await ev('(function(){var lg=(SR.memo&&SR.memo.log)?SR.memo.log():[];'
      + 'for(var i=lg.length-1;i>=0;i--){if(lg[i].r==="a")return String(lg[i].t||"");}return "";})()');

    // ★ 解析走**产品自己的那个唯一入口**（SR.render.parseFences），不另写正则。
    // ★ 而且"老师最后看见哪三句"也走**产品自己的那两个函数**：
    //   filterCopiedChips（防抄）→ 空了就 fallbackChips（写死那张表）。
    //   这才是 chat.js 收流那几行真正的路；自己再写一遍等于量了个平行宇宙。
    const 解 = await ev('(function(){try{'
      + 'var raw=' + JSON.stringify(原文) + ';'
      + 'var p=SR.render.parseFences(raw,{});'
      + 'var body=(p.say&&p.say[0])?String(p.say[0]):"";'
      + 'var 行=body.split("\\n").map(function(s){return s.trim();}).filter(function(s){return s;});'
      + 'var 过的=SR.filterCopiedChips(行);'
      + 'var 被抄闸挡了=(行.length>0 && 过的.length===0);'
      + 'var 老师看见的=(过的.length?过的:SR.fallbackChips({work:"draw",first:false,lastUser:"",prevAssistant:""})).map(function(s){return String(s).trim();});'
      + 'return {有想说围栏:(p.say||[]).length>0,'
      + '  模型三句:行, 过闸之后的:过的, 被抄闸挡了:被抄闸挡了,'
      + '  老师看见的:老师看见的,'
      + '  用的是兜底:!(过的.length),'
      + '  气泡里的按钮:(function(){var ms=document.querySelectorAll("#msgs .msg.assistant");var m=ms[ms.length-1];'
      + '    if(!m)return null;var cs=m.querySelectorAll(".chip");'
      + '    return [].slice.call(cs).map(function(x){return String(x.textContent||"").trim().slice(0,30);});})(),'
      + '  原文里有没有围栏标签:raw.indexOf("想说")>=0'
      + '};}catch(e){return {炸了:String(e&&e.message||e)};}})()');

    if (解.炸了) { console.log('★ 解析炸了：' + 解.炸了); break; }

    const 见 = 解.老师看见的 || [];
    const 文 = 解.模型三句 || [];
    const 行 = {
      第几遍: n,
      用时秒: 用时,
      臂: 臂 || '现版',
      尾块在system里: 尾块在system里,
      尾块在最后一段: 尾块在最后一段,
      有想说围栏: 解.有想说围栏,
      模型句数: 文.length,
      被抄闸挡了: 解.被抄闸挡了,
      用的是兜底: 解.用的是兜底,
      模型三句: 文,
      老师看见的: 见,
      按钮: 解.气泡里的按钮,
      // ★★ 就是这一条量他截图上那个毛病
      看见的跑题词: 跑题词.filter(w => 见.some(s => s.indexOf(w) >= 0)),
      原文的跑题词: 跑题词.filter(w => 文.some(s => s.indexOf(w) >= 0)),
      看见的重复词: 重复词.filter(w => 见.some(s => s.indexOf(w) >= 0)),
      原文的重复词: 重复词.filter(w => 文.some(s => s.indexOf(w) >= 0)),
      看见的贴题词: 贴题词.filter(w => 见.some(s => s.indexOf(w) >= 0)),
      看见的空话词: 空话词.filter(w => 见.some(s => s.indexOf(w) >= 0))
    };
    结果.push(行);
    fs.mkdirSync(path.join(__dirname, '_shot'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '_shot', 前缀 + (臂 || 'A') + '-' + n + '.txt'), String(原文));

    console.log('──── 第 ' + n + ' 遍（' + 用时 + 's）────');
    console.log('  system 里有收尾块=' + 尾块在system里 + '（排在附注后面=' + 尾块在最后一段 + '）'
      + '   模型写了 ```想说=' + 解.有想说围栏 + '（' + 文.length + ' 句）'
      + '   被抄闸挡了=' + 解.被抄闸挡了 + '   用了兜底=' + 解.用的是兜底);
    console.log('  模型写的：' + JSON.stringify(文));
    console.log('  老师看见的：' + JSON.stringify(见)
      + (行.看见的跑题词.length ? '   ★★ 跑题了：' + JSON.stringify(行.看见的跑题词) : ''));
    if (行.看见的重复词.length) console.log('    ↑ 但里面提到了图上**已经有的**东西：' + JSON.stringify(行.看见的重复词));
    console.log('');
  }

  // ---- 报事实，不下"好不好" ----
  const N = 结果.length;
  const 取 = f => 结果.filter(f).length;
  console.log('══════ 汇总（' + N + ' 遍，臂=' + (臂 || '现版') + '）══════');
  console.log('  问的是：' + 问);
  console.log('  ① 模型真写了 ```想说 围栏：' + 取(r => r.有想说围栏) + '/' + N);
  console.log('  ② 写了三句（正好 3 句）：' + 取(r => r.模型句数 === 3) + '/' + N);
  console.log('  ③ 被防抄闸整组作废：' + 取(r => r.被抄闸挡了) + '/' + N);
  console.log('  ★★ 老师最后看见的那三句里**跑题**（冒出平面没有的维度）：' + 取(r => r.看见的跑题词.length) + '/' + N
    + '   ← 孔老师截图上就是这个毛病');
  console.log('  老师看见的三句里贴题（提到这张图上真有的东西）：' + 取(r => r.看见的贴题词.length) + '/' + N
    + '   ⚠ 这条**不判别**（兜底那张表里就有"数轴"，三条臂都是 N/N），别当证据用');
  console.log('  老师看见的三句里是空话：' + 取(r => r.看见的空话词.length) + '/' + N);
  console.log('  ★ 老师看见的三句里叫老师加**图上已经有的**东西：' + 取(r => r.看见的重复词.length) + '/' + N
    + '   ← 轴上的箭头／刻度本来就是画上去自带的');
  // ★ 自检：我在页面里**模拟**的那条路（filterCopiedChips → fallbackChips），
  //   必须跟气泡里**真渲染**出来的按钮对得上。对不上就是"我量的是我写的那套，不是产品"，
  //   下面所有读数都得作废（[[scanner-numbers-are-not-what-they-claim]] 那一族）。
  const 对不上 = 结果.filter(r => JSON.stringify(r.按钮) !== JSON.stringify((r.老师看见的 || []).map(s => String(s).slice(0, 30))));
  console.log('  尺子自检·模拟的三句 vs 气泡里真渲染的按钮 对不上的：' + 对不上.length + '/' + N
    + (对不上.length ? '   ★★ 尺子坏，上面的读数一条都别信' : '   ← 0 才算这条模拟可信'));
  console.log('');
  const 基线 = 取(r => !r.用的是兜底);
  if ((臂 === 'off') && 基线 > 0) {
    console.log('  ⚠ 基线不是 0：这一臂**根本没有**那份收尾块，可还是 ' + 基线 + '/' + N + ' 遍冒出了想说。');
    console.log('    说明模型本来就会写这东西 —— 现版那条路量到的命中率里，有一部分不是提示词的功劳。');
  }
  console.log(JSON.stringify(结果, null, 1));
  await closeTab(t.id); ws.close();
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

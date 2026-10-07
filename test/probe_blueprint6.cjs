// ⑥ 蓝图闸门：命题／组卷那两格，这一轮该不该"先摆蓝图、等老师点头"。
//
// 分两半：**一半是接线**（门 + 拼进 system 的位置 + 三条反例），**一半是这个门在真模型身上灵不灵**。
//
// 要证的事，缺一条这场读数就作废：
//   · **该问的那一轮真挂上了**，而且排在**最末**（它抢的就是"最后一段"这个位置）。
//   · ★★ **反例 1：点头那一轮不许再摆一次蓝图** —— 挂的是另一段，第一段一个字都不能出现。
//     少了这条，"挂上了"跟"每轮都挂同一段"分不清。
//   · ★★ **反例 2：作图那一轮两段都不许出现** —— 照孔老师那句话：命题组卷开、作图关。
//   · ★★ **反例 3：产品自己发的修理指令不许挂**（`蓝图: false`，见 js/chat.js 的 `去问`）。
//     这条不红的话，命题那格"画板没认→重写 ```ggb"那一趟会被塞一段"先别出成品"。
//   · 门本身：过就是过，不过就是不过（离散词面，不查分）。
//
// ⚠ 读数从 `SR.api.lastSystem` 拿（产品自己留的账，只在内存、不外发）。
// ⚠ 后半段那几趟真发给模型（免费档，可能 429）。读数在发请求**之前**就写了，429 不影响判。
//   真模型那两趟给的是"N 中几条"，不足不编。
//
// ★★ 这一版里被自己绊过一跤，记下来：第 7 趟量到"点头那轮一个 ```ggb 都没有"，
//   我当场读成"GO 那段把画板指令弄哑了"，差点去改 GO 的正文。加了对照（原样提示词
//   也走同一句话）才发现：**两臂一模一样**（每臂 4 趟实测 3/4 对 3/4，见
//   test/_probe_go_ggb.cjs）。这个免费模型在这件活上有两种回话形态——长的（1500 字）
//   把题干答案铺开写、不吐 ggb；短的（400 字）直接把图交了。跟闸门无关。
//   教训：**"某个东西在不在"这种读数，一次不做对照就敢下因果**，是这场里最贵的错。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222;
// ★ 「硬重载之后等开完机」共用那一份，别在这儿再抄一遍。见 test/_等开机.cjs。
const { 等开机 } = require(path.join(__dirname, '_等开机.cjs'));

let 绿 = 0, 红 = 0, 跳 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
const 过 = (名, 读) => { 跳++; console.log('  ⏭ ' + 名 + '（这一趟拿不到读数，不判）' + (读 !== undefined ? '   ' + 读 : '')); };
// ⓘ 只打印、不进账：用于"这一趟是拿来当对照看的，不是拿来判的"（判了会假红，说明见第 8 趟）
const 记 = (名, 读) => console.log('  ⓘ ' + 名 + (读 !== undefined ? '   ' + 读 : ''));
const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));

(async () => {
  const 列表 = await 取('/json/list');
  const 候选 = 列表.filter(t => t.type === 'page' && /^(https?:\/\/)?(localhost|127\.0\.0\.1):8138/.test(String(t.url)));
  console.log('本地 8138 开着 ' + 候选.length + ' 个标签页，逐个核身份…');
  if (!候选.length) { console.error('★ 没有 8138 的标签页。'); process.exit(2); }

  let 会话 = null, 目标 = null;
  for (const t of 候选) {
    const w = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise(r => w.on('open', r));
    let id = 0; const 等 = {};
    w.on('message', m => { let o; try { o = JSON.parse(m); } catch (e) { return; } if (o.id && 等[o.id]) 等[o.id](o); });
    const 发 = (method, params) => new Promise(r => { const i = ++id; 等[i] = r; w.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async e => {
      const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails;
        throw new Error('页面里这一句炸了：' + ((d.exception && (d.exception.description || d.exception.value)) || d.text) + '\n  表达式：' + String(e).slice(0, 200));
      }
      return r.result && r.result.result && r.result.result.value;
    };
    const 有 = await ev('typeof SR !== "undefined" && !!SR.WORKS');
    if (有 === true) { 会话 = { 发, ev, w }; 目标 = t; break; }
    w.close();
  }
  if (!会话) { console.error('★ 这几个标签页里没有一个真跑着数根。'); process.exit(2); }
  const { 发, ev, w } = 会话;
  console.log('核上了：' + 目标.url);

  await 发('Network.enable');
  await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.enable');
  await 发('Page.reload', { ignoreCache: true });

  // 硬重载之后脚本是一条一条下来的，别按秒表读状态（⑤ 那一趟撞过：指纹报 `SR is not defined`）。
  // ★ 2026-10-06 夜：原来自写的那个循环换成共用那一份（test/_等开机.cjs），
  //   范围也放宽了——从"只看 SR 有没有挂上"扩到"六格提示词都装好了"。
  const 有SR = await 等开机(ev);
  if (!有SR) console.log('★ 20 秒没等到开机 —— 后面的读数要打折看');
  判('0丙 硬重载之后 SR 装起来了（后面每条读数都靠它）', 有SR === true);

  // ── 0. 先证明装的是这一版 ────────────────────────────────────────
  const 指纹 = await ev('JSON.stringify({ 段: typeof (SR.blueprint && SR.blueprint.段), 门: typeof (SR.blueprint && SR.blueprint.是点头), ASK长: (SR.PROMPT_BLUE_ASK||"").length, GO长: (SR.PROMPT_BLUE_GO||"").length, 开关: { vary: !!(SR.WORKS.vary||{}).blueprint, material: !!(SR.WORKS.material||{}).blueprint, draw: !!(SR.WORKS.draw||{}).blueprint, prep: !!(SR.WORKS.prep||{}).blueprint, grade: !!(SR.WORKS.grade||{}).blueprint, review: !!(SR.WORKS.review||{}).blueprint } })');
  console.log('页面指纹：' + 指纹);
  const F = JSON.parse(指纹);
  判('0甲 prompt-blueprint.js 装上了（门 + 两块正文都在）',
    F.段 === 'function' && F.门 === 'function' && F.ASK长 > 200 && F.GO长 > 50,
    'ASK ' + F.ASK长 + ' 字 / GO ' + F.GO长 + ' 字');
  判('0乙 开关正是"命题组卷开、作图关"（其余三格不动）',
    F.开关.vary === true && F.开关.material === true && F.开关.draw === false
    && F.开关.prep === false && F.开关.grade === false && F.开关.review === false,
    JSON.stringify(F.开关));

  // ── 1. 门（离散词面，不查分）───────────────────────────────────
  // ★ 这张表上一版有两条红，都不是"尺子不准"，是**门里真有两个 bug**：
  //   ① 判"前一个字是不是否定"时用了 `'不别没'.indexOf(前)`，而 `''.indexOf('')` === 0
  //      —— 一句话正正好好等于「按这个办」时，前一个字是空串，被当成"前头有个否定"，
  //      于是**最短的那几句点头全落进"给蓝图"**（'按这个办'／'出吧'／'直接出'／'开始出'）。
  //   ② 长度闸原来写的 40 字太松："就这样出"后面拖着四项改动那句话归一化后 36 字，
  //      照样当点头放过去了。改成 20。
  //   ⚠ 这两条留在这儿当**反面记忆**：下面 1甲 那 10 句就是照着它们挑的，一句话只要短到
  //     "跟词长得一样"，就该过。改门之前先看这一格。
  const 话 = [
    '就按这个办', '就按这个办吧', '行，出吧', '可以，出吧', '按这个办', '就按你说的办',
    '就这么办', '开始出', '出吧', '直接出',
    '把这道题的3和5换成别的数，出三道变式', '这道题难不难',
    '不要按这个办，先把第2题的数字改小一点，另外第三题加个图，然后整体难度再提一档，最后把答案也带上',
    '这道题就这样出，第三题再加个图，另外把第一题的数字换成负的，难度提上去，答案也要',
    '不按这个办'
  ];
  const 门 = JSON.parse(await ev('JSON.stringify(' + JSON.stringify(话) + '.map(function(t){ var r = SR.blueprint.段(t); return [t, /先别出成品/.test(r) ? "ASK" : (/老师点头了/.test(r) ? "GO" : "空")]; }))'));
  门.forEach(x => console.log('   ' + (x[1] === 'GO' ? '点头' : x[1] === 'ASK' ? '给蓝图' : '★空') + '  ←  ' + x[0].slice(0, 30)));
  const 表 = {}; 门.forEach(x => 表[x[0]] = x[1]);
  判('1甲 点头的短话 10 句一律走"出成品"那一档（含"就跟词一样长"的那几句）',
    话.slice(0, 10).every(t => 表[t] === 'GO'),
    (话.slice(0, 10).filter(t => 表[t] === 'GO').length) + '/10' + (话.slice(0, 10).filter(t => 表[t] !== 'GO').join('｜') || ''));
  判('1乙 提新活／问一句话 → 走"给蓝图"那一档',
    表['把这道题的3和5换成别的数，出三道变式'] === 'ASK' && 表['这道题难不难'] === 'ASK');
  判('★★ 1丙 长句里夹着"按这个办"（还带改动）→ 仍然给蓝图，不算点头', 表[话[12]] === 'ASK', 表[话[12]]);
  判('★★ 1丁 "就这样出"后面拖着四项改动（归一化 36 字，超过 20 字那道闸）→ 也给蓝图', 表[话[13]] === 'ASK', 表[话[13]]);
  判('★★ 1戊 "不按这个办"（否定就在词前头）→ 不是点头', 表[话[14]] === 'ASK', 表[话[14]]);
  判('1己 一句都不是空串（不许出现"两段都不挂"的静默档）', 门.every(x => x[1] !== '空'));

  // ── 2. 拼进 system 的位置 ────────────────────────────────────
  const 走一趟 = async (wk, 话, 额外) => {
    // 走产品的门：SR.api.ask。历史给空的（这一段要量的是 api 这一层）。
    await ev('(async function(){ try { await SR.api.ask({ work:' + JSON.stringify(wk)
      + ', history:[], parts:[], text:' + JSON.stringify(话) + (额外 || '') + ', onChunk:function(){} }); } catch(e){} return 1; })()');
    const sys = await ev('SR.api.lastSystem || ""');
    return { sys: sys };
  };
  const 记号 = { ASK: '# 这一轮先别出成品', GO: '# 老师点头了' };

  console.log('\n第 1 趟 · 命题 +「出三道变式」（该给蓝图）');
  const 一 = await 走一趟('vary', '把这道题的3和5换成别的数，出三道变式');
  console.log('   system 长度 = ' + 一.sys.length);
  判('2甲 挂上了"先给蓝图"那一段', 一.sys.indexOf(记号.ASK) >= 0);
  判('★★ 2乙 这一趟**没有**"老师点头了"那一段', 一.sys.indexOf(记号.GO) < 0);
  const 位 = JSON.parse(await ev('(function(){ var s = SR.api.lastSystem||""; var a = s.indexOf("# 这一轮先别出成品"); return JSON.stringify({ 起点: a, 尾: a >= 0 ? a + SR.PROMPT_BLUE_ASK.length : -1, 总长: s.length }); })()'));
  判('★★ 2丙 它排在**最末**（"最后一段"就是它的全部本事）', 位.尾 === 位.总长, JSON.stringify(位));

  console.log('\n第 2 趟 · 命题 +「就按这个办」（**反例**：点头那一轮）');
  const 二 = await 走一趟('vary', '就按这个办');
  判('★★ 3甲 换成"出成品"那一段', 二.sys.indexOf(记号.GO) >= 0);
  判('★★ 3乙 "先给蓝图"那一段一个字都不许出现（不然他会再问一遍）', 二.sys.indexOf(记号.ASK) < 0);

  console.log('\n第 3 趟 · 作图 + 同一句（**反例**：作图关着闸）');
  const 三 = await 走一趟('draw', '把这道题的3和5换成别的数，出三道变式');
  判('★★ 4甲 作图这一趟两段都不出现', 三.sys.indexOf(记号.ASK) < 0 && 三.sys.indexOf(记号.GO) < 0);
  // ★ 顺带核一条**回归**：新加的这块不许把作图那格的收尾块挤掉位置。
  //   "末位优势"是量过的（挤掉 想说 围栏 = 4/8 掉回 0/6，见 [[prompt-must-do-at-tail]]）。
  const 位3 = JSON.parse(await ev('(function(){ var s = SR.api.lastSystem||""; var t = SR.PROMPT_SAY_TAIL||""; var a = t ? s.indexOf(t) : -1; return JSON.stringify({ 尾块在: a >= 0, 尾块尾: a >= 0 ? a + t.length : -1, 总长: s.length }); })()'));
  判('★★ 4乙 作图那段的 想说 收尾块仍在，而且**仍是最末**（没被这一版顶掉）',
    位3.尾块在 === true && 位3.尾块尾 === 位3.总长, JSON.stringify(位3));

  console.log('\n第 4 趟 · 组卷 + 一口新活（该给蓝图）');
  const 四 = await 走一趟('material', '出一份八上的周练卷，10道填空、6道选择、4道解答');
  判('5甲 组卷这一格也挂上了', 四.sys.indexOf(记号.ASK) >= 0 && 四.sys.indexOf(记号.GO) < 0);

  console.log('\n第 5 趟 · 命题 + 同一句 + `蓝图:false`（**反例**：产品自己发的修理指令）');
  const 五 = await 走一趟('vary', '把这道题的3和5换成别的数，出三道变式', ', 蓝图:false');
  判('★★ 6甲 传了 `蓝图:false` 就一段都不挂（`去问` 那条路靠它）',
    五.sys.indexOf(记号.ASK) < 0 && 五.sys.indexOf(记号.GO) < 0);

  // ── 3. 真模型身上灵不灵 ──────────────────────────────────────
  // ★ 这一段量的是**它听不听**，不是接线。免费档会 429，拿不到回话就跳过，不判绿也不判红。
  const 收 = r => String((r && r.text) || '');
  const 想说几行 = t => {
    const m = /```想说[ \t]*\r?\n([\s\S]*?)```/.exec(t);
    if (!m) return null;
    return m[1].split('\n').map(s => s.trim()).filter(Boolean);
  };
  const 真走 = async (wk, 话, 历史, 附加) => {
    const r = await ev('(async function(){ try { var o = { work:' + JSON.stringify(wk)
      + ', history:' + JSON.stringify(历史 || []) + ', parts:[], text:' + JSON.stringify(话)
      + ', onChunk:function(){} }; Object.assign(o, ' + JSON.stringify(附加 || {}) + ');'
      + ' var res = await SR.api.ask(o); return JSON.stringify({ text: (res&&res.text)||"", err:(res&&res.error)||"" }); }'
      + ' catch(e){ return JSON.stringify({ text:"", err:"炸:"+String(e&&e.message||e) }); } })()');
    return JSON.parse(r);
  };

  console.log('\n第 6 趟 · 真发给模型：命题 + 提一件新活（量它摆不摆那颗「就按这个办」）');
  let 命中 = 0, 拿到 = 0, 不出成品 = 0, 首答 = '';
  for (let i = 0; i < 3; i++) {
    const r = await 真走('vary', '把这道题的3和5换成别的数，出三道变式');
    const t = 收(r);
    if (!t) { console.log('   第 ' + (i + 1) + ' 次没拿到回话（' + (r.err || '空') + '）'); continue; }
    拿到++;
    if (!首答) 首答 = t;
    const 行s = 想说几行(t);
    const 头 = 行s && 行s.length ? 行s[0] : '（没写围栏）';
    if (头.indexOf('就按这个办') >= 0) 命中++;
    if (!/```ggb/.test(t)) 不出成品++;
    console.log('   第 ' + (i + 1) + ' 次：' + t.length + ' 字  ggb围栏=' + /```ggb/.test(t)
      + '  想说行数=' + (行s ? 行s.length : 0) + '  想说第一行=' + JSON.stringify(头));
    console.log('        开头：' + JSON.stringify(t.slice(0, 120)));
  }
  if (!拿到) 过('7甲 真模型有没有把那颗「就按这个办」摆出来');
  else 判('7甲 听进去了：想说第一行就是「就按这个办」（' + 命中 + '/' + 拿到 + ' 条）', 命中 >= 1);
  if (!拿到) 过('7乙 那一轮有没有真忍住不出成品');
  //  ⚠ 这条只能量"有没有把图交出来"，量不了"有没有出成品"（文字成品在这件活上不带 ggb，
  //    见 8乙 那段注释）。宽松是故意的：免费档在这件活上本来就有两种回话形态。
  else 判('7乙 那一轮没把图交出来（回话里没有 ```ggb 围栏）—— ' + 不出成品 + '/' + 拿到 + ' 条', 不出成品 >= 1);

  console.log('\n第 7 趟 · 真发给模型：命题 +「就按这个办」（量它出不出成品、还问不问）');
  const 历史 = 首答 ? [{ role: 'user', content: '把这道题的3和5换成别的数，出三道变式' }, { role: 'assistant', content: 首答 }] : [];
  const r7 = await 真走('vary', '就按这个办', 历史);
  const t7 = 收(r7);
  if (!t7) 过('8甲 点头那一轮它到底出不出成品', r7.err || '空');
  else {
    const 行7 = 想说几行(t7) || [];
    console.log('   回话 ' + t7.length + ' 字，想说行 = ' + JSON.stringify(行7.slice(0, 3)));
    console.log('   开头：' + JSON.stringify(t7.slice(0, 300)));
    console.log('   含「变式」' + ((t7.match(/变式/g) || []).length) + ' 次  含「答案」'
      + ((t7.match(/答案/g) || []).length) + ' 次');
    判('★★ 8甲 点头之后不再摆一次蓝图（想说里没有那颗「就按这个办」）',
      行7.every(x => x.indexOf('就按这个办') < 0), 行7.join('｜') || '（没写围栏）');
    //  ★ 「出了成品」这条判据改过两次，两次都是**尺子自己的毛病**，写在这儿：
    //    ① 原来写 `/```ggb/`（= 带上了画板指令）——错在拿"这道题要不要配图"当成
    //       "它有没有照蓝图办事"。这一格出的是**文字**（几道题的题干＋答案），配不配图另说。
    //    ② 改成「含「答案」≥2 次」——**更糟**：实测这件活有两种回话形态，
    //       长的（1500 字）把题和答案铺开写、答案一抓一把；短的（400 字）直接把图交了、
    //       答案 0 次。拿"答案"当凭证，短的这版会被判成"没出成品"。
    //    ★★ 真正的教训：**这条活上"在不在"不是闸门能决定的**。见下面第 8 趟的对照，
    //       以及 test/_probe_go_ggb.cjs 那个 4 比 4 的实测（GO 臂 3/4 吐 ggb，原样提示词
    //       也是 3/4）——**一模一样的差错率**，所以画板指令丢不丢跟这个闸门无关。
    //    所以这里只判一件宽松的事：**它没有空手回来**（不是一句"好的我等你确认"）。
    //  ★★ 第三次改（2026-10-06 夜），还是**尺子自己的毛病**，一并记在这儿：
    //    原来这句是 `t7.length >= 200 && 成品样` —— 那个 **200 字**是我怕"空手回来"
    //    随手设的一道闸，**它量的不是"有没有出成品"，是"回话够不够长"**。
    //    今晚它当场把一份**完全正确、完整**的回话判成了"空手"：
    //        「变式一（换数字）／解方程 2x-4=6／答案：x=5」…三道，105 字，三道全带答案。
    //    那正是这道题要的答案，一个字都不缺 —— 只是**写得短**（免费档这件活有
    //    长/短两种回话形态：长的铺开写 ~1500 字，短的直接把题和答案列完）。
    //    而"短"跟"空手"在这把尺子眼里长得一模一样。
    //    同族：[[scanner-numbers-are-not-what-they-claim]]「**写死的件数在"加一件"那天
    //    报成"仪器不对"**：数字本身没错，错的是它量的那个东西」——今晚三把尺子里
    //    那个写死的 19492 是同一件事，那三把改掉了，这一把也改掉。
    //
    //    治法：闸门交给**内容**，长度只留给**最弱的那条内容判据**兜底。
    //    分强弱是有道理的（这是写完自检才想清楚的，自检当场就逮住过我：
    //    我先给所有情形都加了道 30 字地板，结果一条**合法但很短**的画板指令回话
    //    也被判红了 —— 那又是一次"地板量错了东西"）：
    //      · 强判据：```ggb 围栏 / 至少一个「答案」 —— 这两样**本身就是成品**，
    //        出现了就够，**不问长度**（有人就是不爱多写字）。
    //      · 弱判据：三个「？」 —— 只能说明"它在跟你说话"，一句客套话反问三句
    //        也能凑够。这条才需要用长度兜一下，否则"空手"能从这儿钻过去。
    //    ⚠ 谁要再改这一格：改完**两个方向都要跑** —— `node test/_自检_8乙.cjs`
    //      （那份自检把下面这几行判据**抄了一份**，改这儿就要连着改那儿）。
    const 强 = /```ggb/.test(t7) || (t7.match(/答案/g) || []).length >= 1;
    const 弱 = (t7.match(/[？?]/g) || []).length >= 3;
    const 弱地板 = 60;
    判('8乙 点头之后真出了东西（画板指令／答案／成篇题干，至少一样）',
      强 || (弱 && t7.length >= 弱地板),
      t7.length + ' 字  ' + (强 ? '（强判据：画板指令或答案）'
        : (弱 ? '（弱判据：三个问号，地板 ' + 弱地板 + ' 字）' : '（★两样都没有 —— 像是空手回来的）')));
    if (强 && t7.length < 200) console.log('   ⓘ 这一趟是"短形态"：'
      + t7.length + ' 字，强判据过了（长的写 ~1500 字，短的把题和答案列完就收，两种都算数）');
  }

  // ── 8. 对照：同一件事走**原样提示词**（蓝图:false）──
  //  ★ 一次都不做被怀疑动作的对照。这一趟**只记不判**：它要回答的是"两臂有没有差别"，
  //    而那是个**比率**问题，2 趟的样本判不了（差一趟就是 1/2 比 2/2，噪声能冒充成结论）。
  //    真结论在 test/_probe_go_ggb.cjs 里，每臂 4 趟：**GO 3/4，原样 3/4** —— 没差别。
  console.log('\n第 8 趟 · 对照：同一件活走原样提示词（`蓝图:false`）—— 只记不判');
  let 对照吐 = 0, 对照拿 = 0;
  for (let i = 0; i < 2; i++) {
    const rc = await 真走('vary', '把这道题的3和5换成别的数，出三道变式', 历史, { 蓝图: false });
    const tc = 收(rc);
    if (!tc) { console.log('   第 ' + (i + 1) + ' 次没拿到回话（' + (rc.err || '空') + '）'); continue; }
    对照拿++;
    const 有ggb = /```ggb/.test(tc);
    if (有ggb) 对照吐++;
    console.log('   第 ' + (i + 1) + ' 次：' + tc.length + ' 字  ggb围栏=' + 有ggb
      + '  含「变式」' + ((tc.match(/变式/g) || []).length) + ' 次');
  }
  记('对照臂这一趟 ' + 对照吐 + '/' + 对照拿 + ' 吐了画板指令（跟上面第 7 趟比；'
    + '这个模型在这件活上本来就会丢，见 _probe_go_ggb.cjs 的 4 比 4）');

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红 / ' + 跳 + ' 跳');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

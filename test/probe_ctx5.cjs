// ⑤ 上真页面：一段**装不下**的历史喂进去，看真发出去的那份上下文是不是
//   ①头一句是老师的话 ②尾随一段"省掉了哪几轮"的附注 ③附注排在收尾块前面。
//
// 要证的四件事，缺一条这场读数就作废：
//   · **附注真进了 system** —— 光在 Node 里量纯函数不算数，得看见它真发出去。
//   · ★★ **反例：短历史一个字都不许加** —— 不裁的时候也塞一段附注，
//     模型会以为老师前面还问过话。没有这条，"加了附注"跟"每轮都加"分不清。
//   · **附注排在收尾块前面** —— 排到后面就是把 想说/ggb 围栏挤开，那是量过的老伤。
//   · **留下来的历史头一句不是 assistant** —— ⑤ 治的正病。
//
// ⚠ 读的是 `SR.api.lastSystem` / `lastHistRoles`（产品自己留的账，只在内存）。
// ⚠ 这两趟真发给模型（免费档）。429 了不影响读数：账在发请求**之前**就写了。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222;
// ★ 「硬重载之后等开完机」共用那一份，别在这儿再抄一遍。见 test/_等开机.cjs。
const { 等开机 } = require(path.join(__dirname, '_等开机.cjs'));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
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

  // 硬重载之后脚本是**一条一条**下来的，4 秒不一定够（这一趟就撞上了：
  //   指纹那一句报 `SR is not defined`——不是页面坏了，是我问得太早）。
  //   等产品自己把 SR 挂上再问，别按秒表读状态。
  // ★ 2026-10-06 夜：这段原来是本文件里自己写的一个循环，现换成共用那一份
  //   （test/_等开机.cjs）。判据比原来那句严一点：除了 SR 那几个口，
  //   还要求六个工位按钮齐了 —— 那些是**装完之后**才成立的东西。
  const 有SR = await 等开机(ev);
  if (!有SR) console.log('★ 20 秒没等到开机 —— 后面的读数要打折看');
  判('0丙 硬重载之后 SR 装起来了（后面每条读数都靠它）', 有SR === true);

  // ── 0. 先证明装的是这一版 ────────────────────────────────────────
  const 指纹 = await ev('JSON.stringify({ 略注: typeof (SR.api && SR.api.略注), 裁界: typeof (SR.api && SR.api.裁到轮界), 有账: typeof (SR.api && SR.api.lastHistRoles) })');
  console.log('页面指纹：' + 指纹);
  const F = JSON.parse(指纹);
  判('0甲 页面上的 api.js 是带 ⑤ 的这一版（略注/裁到轮界/新账都在）',
    F.略注 === 'function' && F.裁界 === 'function');
  判('0乙 上一轮留下的账本是空的（这一场没跑过，读到的都是本趟的）', F.有账 === 'undefined', F.有账);

  // 组装那两段历史。⚠ 字符串在 Node 这侧造好再塞进页面，别在页面里拼（引号会咬）。
  const 长 = n => '甲'.repeat(n);
  const 大段 = (tag, n) => tag + '：' + 长(n);
  // 装不下那份：3 轮老对话，每轮两侧各 4000 字 ≈ 2604 tokens，六条就一万五，远超 7000
  const 装不下 = [
    { role: 'assistant', content: '开场白：我是数根。' },
    { role: 'user', content: 大段('老师第一句问的是长方体怎么画', 4000) },
    { role: 'assistant', content: 大段('模型第一答说的是已经画好了', 4000) },
    { role: 'user', content: 大段('老师第二句问的是这个角对不对', 4000) },
    { role: 'assistant', content: 大段('模型第二答说的是没问题', 4000) },
    { role: 'user', content: '老师最新这一句：接着往下' },
    { role: 'assistant', content: '模型最新这一答：好' }
  ];
  // 装得下那份（反例）：同样的话，把长的都换成短的
  const 装得下 = [
    { role: 'assistant', content: '开场白：我是数根。' },
    { role: 'user', content: '老师第一句问的是长方体怎么画' },
    { role: 'assistant', content: '模型第一答说的是已经画好了' },
    { role: 'user', content: '老师第二句问的是这个角对不对' },
    { role: 'assistant', content: '模型第二答说的是没问题' },
    { role: 'user', content: '老师最新这一句：接着往下' },
    { role: 'assistant', content: '模型最新这一答：好' }
  ];

  const 走一趟 = async (历史, 话) => {
    // 走产品的门：SR.api.ask。历史直接给，不经 chat.js（这段要量的是 api 这一层）。
    await ev('(async function(){ try { var hist = ' + JSON.stringify(历史) + ';'
      + ' await SR.api.ask({ work:"draw", history:hist, parts:[], text:' + JSON.stringify(话) + ', onChunk:function(){} });'
      + ' } catch(e){} return 1; })()');
    const sys = await ev('SR.api.lastSystem || ""');
    const 角色 = JSON.parse(await ev('JSON.stringify(SR.api.lastHistRoles || null)') || 'null');
    return { sys: sys, 角色: 角色 };
  };

  console.log('\n第 1 趟 · 一段装不下的历史（该裁、该有附注）');
  const 一 = await 走一趟(装不下, '接着往下');
  console.log('   真发出去的历史角色：' + JSON.stringify(一.角色));
  console.log('   system 长度 = ' + 一.sys.length);
  const 有附注 = 一.sys.indexOf('# 附：这轮之前省掉的那几轮') >= 0;
  判('1甲 附注真进了要发出去的那段 system', 有附注);
  // ★★ 轮数**不写死**：先看真发出去的历史留下几条（那是产品另一处的读数），
  //   倒推被省掉的那一段，数里面有几条 user——再用它去核附注上印的那个数。
  //   写死"应该是 2 轮"就变成我拿自己的预期当尺子：预算那一条是产品按
  //   b.budget / budgetImage 现算的，我算不到它。
  判('1乙 这一趟**真的裁了**（不裁的话后面几条是空转）', 一.角色 && 一.角色.length < 装不下.length,
    一.角色.length + ' / ' + 装不下.length);
  const 丢几条 = 装不下.length - 一.角色.length;
  const 丢的那段 = 装不下.slice(0, 丢几条);
  const 应轮数 = 丢的那段.filter(x => x.role === 'user').length;
  const 老师丢的话 = 丢的那段.filter(x => x.role === 'user')
    .map(x => String(x.content).replace(/\s+/g, ' ').trim())
    .map(s => s.length > 24 ? s.slice(0, 24) : s);
  console.log('   按历史推：省掉 ' + 丢几条 + ' 条，其中老师的 ' + 应轮数 + ' 句：' + JSON.stringify(老师丢的话));
  判('1丙 附注上的轮数跟"真发出去的历史"对得上（两处读数互核，不是我自己算的）',
    new RegExp('省掉了开头的 ' + 应轮数 + ' 轮').test(一.sys), (一.sys.match(/省掉了开头的 \d+ 轮/) || [''])[0]);
  判('1丁 老师被省掉的那几句，每一句都在附注里（截到 24 字）',
    老师丢的话.every(t => 一.sys.indexOf('「' + t) >= 0));
  判('★★ 1戊 模型自己那两句**没进去**（摘回去＝让它照着自己演）',
    一.sys.indexOf('模型第一答说的是已经画好了') < 0 && 一.sys.indexOf('模型第二答说的是没问题') < 0);
  判('★★ 1己 真发出去的历史头一句**不是 assistant**（⑤ 治的正病）',
    一.角色 && 一.角色.length > 0 && 一.角色[0] === 'user', JSON.stringify(一.角色));
  判('1庚 历史的尾巴没被挪动：最后还是老师那句 + 模型那句',
    一.角色 && 一.角色.slice(-2).join() === 'user,assistant', JSON.stringify(一.角色.slice(-2)));

  // 附注必须排在收尾块**前面**。收尾块就用产品自己那份原文来找位置，不写死句子。
  const 位 = JSON.parse(await ev('(function(){ var s = SR.api.lastSystem || ""; var t = SR.PROMPT_SAY_TAIL || ""; return JSON.stringify({附注: s.indexOf("# 附：这轮之前省掉的那几轮"), 收尾块: t ? s.indexOf(t) : -1, 收尾块长: t.length}); })()'));
  console.log('   位置：' + JSON.stringify(位));
  判('★★ 1辛 附注排在收尾块**前面**（排后面就是把 想说/ggb 围栏挤开，有实测的老伤）',
    位.附注 >= 0 && 位.收尾块 >= 0 && 位.附注 < 位.收尾块, 位.附注 + ' < ' + 位.收尾块);

  console.log('\n第 2 趟 · 一段装得下的历史（**反例**：一个字都不许加）');
  const 二 = await 走一趟(装得下, '接着往下');
  console.log('   真发出去的历史角色：' + JSON.stringify(二.角色));
  判('★★ 2甲 没裁就不加附注（不然模型会以为老师前面还问过话）',
    二.sys.indexOf('# 附：这轮之前省掉的那几轮') < 0);
  判('2乙 这段历史整份原样发出去（7 条都在）',
    二.角色 && 二.角色.length === 7, JSON.stringify(二.角色));

  console.log('\n第 3 趟 · 真对话还能不能接上（附注别把模型带沟里）');
  // 走一趟真的，看有没有回话。free 档 429 也算"没被附注搞坏"，只报不判。
  const 回 = await ev('(async function(){ try { var r = await SR.api.ask({ work:"draw", history:' + JSON.stringify(装不下) + ', parts:[], text:"我们接着上一句说，我上一句问的是什么？", onChunk:function(){} }); return JSON.stringify({ 有回: !!(r && r.text), 长: r && r.text ? r.text.length : 0, 错: (r && r.error) || "" }); } catch(e){ return JSON.stringify({ 炸: String(e && e.message || e) }); } })()');
  console.log('   第 3 趟结果：' + 回);
  const R = JSON.parse(回);
  判('3甲 附注没把这一轮搞崩（要么有回话，要么是免费档 429/超时，不是页面里的错）',
    R.有回 === true || R.炸 === undefined, JSON.stringify(R));

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

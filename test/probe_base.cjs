// ① 一条底座＋五份附录 —— **确定性**那一半（不花模型额度、不判模型行为）。
//
// 量三件事：
//   ① 六个工位拼出来的系统提示词，**每一个都以底座开头**（位置：最前）；
//   ② 底座那句身份在拼出来的正文里**只出现一次**（一次拼装、没拼两遍）；
//   ③ 作图那格自己的**末尾契约还在末尾**（底座挪进来不许把 SAY 尾巴挤走）。
// 再加一个**反例**：把 SR.PROMPT_BASE 临时置空，拼出来的必须正好短了它那么多、
//   而且不再以那句身份开头。没有这一步，"以底座开头"这个断言分不清
//   "真的拼进去了"和"那句话本来就在附录里"。做完立刻还原。
//
// ⚠ 只连隔离档那台探针浏览器（9222），不碰老师自己的 Chrome。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222;

const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p },
  r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));

let 过 = 0, 红 = 0;
const 判 = (名, ok, 读) => { if (ok) 过++; else 红++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (读 !== undefined ? '   ' + 读 : '')); };

(async () => {
  const 列表 = await 取('/json/list');
  const 候选 = 列表.filter(t => t.type === 'page' && /^(https?:\/\/)?(localhost|127\.0\.0\.1):8138/.test(String(t.url)));
  if (!候选.length) { console.error('★ 没有 8138 的标签页。'); process.exit(2); }

  let 会话 = null;
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
        throw new Error('页面里这一句炸了：' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
      }
      return r.result && r.result.result && r.result.result.value;
    };
    const 有 = await ev('typeof SR !== "undefined" && !!SR.WORKS');
    if (有 === true) { 会话 = { 发, ev, w }; break; }
    w.close();
  }
  if (!会话) { console.error('★ 没找到真跑着数根的标签页。'); process.exit(2); }
  const { 发, ev, w } = 会话;

  await 发('Network.enable');
  await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.enable');
  await 发('Page.reload', { ignoreCache: true });

  // 等产品自己的就绪信号（别按秒表读状态）
  let 就绪 = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const s = await ev('typeof SR !== "undefined" && !!SR.api && typeof SR.api.buildSystem === "function" && !!SR.PROMPT_BASE && !!SR.WORK_ORDER');
      if (s === true) { 就绪 = true; break; }
    } catch (e) { /* 还在装配 */ }
  }
  if (!就绪) { console.error('★ 等了 30 秒产品没就绪（SR.api.buildSystem / SR.PROMPT_BASE 没齐）。读数作废。'); process.exit(2); }

  // ★★ 先把"这一版装的是哪一版"读回来核对 —— 线上吃同源缓存会把已生效的判成没生效。
  const 指纹 = await ev('JSON.stringify({base:(SR.PROMPT_BASE||"").length, 底座头:(SR.PROMPT_BASE||"").slice(0,24), 工位:SR.WORK_ORDER.slice()})');
  console.log('这一版装的是：' + 指纹 + '\n');
  const 指 = JSON.parse(指纹);
  if (!/^# 你是谁/.test(指.底座头)) {
    console.error('★ 页面上装的底座不是一个以「# 你是谁」开头的版本 —— 读数作废（先怀疑缓存）。');
    process.exit(2);
  }

  const 身份 = '你是「数根」，一个初中数学的助手';
  const 读 = await ev('(function(){ var o={}; var 册 = SR.名册 ? SR.名册() : "";' +
    ' SR.WORK_ORDER.forEach(function(wk){' +
    ' try { var s = SR.api.buildSystem(wk, "画一条数轴", null, [], [], {});' +
    ' o[wk] = { 长:s.length, 开头:s.slice(0, 60), 身份出现次数:(s.split(' + JSON.stringify(身份) + ').length-1),' +
    '   以底座开头: s.indexOf(SR.PROMPT_BASE) === 0,' +
    '   底座长: (SR.PROMPT_BASE||"").length,' +
    // ★ 名册的位置要**逐字比**：它必须正好落在"底座＋分隔符"的后面。
    //   只量"在不在"是恒真的（那段话本来就可能出现在某格附录里）。
    '   名册位置: 册 ? s.indexOf(册) : -1,' +
    '   名册次数: 册 ? (s.split(册).length-1) : 0 }; }' +
    ' catch(e){ o[wk] = { err: String(e && e.message || e) }; } });' +
    ' o.__底座长 = SR.PROMPT_BASE.length;' +
    // 作图那格的末尾契约
    ' try { var d = SR.api.buildSystem("draw", "画一条数轴", null, [], [], {});' +
    '   o.__作图尾 = (SR.PROMPT_SAY_TAIL||"").length ? (d.length - d.lastIndexOf(SR.PROMPT_SAY_TAIL) - SR.PROMPT_SAY_TAIL.length) : -1;' +
    '   o.__作图尾块长 = (SR.PROMPT_SAY_TAIL||"").length; } catch(e){ o.__作图尾 = "炸:"+e.message; }' +
    ' return JSON.stringify(o); })()');
  const r = JSON.parse(读);

  console.log('【① 底座在最前面】');
  for (const wk of 指.工位) {
    const x = r[wk] || {};
    if (x.err) { 判(wk, false, '拼装炸了：' + x.err); continue; }
    判(wk, x.以底座开头 === true && x.身份出现次数 === 1,
      x.长 + ' 字  以底座开头=' + x.以底座开头 + '  底座那句身份出现 ' + x.身份出现次数 + ' 次');
  }

  console.log('\n【② 反例：把底座换成一句哨兵，拼出来的必须**以哨兵开头**且长度对得上】');
  // ★ 为什么用哨兵而不是"把底座置空"：置空撞的是三元表达式的 **falsy 分支**
  //   （`SR.PROMPT_BASE ? 底座+分隔符 : ''`），量到的是"分支走对了"，不是"底座被拼在最前面"。
  //   换成一句世上不存在的话，拼出来的开头必须正好是它 —— 这才分得清
  //   "真的拼进去了"和"那句话本来就在附录里"。
  const 工 = 指.工位[0], 长原 = r[工].长, 长尾 = r.__底座长;
  const 哨兵 = '【哨兵·底座·9f3a】';
  const 分隔 = '\n\n---\n\n';
  await ev('window.__basebak = SR.PROMPT_BASE; SR.PROMPT_BASE = ' + JSON.stringify(哨兵) + ';');
  const 哨 = await ev('SR.api.buildSystem(' + JSON.stringify(工) + ', "画一条数轴", null, [], [], {}).slice(0, 80)');
  const 哨长 = await ev('SR.api.buildSystem(' + JSON.stringify(工) + ', "画一条数轴", null, [], [], {}).length');
  await ev('SR.PROMPT_BASE = window.__basebak; delete window.__basebak;');
  const 还原 = await ev('(SR.api.buildSystem(' + JSON.stringify(工) + ', "画一条数轴", null, [], [], {}).length)');
  const 预期 = 长原 - 长尾 + 哨兵.length;
  判('换哨兵后正好以哨兵＋分隔符开头',
    哨.indexOf(哨兵 + 分隔) === 0, '  开头＝' + JSON.stringify(String(哨).slice(0, 40)));
  判('长度正好是 「原长 − 底座 + 哨兵」（' + 长原 + ' − ' + 长尾 + ' + ' + 哨兵.length + ' ＝ ' + 预期 + '）',
    哨长 === 预期, '  实测 ' + 哨长);
  判('拿了还回去，长度一字不差地复原', 还原 === 长原, 还原 + ' vs ' + 长原);

  console.log('\n【③ 作图那格的末尾契约还在末尾】');
  判('作图拼出来的正文里，`想说` 收尾块就是最后一个字',
    typeof r.__作图尾 === 'number' && r.__作图尾 === 0,
    '收尾块之后还剩 ' + r.__作图尾 + ' 字（该是 0）／收尾块本身 ' + r.__作图尾块长 + ' 字');

  // ============================================================
  // ④ 名册（2026-10-07，整改②）——夹在底座和附录中间那一截
  // ============================================================
  // ★ 量的是**位置**（名册紧接在「底座＋分隔符」后面），不是"这段字在不在"。
  //   只量在不在的话，这段话（或者它的一部分）本来就可能出现在某格附录里，断言恒真。
  // ★ 配一条**反例**：把 SR.名册 摘掉重拼，长度必须正好短「名册＋分隔符」那么多、
  //   而且名册那一句在拼出来的正文里再也找不到。少了这一步，
  //   "位置对"分不清"真的拼进去了"和"那句话本来就在附录里"（跟②那条同一个道理）。
  console.log('\n【④ 名册：夹在底座和附录中间，六格逐字相同】');
  const 隔 = '\n\n---\n\n';
  const 册文 = await ev('(SR.名册 ? SR.名册() : "")');
  const 册长 = String(册文 || '').length;
  if (!册长) {
    判('SR.名册() 非空', false, '名册是空的 —— 这一节整节作废，别把"没装"读成"装对了"');
  } else {
    判('六格拼出来的名册**逐字相同**、且只出现一次',
      Object.keys(r).filter(k => !/^__/.test(k)).every(wk => r[wk] && !r[wk].err
        && r[wk].名册位置 === (r[wk].底座长 + 隔.length) && r[wk].名册次数 === 1),
      Object.keys(r).filter(k => !/^__/.test(k)).map(wk => wk + '(第' + (r[wk] && r[wk].名册位置) + '字,出现' + (r[wk] && r[wk].名册次数) + '次)').join(' '));

    // 反例：摘掉名册重拼
    const 工0 = 指.工位[0], 长0 = r[工0].长;
    await ev('window.__rosterbak = SR.名册; SR.名册 = undefined;');
    let 摘长 = -1, 摘在 = -1;
    try {
      摘长 = await ev('SR.api.buildSystem(' + JSON.stringify(工0) + ', "画一条数轴", null, [], [], {}).length');
      摘在 = await ev('SR.api.buildSystem(' + JSON.stringify(工0) + ', "画一条数轴", null, [], [], {}).indexOf(' + JSON.stringify(String(册文).split('\n')[0]) + ')');
    } finally {
      await ev('SR.名册 = window.__rosterbak; delete window.__rosterbak;');
    }
    const 还原长 = await ev('SR.api.buildSystem(' + JSON.stringify(工0) + ', "画一条数轴", null, [], [], {}).length');
    判('摘掉名册后正好短了「名册＋分隔符」（' + 长0 + ' − ' + 册长 + ' − ' + 隔.length + ' ＝ ' + (长0 - 册长 - 隔.length) + '）',
      摘长 === 长0 - 册长 - 隔.length, '实测 ' + 摘长);
    判('摘掉之后正文里再也找不到名册的开头那行（不是"本来就在别处"）', 摘在 === -1, '位置 ' + 摘在);
    判('拿了还回去，长度一字不差地复原', 还原长 === 长0, 还原长 + ' vs ' + 长0);

    // ============================================================
    // ⑤ 名册**不是抄下来的**：往真源里塞一件假的，它必须自己长出来
    // ============================================================
    // ★ 这一条是防"第二份真源"的：有人哪天图省事把六行写死在 prompt-base.js 里，
    //   上面④那几条**照样全绿**（位置对、六格相同），只有这一条会红。
    //   没有它，"名册是从 SR.WORK_ORDER 现算的"就只是一句注释。
    // ★ 全程 try/finally，塞进去的东西一律还回去。
    console.log('\n【⑤ 反例：名册是现算的，不是写死的（塞一件假的，它得自己长出来）】');
    const 假 = await ev([
      '(function(){ var 备份序 = SR.WORK_ORDER.slice();',
      ' try {',
      // ★ 只往真源里加一件、加完 delete 掉：**整个换掉 SR.WORKS 对象**是不行的，
      //   别的模块还攥着原来那个引用。
      '   SR.WORKS.__probe = { label: "试工位", takes: "拿走：一句哨兵·7c1f，你的课件里能直接用。" };',
      '   SR.WORK_ORDER = 备份序.concat(["__probe"]);',
      '   var s = SR.名册();',
      // ⚠ 从行首那个 `- ` 起截，别从「试工位」起截——从标签起截会**把前导的「- 」切掉**，
      //   于是逐字比必红，而红的样子跟"名册坏了"一模一样（这一把第一版就是这么红的）。
      '   var k = s.indexOf("- 试工位");',
      // ★ 只取**假工位那一行**来逐字比。整段 s 里还有收尾那两句（"你自己不主动提换工具"），
      //   拿整段去搜"还有没有你"必然搜到 —— 那种断言是恒红的假红，跟恒绿一样没用。
      '   var 段 = k < 0 ? "(没长出来)" : s.slice(k, s.indexOf("\\n", k) < 0 ? s.length : s.indexOf("\\n", k));',
      '   return JSON.stringify({ 段: 段, 件数跟着长: s.indexOf("7件活儿") >= 0, 长: s.length });',
      ' } finally { delete SR.WORKS.__probe; SR.WORK_ORDER = 备份序; }',
      '})()',
    ].join('\n'));
    let 假R = null;
    try { 假R = JSON.parse(String(假)); } catch (e) { }
    if (!假R) {
      判('塞假工位那一趟跑通了', false, '读回来的是：' + String(假).slice(0, 140));
    } else {
      // ★ 逐字比：这一行同时钉住三件事——①假工位被现算进去了（写死就红）
      //   ②`拿走：` 被剥掉 ③takes 里的「你」换成了「老师」。
      //   拆成三条各自搜子串也行，但那样"剥没剥干净"还得另写一条正则——不如把整行钉死。
      判('假工位那一行**逐字**长这样（写死名册 / 没剥前缀 / 没换人称，三种坏法都会在这儿红）',
        假R.段 === '- 试工位：一句哨兵·7c1f，老师的课件里能直接用。', '得到「' + 假R.段 + '」');
      判('件数跟着长（写死"六件活儿"的话这里红）', 假R.件数跟着长 === true, '');
    }
    // 还原核：塞完还回去，名册必须跟原来一字不差
    const 册还 = await ev('(SR.名册 ? SR.名册() : "")');
    判('塞完还回去，名册一字不差', 册还 === 册文, String(册还).length + ' vs ' + 册长);
  }

  // ============================================================
  // ⑥ 交接口（2026-10-07，整改②）——换工位那第一轮才拼的那一句
  // ============================================================
  // ★ 这一节量的是**不多不少**：不传时必须**逐字不变**（老调用点、探针、修理指令那一趟
  //   都不传，行为得跟今天一模一样）；传了必须正好多出那一句＋分隔符。
  //   只量"传了有"是不够的——那样"不管传不传都拼"也全绿，而那是会串味的。
  console.log('\n【⑥ 交接口：不传就一个字都不多，传了正好多那一句】');
  {
    const 工1 = 指.工位[0], 长1 = r[工1].长;
    const 句 = '老师刚从【备课】换到【作图】。上面那些话都算数——接着往下办。';
    const 前缀 = '老师换工位的交接：';
    const 有句 = await ev('SR.api.buildSystem(' + JSON.stringify(工1) + ', "画一条数轴", null, [], [], {}, null, null, null, null, ' + JSON.stringify(句) + ').length');
    判('传了 → 正好多出「' + 前缀 + '」＋那句＋分隔符（+' + (前缀.length + 句.length + 隔.length) + '）',
      有句 === 长1 + 前缀.length + 句.length + 隔.length, 长1 + ' → ' + 有句);
    const 找句 = await ev('SR.api.buildSystem(' + JSON.stringify(工1) + ', "画一条数轴", null, [], [], {}, null, null, null, null, ' + JSON.stringify(句) + ').indexOf(' + JSON.stringify(前缀 + 句) + ')');
    const 在册后 = await ev('(function(){ var s = SR.api.buildSystem(' + JSON.stringify(工1) + ', "画一条数轴", null, [], [], {}, null, null, null, null, ' + JSON.stringify(句) + '); return s.indexOf(' + JSON.stringify(前缀 + 句) + ') > s.indexOf(SR.名册()); })()');
    判('那句是**连着前缀一整段**拼进去的（不是把话拆散了塞）', 找句 > 0 && 在册后 === true, '位置 ' + 找句);
    // ★ 不传那条要拿**新拼的一份**去搜前缀，不能拿 r[工1].长 跟自己比（那是恒真）。
    const 不传 = await ev('(function(){ var s = SR.api.buildSystem(' + JSON.stringify(工1) + ', "画一条数轴", null, [], [], {}); return s.length + "|" + (s.indexOf(' + JSON.stringify(前缀) + ') >= 0 ? 1 : 0) })()');
    判('不传 → 长度还是 ' + 长1 + '、正文里搜不到那个前缀（老调用点行为逐字不变）',
      不传 === (长1 + '|0'), '得到 ' + 不传);
  }

  console.log('\n══ ' + 过 + ' 绿 / ' + 红 + ' 红 ══');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

// 整改③「命令改成查」的**确定性**尺子 —— 不碰网络、不调模型，纯函数级。
//
// 为什么 ③ 需要一把自己的尺子（probe_drawfence.cjs 那张总表不够）：
//   那个探针量的是"整臂效果"（贴签名 vs 不贴，图有没有更准）。可它有一个瞎子区——
//   **两臂差值 0 的时候分不清"贴了没用"和"用例根本没碰到签名"**。
//   这一把尺子量的是上游那半截：**门在不在、翻得对不对、贴的剂量对不对**。
//   两头都有读数，③ 才说得清。（同族的教训：[[scanner-numbers-are-not-what-they-claim]]）
//
// 量四件**可核**的事：
//   ① 该中的句子真中（正面用例）
//   ② 挨不着边的句子一条都不中（对照——这一条才是"门"这个字的全部意思）
//   ③ 贴出去的是**签名原文**，不是缩写／不是我自己总结的一句话
//   ④ 一条都没中的时候，system **一个字符都不加**（不是"加个空段"）
//
// ⚠ 这里**不判**"这话该配哪条签名"这类金标准 —— 我手里没有那份金标准
//   （board.js 的注释只说"哪些命令是真的"，没说"老师这么说话该给哪条"）。
//   硬编一套等于拿我脑子里的表当答案。所以正面用例挑的都是**没有歧义**的那种，
//   有争议的（「画个圆柱」里要不要连 Circle 一起贴）**只印出来、不判**。
//
// ⚠ 装表必须跟 probe_drawfence.cjs / index.html 同序同集。少装一份的话，
//   `SR.ggbcmds` 是 undefined、api.js 那段静默跳过 —— 读数是"一条都没贴"，
//   而每一格照样绿。所以脚本开头先做**身份自检**，装了哪一版当场打出来。
const path = require('path'), fs = require('fs');

const store = {};
const LS = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const W = { SR: {} };
const 文件表 = ['config.js', 'prompt-base.js', 'prompt-draw.js', 'drawkb.js', 'ggbcmds.js',
  'prompt-say.js', 'textbook.js', 'retrieve.js', 'api.js', 'render.js', 'chips.js'];
for (const f of 文件表) {
  new Function('window', 'localStorage', 'navigator',
    'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
}
const SR = W.SR;

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => {
  if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
  else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
};

// ---- 身份自检：装的到底是不是这一版 ----
{
  const 张 = SR.ggbcmds ? SR.ggbcmds.卡.length : null;
  console.log('装表 ' + 文件表.length + ' 份：' + 文件表.join(' '));
  console.log('SR.ggbcmds：' + (SR.ggbcmds ? 张 + ' 条' : '★没装')
    + '　SR.WORKS.draw.cmds：' + (SR.WORKS.draw.cmds === undefined ? '★没有这条' : SR.WORKS.draw.cmds)
    + '　SR.PROMPT_BASE：' + (SR.PROMPT_BASE || '').length + ' 字\n');
  if (!SR.ggbcmds) { console.error('★ js/ggbcmds.js 没装进来 —— 这趟读数作废。'); process.exit(2); }
  if (SR.WORKS.draw.cmds !== true) { console.error('★ 作图工位的 cmds 开关不是 true —— 这趟读数作废。'); process.exit(2); }
  if (!(SR.PROMPT_BASE || '').length) { console.error('★ 没装上 prompt-base.js —— 量到的不是线上那份，作废。'); process.exit(2); }
}

const 卡名 = SR.ggbcmds.卡.map(c => c.名);
const 翻名 = 话 => SR.ggbcmds.翻(话).map(c => c.名);

// ---- ① 该中的句子真中 ----
// 每一格挑的都是**这句话里只能指那一条**的那种，没有第二种读法。
const 正例 = [
  { 话: '画个圆，半径能拖的',   该中: ['Circle', 'Slider'] },
  { 话: '画个正方形，边长 3',    该中: ['Polygon'] },
  { 话: '画个正方体的展开图',    该中: ['Cube', 'Net'] },
  { 话: '画条形统计图，五天的人数', 该中: ['BarChart'] },
  { 话: '算一下这组数据的标准差',  该中: ['统计量'] },
  { 话: '把这个三角形沿 x 轴对称过去', 该中: ['Polygon', 'Mirror'] },
  { 话: '画条数轴，带个动点 P',    该中: ['Slider', 'Point'] },
  { 话: '折线统计图上标一下',     该中: ['Polyline'] },
  // ★ 第 14 条（2026-10-06 夜从 probe_sigsink 的读数里长出来的那条卡）也得有人管。
  { 话: '画 y=x^2-2x-3 的图象，标出它的最低点', 该中: ['顶点/极值'] }
];
console.log('══ ① 该中的真中（正面用例）══');
for (const c of 正例) {
  const 得 = 翻名(c.话);
  const 缺 = c.该中.filter(n => 得.indexOf(n) < 0);
  判('「' + c.话 + '」→ ' + 得.join('、'), 缺.length === 0,
    缺.length ? '★ 该中没中：' + 缺.join('、') : '');
}

// ---- ② 挨不着边的句子一条都不中 ----
// ★★ 这一条才是"门"这个字的全部意思。没有它，门表写成 `门: ['']` 也全绿。
const 反例 = [
  '今天天气不错',
  '作业收齐了吗',
  '明天要开家长会',
  '这次周练班上考得怎么样',
  '把这份卷子的抬头换成我们学校的',
  '下节课讲什么',
  // ★★ 这一句是**另一种反例**，比上面几行都重要：上面那些是"根本没在说画图"，
  //   这一句是**货真价实的作图请求，而门表对它无话可说**（14 条门一个都不沾）。
  //   它同时是 probe_sigsink.cjs 的对照臂原话（那边靠"两臂提示词逐字相同"当噪声地板）。
  //   ⚠ 加卡那天，这一句要跟那边一起重核：门表一旦收进「线段」这类词，
  //     对照臂就不再是对照臂（两臂提示词不同了，"差值=噪声"这个前提当场作废）。
  '画一条线段 AB，长 5 厘米'
];
console.log('\n══ ② 挨不着边的一条都不许中（这一条才是"门"）══');
for (const 话 of 反例) {
  const 得 = 翻名(话);
  判('「' + 话 + '」→ ' + (得.length ? 得.join('、') : '（一条都没有）'), 得.length === 0);
}

// ---- ③ 剂量：最多 4 条 ----
console.log('\n══ ③ 一次最多贴 4 条（贴多了等于没贴）══');
{
  const 话 = '画个三角形，里面放个圆，把它沿 y 轴对称，再绕原点旋转，边上标上平均数，还要写个根号';
  const 得 = 翻名(话);
  判('一句话里踩中 6 条的时候，只吐 4 条', 得.length === 4, 得.length + ' 条：' + 得.join('、'));
}

// ---- ④ 有争议的那种：只印不判 ----
console.log('\n══ ④ 有争议的（只印出来看，不判——我手里没有这份金标准）══');
for (const 话 of ['画个圆柱', '画个球，球心在原点', '绕着原点转一圈', '这组分数的平均数是多少',
  '画个等腰梯形', '放大到原来的两倍']) {
  console.log('   「' + 话 + '」→ ' + (翻名(话).join('、') || '（一条都没中）'));
}

// ---- ⑤ 贴进 system 的到底是哪几条、是不是原文 ----
// ★★ 这一格必须**自带对照臂**：把 `SR.WORKS.draw.cmds` 翻成 false 再跑一遍同一个 buildSystem。
//   只压"开的时候贴进去了"，会漏掉"那个串本来就在提示词里"（那就是恒绿）；
//   只压"关的时候没有"，会漏掉"开了也没贴"（③ 白做）。两头都压才对得上。
console.log('\n══ ⑤ 真贴进 system 的那一段（自带对照臂：同一个 buildSystem，翻开关前后各跑一遍）══');
{
  const 用例 = [
    { 话: '画个圆，半径能拖的',      该中: ['Circle', 'Slider'] },
    { 话: '画个正方体的展开图',      该中: ['Cube', 'Net'] },
    { 话: '今天天气不错',            该中: [] }               // ★ 对照：一个字符都不许加
  ];
  for (const c of 用例) {
    SR.WORKS.draw.cmds = true;
    const 开 = SR.api.buildSystem('draw', c.话, null, [], [], {});
    SR.WORKS.draw.cmds = false;
    const 关 = SR.api.buildSystem('draw', c.话, null, [], [], {});
    SR.WORKS.draw.cmds = true;   // ★ 当场还原，后面还要用

    const 该贴 = SR.ggbcmds.卡.filter(x => c.该中.indexOf(x.名) >= 0);
    const 贴了 = SR.ggbcmds.卡.filter(x => 开.indexOf(x.体) >= 0).map(x => x.名);
    const 关里也有 = SR.ggbcmds.卡.filter(x => 关.indexOf(x.体) >= 0).map(x => x.名);

    if (c.该中.length === 0) {
      // ★★ 没有那一档就不提那件事：加一段空的「以下是签名」也算加了东西。
      判('「' + c.话 + '」：一条都没中 → system **一个字符都不加**', 开 === 关,
        '开 ' + 开.length + ' 字 / 关 ' + 关.length + ' 字');
      判('   └ 对照臂里也确认一条签名都没有', 关里也有.length === 0, '关里贴了：' + (关里也有.join('、') || '无'));
    } else {
      判('「' + c.话 + '」：开的时候真贴上了 ' + c.该中.join('、'),
        贴了.length === c.该中.length && c.该中.every(n => 贴了.indexOf(n) >= 0), '实贴：' + (贴了.join('、') || '无'));
      判('   └ 贴的是**签名原文**（拿整段正文在 system 里找出来的，不是缩写的）',
        该贴.every(x => 开.indexOf(x.体) >= 0), c.该中.length + ' 条');
      判('   └ ★ 对照臂：把 cmds 关了，同一个 buildSystem **一条都贴不上**（这条保证上面那条不是恒绿）',
        关里也有.length === 0, '关里贴了：' + (关里也有.join('、') || '无'));
      判('   └ 开的那份比关的那份长（真加进去了，不是替换）', 开.length > 关.length,
        '开 ' + 开.length + ' 字 / 关 ' + 关.length + ' 字，差 ' + (开.length - 关.length));
    }
  }
}

// ---- ⑥ ③ 的那张表只许收**验证过**的签名 ----
// 这一格防的是"哪天有人照着 GeoGebra 官方文档往表里添条目"——那份文档里 `PointIn`、`Stdev`
// 都写得有，可它们在**这块画板上**什么都没有。判据是 board.js 注释里那几条实测指纹。
console.log('\n══ ⑥ 表里只许有验证过的签名（防"照文档添条目"）══');
{
  const 全体 = SR.ggbcmds.卡.map(c => c.体).join('\n');
  const 该在 = ['SD', 'Net(', 'BarChart(', 'Point('];
  const 不该有 = ['Stdev', 'PointIn'];
  该在.forEach(w => 判('验证过的写法在里面：' + w, 全体.indexOf(w) >= 0));
  // ⚠ 这两条带**否定提示**（"⚠ 不是 Stdev"），所以不能拿"字符串在不在"判——
  //   它们在表里出现的正是"别用"那个位置。判"它只出现在警告句中"。
  不该有.forEach(w => {
    const 坏 = SR.ggbcmds.卡.filter(c => c.体.indexOf(w) >= 0 && c.体.indexOf('⚠') < 0);
    判('「' + w + '」只允许出现在 ⚠ 警告里，不许被当成正面写法',
      坏.length === 0, 坏.length ? '★ 被当成正面写法：' + 坏.map(c => c.名).join('、') : '只出现在警告里');
  });
}

console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
process.exit(红 ? 1 : 0);

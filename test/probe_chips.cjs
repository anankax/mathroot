// 按钮那两件事的最后一道关：
//   ① `SR.filterCopiedChips` —— 模型现编的按钮里，抄了提示词示范的**整组作废**。
//   ② `SR.fallbackChips`     —— 每个工位落到的**兜底那一档**对不对。
//
// ★ 2026-10-02 重写。旧版量的东西有一半已经不存在了：
//   它测的是**学生口吻**的按钮（"我看它们在数轴上谁靠左谁靠右"）和 `demo / open / stuck / said`
//   那几档——那一整套是学生版遗留，2026-10-02 随"摆链子"一起删了（现在底下摆的是
//   **老师的导演话**，SR.CHIPS 里只剩 draw/vary/material/review/chain 五档）。
//   旧用例还在比那些早已不存在的字符串，**它红不红已经跟产品没关系了**——
//   一份量着不存在的东西的脚本，比没有脚本更坏：它绿的时候你会以为查过了。
//
// 为什么这两件事值得单独一个文件：
//   · 过滤器的输入是**模型现编的话**，判据只能是启发式，两头都是活的。它失灵，
//     老师面前就会出现一句提示词里给**另一道题**写的样板话（点下去当场用不上）。
//   · 兜底的**分派**错一格，老师看到的三句话就跟他手上的活儿完全无关——
//     2026-10-02 出材料那档就是这么被漏掉的（那一格现在钉在下面 MODE_CASES 里）。
//
// 用法: node test/probe_chips.cjs     退出码 0=全过 1=有漏网的或误杀的
const path = require('path'), fs = require('fs');

const store = {};
const LS = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const W = { SR: {} };
// ⚠ **config.js 也要装**：`SR.DEFAULT_WORK` 在那儿。少了它，"默认工位"那一格的期望值是
//   `CHIPS[undefined]`——测试会红，而红的原因是**尺子自己没装全**，不是产品错了。
//   （第一版就是这么红的。）
for (const f of ['config.js', 'chips.js']) {
  new Function('window', 'localStorage', 'navigator',
    'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
}
const S = W.SR;
const F = S.filterCopiedChips;

// ---- ① 防抄：用例全部**照着当前那份 EXAMPLE_CHIPS 现写** ----
// ★ 用例里的"抄"必须真的是抄：锚在最前面那两条示范上（它们最像话，也最常被搬）。
//   ⚠ 提示词那边换一次示范，这里就得跟着换——`check_prep_prompts.cjs` 管名单同步，
//     这一份管"同步之后过滤器还咬不咬得住"。
const CHIP_A = S.EXAMPLE_CHIPS[1];   // 「先别急着写。题目里那个「总费用」，是哪两笔钱加起来的？」
const CHIP_B = S.EXAMPLE_CHIPS[0];   // 「x 我算出来了，可是题目问的是总费用，我不知道还要干什么」
const CHIP_D = S.EXAMPLE_CHIPS[3];   // 「没关系，这题确实难，我们看下一步」
const CASES = [
  // ---- 一字不差地抄 ----
  { name: '整句抄（第二条示范原样）', lines: [CHIP_A], void: true },
  { name: '整句抄·短的那条（「我不会」只有三个字，够不着六字雷同，只能靠一字不差挡）', lines: ['我不会'], void: true },
  // ---- 改几个字的抄（实测最常见的就是这种：整句比对全漏，只有六字雷同抓得住）----
  { name: '★改字的抄：句号换逗号、问号去掉', lines: [CHIP_A.replace('。', '，').replace('？', '')], void: true },
  { name: '★改字的抄：把「总费用」的引号摘了', lines: ['先别急着写。题目里那个总费用，是哪两笔钱加起来的？'], void: true },
  { name: '★改字的抄：示范掺在一组里（整组都作废）', lines: ['接着往下走', CHIP_B.slice(0, 12) + '，还得再想想', '走到第 3 个环节'], void: true },
  { name: '★改字的抄：安慰话那条', lines: ['没关系，这题是有点难，我们看下一步吧'], void: true },
  // ---- 该留下的 ----
  { name: '★反例：模型自己编的导演话（这才是我们要的）', lines: ['把这一步的x挪到等号左边', '下一节先问他单位', '先让他把两个条件念一遍'], void: false },
  { name: '★反例：本地兜底那一档（chain）', lines: S.CHIPS.chain.slice(), void: false },
  { name: '★反例：短句（不够六字，不能一刀切）', lines: ['我算错了', '我卡住了'], void: false },
  // ★ 边界：三字示范（「我不会」）只挡得住一字不差，加了字就放过。
  //   这是**知道的边界**，不是靠它拿分——它哪天被抓住了，这一格会红，提醒把这行注释一起改。
  { name: '边界：「我不会说」passes（三字示范挡不住加字）', lines: ['我不会说'], void: false, note: '已知边界' },
  { name: '边界：三句全改过（只靠六字雷同，抓不住）', lines: ['我想先看他能不能把 x 挪过去', '这一步他多半会漏掉单位', '先让他念一遍题目问的是啥'], void: false, note: '这条本就抓不住，留着当"知道边界在哪"' }
];

let bad = 0;
console.log('===== ① 防抄（EXAMPLE_CHIPS 现 ' + S.EXAMPLE_CHIPS.length + ' 条）=====');
for (const c of CASES) {
  const out = F(c.lines);
  const gotVoid = out.length === 0;
  const ok = gotVoid === c.void;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.name + (c.note ? '（' + c.note + '）' : ''));
  if (!ok) console.log('      期望 ' + (c.void ? '作废' : '留下') + '，实际 ' + (gotVoid ? '作废' : '留下 ' + out.length + ' 条：' + out.join(' | ')));
}

// ---- ② 兜底分派：每个工位落到哪一档 ----
// ★ 这一格是 2026-10-02 从真事里长出来的：**出材料工位原来没有自己的词**，
//   于是掉进最后那句 `return SR.CHIPS.chain`——老师打开默认工位（就是出材料），
//   底下摆的是备课的「接着往下摆／整条链子给我」。所以每一条都得钉住。
const MODE_CASES = [
  { name: '默认工位（没给 work）→ 走 DEFAULT_WORK 那一档 = ' + S.DEFAULT_WORK, opts: {}, want: S.DEFAULT_WORK },
  { name: '出材料 → material（★ 曾经掉进 chain 的那一格）', opts: { work: 'material' }, want: 'material' },
  // ★★ 2026-10-04 加的这三格：作图那一档按**图上画的是什么**分成 draw / draw3d 了
  //   （起因是孔老师截图那三条"画个正方体／换成三维"，摆在一条数轴的底下）。
  //   ⚠ 没传 is3D 那一格是**最要紧的一格**：产品里任何一条忘了传的老路，
  //     都会落到这儿——它必须是 draw（平面），不是 undefined。
  { name: '画图 → draw（平面，默认那档）', opts: { work: 'draw' }, want: 'draw' },
  { name: '画图·判不出来（没传 is3D）→ 仍走平面那档', opts: { work: 'draw', is3D: '' }, want: 'draw' },
  { name: '画图·平面 → draw', opts: { work: 'draw', is3D: 'plane' }, want: 'draw' },
  { name: '★ 画图·立体 → draw3d（原来那张死表就是它）', opts: { work: 'draw', is3D: '3d' }, want: 'draw3d' },
  { name: '出题 → vary', opts: { work: 'vary' }, want: 'vary' },
  // ★ 反例：`is3D` 这个口子只许对作图开。出题也是摆弄画板的活儿，
  //   但它不该跟着换档（词库里根本没有 vary3d 这一档，真跳了就是 undefined）。
  { name: '★ 出题就算画的是立体，也不换档', opts: { work: 'vary', is3D: '3d' }, want: 'vary' },
  { name: '备课 → chain', opts: { work: 'prep' }, want: 'chain' },
  { name: '讲评·第一轮（刚列完题号）→ review', opts: { work: 'review', first: true }, want: 'review' },
  { name: '讲评·挑定一道之后 → chain（跟备课一样往下摆）', opts: { work: 'review', first: false }, want: 'chain' },
  // 没见过的工位 id：给 chain 是**故意的**（五个工位里两个是链子），但新工位必须自己加一档。
  { name: '没见过的工位 → chain（兜底，别再让新工位落到这儿）', opts: { work: '某个新工位' }, want: 'chain' }
];
console.log('');
console.log('===== ② 兜底分派 =====');
let bad2 = 0;
for (const c of MODE_CASES) {
  const got = S.fallbackChips(c.opts);
  const wantArr = S.CHIPS[c.want];
  // ★ 光比"是不是同一个数组"不够：哪天有人把 chain 那三句挪进 material 数组，比数组照样绿。
  //   所以再核一条**内容**：这一档的话得跟它宣称的那一档逐字一样。
  const ok = got === wantArr && Array.isArray(wantArr) && wantArr.length > 0;
  if (!ok) bad2++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
  if (!ok) console.log('      期望 CHIPS.' + c.want + '，拿到 ' + (got ? JSON.stringify(got) : String(got)));
}
// ★ 反例：各档的按钮**不该互相串**。任意两档只要内容一样，就说明有人复制粘贴没改。
//   ★ 2026-10-04 把 `draw3d` 也收进来：新分的这一档尤其容易是"上面那张表复制过来改两个字"，
//     而它跟平面那档**必须完全不同**——撞了就等于这刀白切，老师看到的三句还是立体那套。
const KEYS = ['draw', 'draw3d', 'vary', 'material', 'review', 'chain'];
let bad3 = 0;
console.log('');
console.log('===== ③ 五档互不串（每档的话必须不一样）=====');
for (let i = 0; i < KEYS.length; i++) {
  for (let j = i + 1; j < KEYS.length; j++) {
    const same = S.CHIPS[KEYS[i]].join('|') === S.CHIPS[KEYS[j]].join('|');
    if (same) { bad3++; console.log('  ✗ ' + KEYS[i] + ' 和 ' + KEYS[j] + ' 一模一样'); }
  }
}
if (!bad3) console.log('  ✓ ' + KEYS.length + ' 档两两不同');

// ============================================================
//  ④ 「三维名单」两处同步
// ============================================================
// ★★ 2026-10-04：`SR.ggbLooks3D` 里那份三维命令名单，**必须**是 board.js 的 CMD_MAP
//   那段 `---- 3D ----` 的子集——两处各是一份名单，就是"改一处忘一处"的老毛病。
//   ⚠ **不执行 board.js**（那文件要 DOM 和 GeoGebra，node 里装不起来），
//     把它当**文本**读、在两段注释之间切出那段映射，逐字去里面找。
//   ⚠ 只查一个方向（chips 的名单 ⊆ board 的名单）。反过来不查是故意的：
//     board 那边还有 `平面`／`棱`／`侧面` 三个**歧义词**，chips 这边不收它们。
const chipsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'chips.js'), 'utf8');
const boardSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'board.js'), 'utf8');
const i3 = boardSrc.indexOf('// ---- 3D ----');
const board3dBlock = i3 < 0 ? '' : boardSrc.slice(i3, boardSrc.indexOf('};', i3));
const 板上名 = [...board3dBlock.matchAll(/'([^']+)'\s*:/g)].map(m => m[1]);
const fnSrc = chipsSrc.slice(chipsSrc.indexOf('SR.ggbLooks3D'));
const mm = /return \/\(\?:([^)]+)\)\\s\*\\\(\//.exec(fnSrc);
const 尺上名 = mm ? mm[1].split('|') : [];
console.log('');
console.log('===== ④ 三维名单两处同步 =====');
let bad4 = 0;
if (!板上名.length || !尺上名.length) {
  bad4++;
  console.log('  ✗ 名单没切出来（board ' + 板上名.length + ' 条，chips ' + 尺上名.length + ' 条）'
    + '—— 是**尺子**的毛病，不是产品的：board.js 那段标记或 chips.js 那条正则改了形状。');
} else {
  const 缺 = 尺上名.filter(w => 板上名.indexOf(w) < 0);
  if (缺.length) { bad4++; console.log('  ✗ chips 认的这几个词，board.js 的 CMD_MAP 里根本没有：' + 缺.join('、')); }
  else console.log('  ✓ chips 认出 ' + 尺上名.length + ' 个三维名，board 的 3D 段（' + 板上名.length + ' 条）里一条不缺');
}
// ★ 光有子集还不够强：哪天一任性把名单删成两个字，子集照样成立。钉一条下界。
if (尺上名.length < 12) { bad4++; console.log('  ✗ 名单只剩 ' + 尺上名.length + ' 个词，太少——三维名不止这些'); }
else console.log('  ✓ 名单长度 ' + 尺上名.length + ' ≥ 12，不像被误删过');

// ============================================================
//  ⑤ 立体 / 平面 判得对不对
// ============================================================
// ★ 纯函数、只读文本（`SR.ggbLooks3D` / `SR.dimFromTexts`），所以能拿手写的假回复直接量。
//   这几条全都是**真实形状**：孔老师那张截图上的图就是"一条平面的数轴"，
//   而他抱怨的三句话全在讲正方体和球——第一格量的就是它。
const DIM = [
  { name: '一条数轴 → 平面', texts: ['```ggb\n#清空\n坐标系\n数轴\n```'], want: 'plane' },
  { name: '明写 #三维 → 立体', texts: ['```ggb\n#三维\n坐标系\n```'], want: '3d' },
  { name: '立方体不带 #三维 标记，也认得出', texts: ['```ggb\n立方体((0,0,0),(1,1,1))\n```'], want: '3d' },
  // ★ 这一格是这份名单最容易咬错人的地方：正文里顺口提一句球，图其实是平面的。
  //   判据里那条"三维名后面得跟括号"就是为它加的。
  { name: '★ 正文提了一句「球」，但图是平面的 → 平面', texts: ['```ggb\n坐标系\n圆心((0,0),1)\n```\n这个球的截面我们下节课再看'], want: 'plane' },
  { name: '★ 这一轮没画图 → 回头看上一轮（上一轮是正方体）', texts: ['```ggb\n#三维\n正方体(A,B)\n```', '这个交点为什么在这儿'], want: '3d' },
  // ★ 顺序不能反：拼起来判的话，上一轮的 #三维 会盖过这一轮明写的 #平面。
  { name: '★ 上一轮立体、这一轮明写 #平面 画数轴 → 平面赢', texts: ['```ggb\n#三维\n正方体(A,B)\n```', '```ggb\n#平面\n数轴\n```'], want: 'plane' },
  { name: '一条图都没画过 → 平面（默认）', texts: [], want: 'plane' },
  { name: '空文本也不炸', texts: [null, ''], want: 'plane' }
];
console.log('');
console.log('===== ⑤ 立体/平面 判得对不对 =====');
let bad5 = 0;
for (const c of DIM) {
  const got = S.dimFromTexts(c.texts);
  const ok = got === c.want;
  if (!ok) bad5++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.name + (ok ? '' : '  → 期望 ' + c.want + '，拿到 ' + got));
}
// ★ 反例（这条不判产品，判**尺子**）：上面那些 want 里得两种答案都出现过。
//   全填 'plane' 的话这一节恒绿，等于没量。
if (!DIM.some(c => c.want === '3d') || !DIM.some(c => c.want === 'plane')) {
  bad5++; console.log('  ✗ 用例里 3d/plane 没有各出现一次 —— **这一节自己是恒绿的**，重写');
} else console.log('  ✓ 鲁棒：3d 与 plane 两种期望都在用例里出现过（不是"全填 plane"的恒绿题）');

const total = CASES.length + MODE_CASES.length + DIM.length, badAll = bad + bad2 + bad3 + bad4 + bad5;
console.log('\n===== 按钮：防抄 ' + (CASES.length - bad) + '/' + CASES.length
  + '，分派 ' + (MODE_CASES.length - bad2) + '/' + MODE_CASES.length
  + '，互不串 ' + KEYS.length + ' 档 ' + (bad3 ? '✗' : '✓')
  + '，名单同步 ' + (bad4 ? '✗' : '✓')
  + '，维度判定 ' + (DIM.length - bad5) + '/' + DIM.length + ' =====');
process.exit(badAll ? 1 : 0);

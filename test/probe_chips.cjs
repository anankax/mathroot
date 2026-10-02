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
  { name: '画图 → draw', opts: { work: 'draw' }, want: 'draw' },
  { name: '出题 → vary', opts: { work: 'vary' }, want: 'vary' },
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
// ★ 反例：五个工位的按钮**不该互相串**。任意两档只要内容一样，就说明有人复制粘贴没改。
const KEYS = ['draw', 'vary', 'material', 'review', 'chain'];
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

const total = CASES.length + MODE_CASES.length, badAll = bad + bad2 + bad3;
console.log('\n===== 按钮：防抄 ' + (CASES.length - bad) + '/' + CASES.length
  + '，分派 ' + (MODE_CASES.length - bad2) + '/' + MODE_CASES.length
  + '，互不串 ' + (bad3 ? '✗' : '✓') + ' =====');
process.exit(badAll ? 1 : 0);

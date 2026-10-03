// 尺子：把已经存下来的 **120 份模型原文** 重新过一遍**现在这一版**的解析器，
// 问一句：规则四那道闸，到底拦住了几份？有没有漏网？
//
// ★ 为什么不直接再跑 25 遍模型：
//   ① 模型是随机源，再跑一遍是"另一批样本"，不是"对这 25 份的复核"；
//   ② 存档就在手边，`test/_shot/vf*.txt` 每一份都是**模型当时的原文**，
//      过一遍解析器是**确定性的**——同一份存档跑一百遍结果一样。
//      纠"提示词改没改坏"这件事，拿存档回放比再抽一次样硬得多。
//
// ★ 这一把最容易变成"恒绿"：要是存档里**本来就没有**抄标签的行，
//   那"0 份漏到眼前"是句废话——它什么都没量。
//   所以下面**先断言有东西可拦**（有抄的原件数 > 0），为 0 就判尺子坏、不算数。
//   （同族：[[scanner-numbers-are-not-what-they-claim]] 里"整节断言量的是同一个隐藏元素"。）
//
// ★ 另一条反向对照：对照臂（B/D，提示词里**没有**这两行标签）的存档里
//   应该**一份都不含**这些词。它们含了，说明这些词根本是模型自己会说的话，
//   那我拦的根本不是"提示词的回声"，是正常对话——判据整个立不住。
//
// 用法：node test/probe_echo_replay.cjs
const path = require('path'), fs = require('fs');

const W = { SR: {} };
new Function('window', 'localStorage', 'navigator',
  fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'))(W, {}, { onLine: true });
const R = W.SR.render;

// 提示词自己的话。跟 js/render.js 里那两条判据**同源**（那边是 RE_ECHOWORD/RE_ECHOHEAD）——
// 这里是"量"，那边是"治"，两边必须认同一批词，否则量出来的绿是假的。
// （所以下面有个自检：这些词必须真能在 js/render.js 里找到。）
const 词 = ['题里有图', '题里没图', '一个围栏都不写', '每题一个围栏', '每题配一个围栏',
  '完整的回复是', '先数一数'];

// ---- 尺子自检：这些词真的是产品判据在用的那一批吗 ----
{
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
  const 缺 = 词.filter(w => SRC.indexOf(w) < 0);
  if (缺.length) {
    console.log('★★★ 尺子用的词里有 ' + 缺.length + ' 个在 js/render.js 里找不到：' + JSON.stringify(缺));
    console.log('    说明产品改过判据了，下面的读数是**旧尺子量新东西**，一条都别信。');
    process.exit(3);
  }
  console.log('尺子自检：' + 词.length + ' 个词产品判据里都有  ✓');
}

const SHOT = path.join(__dirname, '_shot');
const 文件 = fs.readdirSync(SHOT).filter(f => /^vf[A-Z]?-\d+\.txt$/.test(f));
if (!文件.length) { console.log('★ test/_shot 里没有 vf*.txt 存档，没得量。'); process.exit(3); }

// 按臂分：提示词里**有**这两行标签的（现版 / 加闸）和**没有**的（对照 / ★形态）
//   A = 现版 10    C = 现版 15    F = 加闸 15    G = 加闸 10
//   B = 对照 10    D = 对照 15    E = ★句子形态 15（那版**没有**【】标签）
const 有标签 = { A: 1, C: 1, F: 1, G: 1 };
const 没标签 = { B: 1, D: 1, E: 1 };

const 臂 = {};
for (const f of 文件) {
  const m = f.match(/^vf([A-Z]?)-\d+\.txt$/);
  const k = m[1] || '(最早那几个)';
  (臂[k] = 臂[k] || []).push(f);
}

let 总有抄的 = 0, 总漏 = 0;
console.log('');
for (const k of Object.keys(臂).sort()) {
  const 这一臂 = 臂[k];
  let 抄了 = 0, 漏了 = 0, 拦掉了 = 0;
  const 漏的例子 = [], 抄的例子 = [];
  for (const f of 这一臂) {
    const raw = fs.readFileSync(path.join(SHOT, f), 'utf8');
    let p;
    try { p = R.parseFences(raw, {}); } catch (e) { console.log('  ★ ' + f + ' 解析炸了：' + e.message); continue; }
    const vis = String(p.visible || '');
    // 原文里有没有这些词（模型**抄了没抄**）
    const 原 = 词.filter(w => raw.indexOf(w) >= 0);
    // 老师眼前那份里还有没有（**出口闸拦住了没**）
    const 眼 = 词.filter(w => vis.indexOf(w) >= 0);
    if (原.length) { 抄了++; if (抄的例子.length < 1) 抄的例子.push(f + ' → ' + JSON.stringify(原)); }
    if (眼.length) { 漏了++; if (漏的例子.length < 2) 漏的例子.push(f + ' → ' + JSON.stringify(眼)); }
    if (原.length && !眼.length) 拦掉了++;
  }
  总有抄的 += 抄了;
  总漏 += 漏了;
  const 该有标签 = !!有标签[k];
  console.log('  ── 臂 ' + k + '（' + 这一臂.length + ' 份' + (该有标签 ? '，提示词里**有**标签' : '，提示词里**没有**标签') + '）');
  console.log('     原文里抄了提示词的话的：' + 抄了 + '/' + 这一臂.length
    + '    其中被出口闸拦下的：' + 拦掉了
    + '    ★**漏到老师眼前的**：' + 漏了 + '/' + 这一臂.length);
  if (抄的例子.length) console.log('     抄的样子：' + 抄的例子[0]);
  if (漏的例子.length) console.log('     ★★ 漏网的样子：' + 漏的例子.join('  ／  '));
}

// ---- 报事实并存亡判定 ----
console.log('');
console.log('══════ 汇总 ══════');
const 对照臂 = Object.keys(没标签).filter(k => 臂[k]);
let 对照里有词的 = 0, 对照总数 = 0;
for (const k of 对照臂) for (const f of 臂[k]) {
  对照总数++;
  const raw = fs.readFileSync(path.join(SHOT, f), 'utf8');
  if (词.some(w => raw.indexOf(w) >= 0)) 对照里有词的++;
}
console.log('  A/C/F/G（提示词里有标签的存档）里，抄了提示词的：' + 总有抄的 + ' 份');
console.log('  这些存档**漏到老师眼前**的：' + 总漏 + ' 份   ← 出口那道闸管的就是这个');
console.log('  对照臂（B/D/E，提示词里没有标签）共 ' + 对照总数 + ' 份');
console.log('  其中也出现这些词的：' + 对照里有词的 + ' 份   ← 该是 0；不是 0 就说明这些词是模型自己会说的话');

if (总有抄的 === 0) {
  console.log('');
  console.log('★★ 尺子坏：存档里一份抄的都没有。那"0 份漏到眼前"什么都证明不了——');
  console.log('   不是闸有用，是**根本没有东西可拦**。别拿这个绿报账。');
  process.exit(3);
}
if (对照里有词的 > 0) {
  console.log('');
  console.log('★★ 判据立不住：对照臂（提示词里没这两行标签）也出现了这些词，');
  console.log('   说明它们不是"提示词的回声"，是模型本来就会说的话。规则四该收回。');
  process.exit(4);
}
if (总漏 > 0) { console.log('\n★★ 有漏网的，规则四没收干净。'); process.exit(1); }
console.log('\n===== 回放通过：' + 总有抄的 + ' 份抄了，0 份漏到老师眼前 =====');

// 「猜他想说」那三个按钮的最后一道关：抄了提示词示范的，作废。
//
// ★ 为什么值得单独一个文件：这道过滤器的输入是**模型现编的话**，判据又只能是启发式，
//   两头都是活的。它一旦失灵，学生点一下就等于替自己说了一句提示词里的话——
//   而那三句示范讲的是**另一道题**（比大小那题挂在解方程下面），点了就是当场说错话。
//   所以每种"抄法"都要在用例里钉死，包括**改几个字的抄**（实测最常见的就是这种）。
//
// 用法: node test/probe_chips.cjs     退出码 0=全过 1=有漏网的或误杀的
const path = require('path'), fs = require('fs');

const W = { SR: {} };
new Function('window', 'localStorage', 'navigator',
  'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', 'chips.js'), 'utf8'))(W, {}, { onLine: true });
const F = W.SR.filterCopiedChips;

// 每一条都写明为什么要它：
//   void  = 必须作废（抄了示范）
//   keep  = 必须留下（模型自己想的，或者本地兜底那几档）
const CASES = [
  // ---- 一字不差地抄 ----
  { name: '整句抄', lines: ['我看它们在数轴上谁靠左谁靠右', '我不确定，感觉差不多大', '我不会比，以前就随便写的'], void: true },
  // ---- 改几个字的抄（2026-10-01 DeepSeek 6 条里的真实原话，整句比对全漏）----
  { name: '★改字的抄：感觉差不多（少了"大"）', lines: ['我可能要在数轴上看看', '我不太确定，感觉差不多', '我不会比，以前就随便写的'], void: true },
  { name: '★改字的抄：我不会看', lines: ['我看它们在数轴上谁靠左谁靠右', '我不太确定，感觉差不多', '我不会看，以前就随便写的'], void: true },
  { name: '★改字的抄：三句全是改过的（只靠六字雷同抓）', lines: ['我想在数轴上看看它们的位置', '我拿不准，感觉 -2 更小', '我从来不会比这种数'], void: false, note: '这条本就抓不住，留着当"知道边界在哪"' },
  // ---- 该留下的 ----
  { name: '★反例：模型自己想的（这才是我们要的）', lines: ['我看负数就得在 0 左边', '我是按数轴的样子摆的', '我就凭感觉放的，没多想'], void: false },
  { name: '★反例：开头一样但没抄', lines: ['我不会比大小，老师说的方法我忘了'], void: false },
  { name: '★反例：本地兜底那几档', lines: ['我觉得中间有一步不太对', '我说完了，但心里没底', '我不知道问题出在哪一步'], void: false },
  { name: '★反例：短句（不够六字，不能一刀切）', lines: ['我算错了', '我卡住了'], void: false }
];

let bad = 0;
for (const c of CASES) {
  const out = F(c.lines);
  const gotVoid = out.length === 0;
  const ok = gotVoid === c.void;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.name + (c.note ? '（' + c.note + '）' : ''));
  if (!ok) {
    console.log('      期望 ' + (c.void ? '作废' : '留下') + '，实际 ' + (gotVoid ? '作废' : '留下 ' + out.length + ' 条：' + out.join(' | ')));
  }
}
console.log('\n===== 按钮过滤 ' + (CASES.length - bad) + '/' + CASES.length + ' 通过 =====');
// 上面那条"三句全是改过的"是已知抓不住的一条，标了 void:false —— 它是**边界**，
// 不是靠它拿分：它要是哪天被抓住了，这一格会红，提醒把这行注释一起改掉。
process.exit(bad ? 1 : 0);

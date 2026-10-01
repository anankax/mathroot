// 校验生成的提示词：node test/check_prompt.cjs
global.window = {};
require('../js/prompt-student.js');
require('../js/textbook.js');
const P = window.SR.PROMPT_STUDENT, T = window.SR.TEXTBOOK;

console.log('提示词字符数:', P.length, ' 行数:', P.split('\n').length);
console.log('教材索引字符数:', T.length);
console.log('--- 前 130 字 ---\n' + P.slice(0, 130));
console.log('--- 末 160 字 ---\n' + P.slice(-160));

const FENCE = '`'.repeat(3);
console.log('--- 关键点自检 ---');
const KEYS = ['# 你是谁', '你只会问，不给答案', '办法三', '#清空', '数轴', '坐标系',
              FENCE + 'ggb', FENCE + '想说', '# 开场白', '# 你手上拿到的东西',
              '名字里的"根"', '刨到根上'];
let bad = 0;
for (const k of KEYS) { const ok = P.includes(k); if (!ok) bad++; console.log((ok ? '  ok  ' : '  ✗   ') + k); }

console.log('--- 不该有的 ---');
for (const [name, cond] of [['残留「数小问」', P.includes('数小问')],
                            ['残留 codecogs 图片', /codecogs/i.test(P)],
                            ['残留 latex.codecogs', P.includes('latex.codecogs')]]) {
  if (cond) bad++;
  console.log((cond ? '  ✗   ' : '  ok  ') + name);
}

// 围栏必须成对
const nGgb = P.split(FENCE + 'ggb').length - 1;
const nXiang = P.split(FENCE + '想说').length - 1;
console.log('ggb 围栏出现', nGgb, '次; 想说围栏出现', nXiang, '次');
if (nGgb < 3 || nXiang < 2) { bad++; console.log('  ✗ 围栏太少，检查拼装'); }

console.log(bad ? '\n失败 ' + bad + ' 项' : '\n全部通过');
process.exit(bad ? 1 : 0);

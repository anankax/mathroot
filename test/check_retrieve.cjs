// 检索器自测：node test/check_retrieve.cjs
global.window = {};
require('../js/textbook.js');
require('../js/retrieve.js');
const SR = window.SR;

const idx = SR.retrieve.build(SR.TEXTBOOK);
console.log('切出条目数:', idx.N, '（教材索引里 ### 应恰好 118 条）');
console.log('平均每条二元组数:', Math.round(idx.avg));
console.log('文档频率表大小:', Object.keys(idx.df).length);

const CASES = [
  ['绝对值是什么', '2.3 绝对值与相反数'],
  ['去括号的符号老搞错', '3.3 整式的加减'],
  ['一元一次方程怎么解', '4.2 一元一次方程及其解法'],
  ['同底数幂相乘', '7.1 同底数幂的乘法'],
  ['三角形全等的判定', '全等'],
  ['点P在数轴上动，什么时候到原点', '2.2 数轴'],
  ['我记得有个公式是a的平方减b的平方', '乘法公式'],
];

let bad = 0;
for (const [q, want] of CASES) {
  const t0 = Date.now();
  const hits = SR.findTextbook(q, 3);
  const ms = Date.now() - t0;
  const titles = hits.map(h => h.doc.title);
  const ok = titles.some(t => t.includes(want) || t.includes(want.replace(/\s/g, '')));
  if (!ok) bad++;
  console.log(`\n${ok ? '  ok  ' : '  ✗   '} 「${q}」  (${ms}ms)`);
  titles.forEach((t, i) => console.log(`        ${i + 1}. [${hits[i].score.toFixed(1)}] ${t}`));
}

// 空查询与乱码不应崩
for (const q of ['', '   ', 'zzzzqqqq', '？？？']) {
  const r = SR.findTextbook(q, 3);
  if (!Array.isArray(r)) { bad++; console.log('  ✗ 带病查询返回非数组:', JSON.stringify(q)); }
}
console.log(bad ? `\n失败 ${bad} 项` : '\n全部通过');
process.exit(bad ? 1 : 0);

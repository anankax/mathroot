// reslib 那**两份共享文件**在 reslib/ 和 gate/ 两个目录里必须逐字节一样。
//
// ★ 2026-10-02 新写。为什么非要有一份脚本管这个：
//   这两份文件要同时活在两个地方，而且**没法共用**——云函数是按**目录**打包的，
//   `cloudfunctions/reslib/` 和 `cloudfunctions/gate/` 各打各的包，
//   跨目录 require 到了云上就是 MODULE_NOT_FOUND。所以只能是复制：
//
//     reslib/reslib-core.js     ←→  gate/reslib-core.js     打分那套
//     reslib/reslib-pg.js       ←→  gate/reslib-pg.js       读库那一半
//     reslib/reslib-retrieve.js ←→  gate/reslib-retrieve.js 取→算→拼成一整条路
//
//   （reslib/ 是原始：本机 test/_reslib_core_check.cjs 验的就是那一份。
//     gate/ 是逐字副本:线上跑的是那一份。）
//
//   复制就一定会漂。而且**漂了肉眼看不出来**：两份文件都躺在那里、都像是对的。
//   漂的后果还不小——
//     · 核漂了：本机验的是 A、线上跑的是 B，"逐位一致"那句验收就成了空话，
//       老师问一句、云上答一句，用的打分跟我在本机验的根本不是同一套；
//     · 读库那半段漂了：会**少取几行**。而"少取了行"跟"没命中"从外面看一模一样，
//       分不出、没人报、答案慢慢变差；
//     · 取→算→拼这条整路漂了：**调试台量出来的就不再是线上跑的**。
//       reslib/ 那份是拿来量成本、看缓存的仪表，它报的数字得是线上真会发生的那些——
//       两边各写一遍的结果就是仪表只会说好话。
//
// ★ 判据故意定**死**：逐字节一样，不是"看起来差不多"。
//   因为这些文件之间**没有任何该有差异的理由**（不掺平台差异、不掺路径差异、不掺版本号）。
//   只要有一位不一样，就说明有人手改了一份没改另一份。
//
// ---------------------------------------------------------------------------
// ⚠ 这份脚本只查「两份一不一样」，**不查「这份算得对不对」**。
//   「算得对不对」是本机拿真语料跑 test/_reslib_core_check.cjs（跟 js/retrieve.js 逐位比）。
//   两件事得分开问：把"产品对不对"焊进自检的后果是产品一退化，自检就喊"尺子坏了"，
//   把人指到错的方向去。
//
// 用法: node test/check_reslib_core.cjs
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rel = (d, f) => path.join(ROOT, 'cloudfunctions', d, f);

// 每一对：原始（reslib/，本机验过的那份）→ 副本（gate/，线上跑的那份）
const PAIRS = [
  { name: 'reslib-core.js     打分那套', A: rel('reslib', 'reslib-core.js'), B: rel('gate', 'reslib-core.js') },
  { name: 'reslib-pg.js       读库那半', A: rel('reslib', 'reslib-pg.js'), B: rel('gate', 'reslib-pg.js') },
  { name: 'reslib-retrieve.js 取→算→拼', A: rel('reslib', 'reslib-retrieve.js'), B: rel('gate', 'reslib-retrieve.js') }
];

// ============================================================
//  比法：逐字节
// ============================================================
// 返回 null 表示一样，否则返回"第一处不一样在第几字节"（从 0 数）。
// 用 Buffer 比，不做任何字符串归一化——归一化会把"CRLF vs LF"这种**真差异**抹掉，
// 而 Windows 上 git 的 autocrlf 恰好就爱干这件事。
function firstDiff(b1, b2) {
  const n = Math.min(b1.length, b2.length);
  for (let i = 0; i < n; i++) if (b1[i] !== b2[i]) return i;
  if (b1.length !== b2.length) return n;      // 一个只是另一个的前缀
  return null;
}

// 把第一处差异翻成"第几行第几个字"，好让人直接跳过去看
function where(bufA, bufB, off) {
  if (off === null) return '';
  const line = bufA.slice(0, Math.min(off, bufA.length)).toString('utf8').split('\n').length;
  return '（A 的第 ' + line + ' 行附近，字节 ' + off + '）';
}

// ============================================================
//  先验尺子自己：这份脚本**有没有能力**发现不一样？
// ============================================================
// ★ 这一节只问"我在不在工作"，一条都不问产品。
//   尤其是那条"两边对调"的坑：拿 A 跟 B 比，和拿 B 跟 A 比，结果当然一样——
//   那样的"验"是恒绿的，一片绿看着像通过，其实什么都没验。
//   所以这里必须造**真的不一样**出来给尺子认。
const selfBad = [];
{
  // 自检拿第一对的原始文件当"样本"。它只是**当尺子的试块**用，跟它内容对不对无关。
  const a = fs.readFileSync(PAIRS[0].A);

  // ① 自己跟自己：必须报"一样"（防"闭着眼喊不一样"）
  if (firstDiff(a, a) !== null) selfBad.push('自己跟自己比竟然报"不一样" —— 比法坏了');

  // ② 尾巴上多一个字节：必须报「不一样」，且报在第 a.length 位（防"闭着眼喊一样"）
  const longer = Buffer.concat([a, Buffer.from('x')]);
  if (firstDiff(a, longer) !== a.length) {
    selfBad.push('多一个字节没认出来（或认错了位置）—— 长度那一路坏了');
  }

  // ③ ★ 关键的一条：**同长度、只动中间一个字节**。
  //    只比长度的做法会在这里放过去。而"手抄漂了"最典型的正是这种——
  //    比如把 countIn 里的 `i + 1` 写成 `i + 2`，长度一个字节都不差。
  const mid = Buffer.from(a);
  const at = Math.floor(mid.length / 2);
  mid[at] = mid[at] ^ 0x01;
  if (firstDiff(a, mid) !== at) {
    selfBad.push('同长度、只动一个字节没认出来 —— 尺子只会在比长度，等于没比');
  }

  // ④ 中文那一带也得认（UTF-8 三个字节一个字，容易在按字符切的时候滑过去）
  const txt = '归一到二元组';
  const s1 = Buffer.from(txt, 'utf8'), s2 = Buffer.from('归一到三元组', 'utf8');
  if (s1.length !== s2.length) {
    selfBad.push('对照组自己造错了（两个字长度不一样，这组对照没意义）');
  } else if (firstDiff(s1, s2) === null) {
    selfBad.push('同长度的中文换了字没认出来');
  }
}

if (selfBad.length) {
  console.log('');
  console.log('★★★ 尺子自己坏了 —— 下面那条结论**一个字都别信**，先修 test/check_reslib_core.cjs：');
  selfBad.forEach(x => console.log('    · ' + x));
  process.exit(2);
}

// ============================================================
//  然后再比真东西
// ============================================================
// 先看文件在不在**全部**看一遍再报，别一半就退出——不然修完一个还有一个，来回跑。
const missing = [];
const seen = {};
for (const pr of PAIRS) for (const p of [pr.A, pr.B]) if (!seen[p] && !fs.existsSync(p)) { seen[p] = 1; missing.push(p); }
if (missing.length) {
  console.log('');
  console.log('★ 有文件不在，没法比：');
  missing.forEach(p => console.log('    · ' + path.relative(ROOT, p).replace(/\\/g, '/')));
  console.log('');
  console.log('  gate 那三份从哪来（照抄这几行）：');
  console.log('    cp cloudfunctions/reslib/reslib-core.js     cloudfunctions/gate/reslib-core.js');
  console.log('    cp cloudfunctions/reslib/reslib-pg.js       cloudfunctions/gate/reslib-pg.js');
  console.log('    cp cloudfunctions/reslib/reslib-retrieve.js cloudfunctions/gate/reslib-retrieve.js');
  process.exit(1);
}

const stamp = p => fs.statSync(p).mtime.toISOString().replace('T', ' ').slice(0, 19);
const line = (p, b) => '  ' + path.relative(ROOT, p).replace(/\\/g, '/').padEnd(40)
  + String(b.length).padStart(7) + ' 字节   ' + stamp(p);

const drifted = [];
console.log('');
for (const pr of PAIRS) {
  const bufA = fs.readFileSync(pr.A);
  const bufB = fs.readFileSync(pr.B);
  const off = firstDiff(bufA, bufB);

  console.log('  ── ' + pr.name + ' ──');
  console.log(line(pr.A, bufA));
  console.log(line(pr.B, bufB));
  if (off === null) {
    console.log('     ✓ 逐字节一样');
  } else {
    console.log('     ✗ 第一处不一样：原始的第 ' + off + ' 字节 ' + where(bufA, bufB, off));
    drifted.push({ pr: pr, off: off, bufA: bufA, bufB: bufB });
  }
  console.log('');
}

if (!drifted.length) {
  console.log('✓ 共享的那三份，两个目录里逐字节一样。线上跑的就是本机验过的那一份。');
  console.log('  ⚠ 这只说明"两份是同一份"，**不说明它们算得对**——');
  console.log('    算得对没对，走 test/_reslib_core_check.cjs（拿真语料跟 js/retrieve.js 逐位比）。');
  process.exit(0);
}

console.log('===== 有漂的（' + drifted.length + ' 对）=====');
const seg = (b, i) => b.slice(Math.max(0, i - 40), Math.max(0, i - 40) + 120).toString('utf8').replace(/\n/g, '\\n');
for (const d of drifted) {
  const file = path.basename(d.pr.A);
  console.log('');
  console.log('  ' + file + '：');
  console.log('    原始（reslib/）  …' + seg(d.bufA, d.off));
  console.log('    副本（gate/）    …' + seg(d.bufB, d.off));
}
console.log('');
console.log('★ 上面那段是**待判清单**，不是判决：得你自己看一眼是哪边对。');
console.log('  但是——**这些文件之间没有任何该有差异的理由**，所以正常情况是"哪边新听哪边"：');
console.log('    改的是 reslib/ 那份（原始） → 重新 cp 一份过去');
console.log('    改的是 gate/ 那份           → 那多半改错了地方，把改动搬回 reslib/ 那份');
console.log('');
console.log('  cp cloudfunctions/reslib/reslib-core.js     cloudfunctions/gate/reslib-core.js');
console.log('  cp cloudfunctions/reslib/reslib-pg.js       cloudfunctions/gate/reslib-pg.js');
console.log('  cp cloudfunctions/reslib/reslib-retrieve.js cloudfunctions/gate/reslib-retrieve.js');
process.exit(1);

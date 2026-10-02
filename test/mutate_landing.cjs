// 造几份"改坏了"的 landing.js，用来跑红验（见 probe_landing.cjs 顶上那段）。
// ★ 每一份只改**一处**，而且改的都是"那条探针声称守得住的那件事"。
//   全绿之后再跑它们，看红的**是不是那几条**——绿的意义全在这儿。
//
// ★★ 产物一律写在 test/_red/ 底下。为什么：这几份是 js/landing.js 的**整份副本**，
//   要是落在仓库里能被扫到的地方，就会随 GitHub Pages 变成公开可下的文件——
//   跟 js/textbook.js 那天是同一个形状（判据是"文件本身有没有发出去"，不是它放在哪个目录）。
//   .gitignore 里那条 `test/_*` 正好兜住它，所以别挪到别处去。
//
// 跑法：node test/mutate_landing.cjs
//       LANDING_FILE=test/_red/m_swallow.js node test/probe_landing.cjs
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '_red');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'landing.js'), 'utf8');

const MUTS = {
  // ① 咬得紧的时候不许问，随手挑头名 —— 探针 ② 的那条应该红
  never_ask: [
    "return { work: '', sure: 0, why: 'ambiguous', ranked: rank, score: top };",
    "return { work: rank[0], sure: 1, why: '话头', ranked: rank, score: top };"
  ],
  // ② 归得出来那趟不放行，把老师那句话吞掉 —— 探针 ⑤ 的那条应该红
  swallow: [
    "    strip(r.work, r.sure, r.why);\n    return false;",
    "    strip(r.work, r.sure, r.why);\n    return true;"
  ],
  // ③ 词表里就少一个词条（"命题"这两个字认不出来）—— 探针 ④ 的两条应该红
  no_mingti: ["['命题', 4], ['出题', 4],", ""],
  // ④ "换一件"不再把原话带过去 —— 探针 ⑥⑧ 里"同一句话重发"那两条应该红
  no_carry: ["var text = held || lastSent;", "var text = '';"]
};

fs.mkdirSync(OUT, { recursive: true });
let ok = 0;
for (const [name, [from, to]] of Object.entries(MUTS)) {
  if (SRC.indexOf(from) < 0) { console.log('✗ ' + name + '：找不着要改的那一句（改法过时了，得跟着 js/landing.js 更新）'); continue; }
  fs.writeFileSync(path.join(OUT, 'm_' + name + '.js'), SRC.replace(from, to));
  console.log('✓ ' + name + '  →  test/_red/m_' + name + '.js');
  ok++;
}
console.log('');
console.log(ok + '/' + Object.keys(MUTS).length + ' 份造好了。跑红验：');
console.log('  LANDING_FILE=test/_red/m_swallow.js node test/probe_landing.cjs');

// 漂移哨兵：**云上那一步的检索，跟本机这一份，是不是同一个答案。**
//
// 为什么需要它（而不是"部署完看一眼就算"):
//   云上那份 kb.js 是**生成物**（test/build_prompt.py 从 js/retrieve.js + 两份语料生成）。
//   生成物最容易出的坏法是**静静地旧下去**：改了 js/retrieve.js 忘了重跑生成器、
//   部署时漏了这一个文件、或者干脆发的是上一次的包。
//   这三种坏，从外面看都表现为"检索能跑，就是少召回两条/分数差一点"——
//   而分数差一点，正好是分数线（6 / 10）上下最容易翻盘的地方。
//   所以：**本机跑一遍、云上跑一遍、逐条比标题和分数。**
//
// ★ 它判的是"云上跟本机是不是同一份"，**不判"检索得准不准"**。
//   准不准是孔老师一个人在真实对话里才看得出来的事，脚本给不了也不该给。
//
// ★ 先跑红：这个脚本的比对机制是先跑红验过的——把一份**故意改过语料**的副本
//   起在 127.0.0.1:9000，用 GATE_URL 指过去，标题那几条必须报红
//   （当时红的正是"苏科版·七上 2.2 数轴（旧版）"和分数差 0.0172）。
//   看见它红过，才信它判得了绿。
//
// 跑法：node test/probe_kb_cloud.cjs
//       GATE_URL=http://127.0.0.1:9000/ node test/probe_kb_cloud.cjs   （对着本机起的那份跑）

const fs = require('fs');
const path = require('path');

const GATE = process.env.GATE_URL ||
  'https://kax1014-d1g5uttgka7757f39-1472214480.ap-shanghai.app.tcloudbase.com/gate';
const TOKEN = process.env.GATE_TOKEN || '736bff9a8e608b2adc';
const REF = 'https://anankax.github.io/';   // 云函数只认白名单来源；本机替身要另配 ALLOW_ORIGIN

const KB = path.join(__dirname, '..', 'cloudfunctions', 'gate', 'kb.js');
if (!fs.existsSync(KB)) {
  console.log('★ 本机没有 cloudfunctions/gate/kb.js —— 先跑 `python test/build_prompt.py` 生成它。');
  console.log('  （它是生成物、不在仓库里，见 .gitignore。没有它就没有比对基准。）');
  process.exit(2);
}
const K = require(KB);

// ---- 拿来问的话 ----
// 一半是学生真会说的话（含已记录在案的那句"我不会画数轴"），
// 一半从教材索引的标题里定距抽——标题是语料里的原文，最能压到索引的角上。
const STUDENT = [
  '我不会画数轴，-2 和 -3 谁大',
  '这道题我不会',
  '第二题',
  '为什么负负得正啊老师',
  '一元一次方程怎么移项',
  '我算出来 x=3 但代回去不对'
];
const titles = String(K.TEXTBOOK || '').split(/\n(?=###\s)/)
  .filter((p) => /^###\s/.test(p)).map((p) => p.split('\n')[0].replace(/^###\s*/, '').trim());
const SAMPLED = [];
for (let i = 0; i < titles.length; i += 20) SAMPLED.push(titles[i]);
const QUERIES = STUDENT.concat(SAMPLED);

// 分数线的两个数（跟 js/kb.js 顶上那段同源）。这里只用来说明"命中几条"这个决定，
// **分数线本身仍在浏览器里**——所以这里比的是"同样的分数会不会做出同样的取舍"。
const CUT = { textbook: 6, zhuawen: 10 };

let bad = 0, ran = 0;
function judge(what, cond, got) {
  ran++;
  if (cond) { console.log('  ✓ ' + what); return true; }
  bad++;
  console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got));
  return false;
}

async function ask(step, query, k) {
  const r = await fetch(GATE, {
    method: 'POST',
    cache: 'no-store',   // ★ 别吃同源缓存：那会把"没生效"验成"生效"（这坑踩过）
    headers: { 'Content-Type': 'application/json', Referer: REF, 'X-Gate-Token': TOKEN },
    body: JSON.stringify({ step: step, query: query, k: k })
  });
  return { status: r.status, j: await r.json().catch(() => null) };
}

function localHits(step, query, k) {
  const h = step === 'textbook' ? K.findTextbook(query, k) : K.findZhuawen(query, k);
  return (h || []).map((x) => ({ title: x.doc.title, score: x.score }));
}

(async () => {
  console.log('云上那份：' + GATE);
  console.log('本机基准：' + KB);
  console.log('');

  // ---------- ① 云上那份是不是"同一份语料" ----------
  console.log('① 云上那份语料的条数');
  const n = (s) => (String(s || '').match(/^###[ \t]/gm) || []).length;
  const mine = { textbook: n(K.TEXTBOOK), zhuawen: n(K.ZHUAWEN) };
  const g = await fetch(GATE, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  judge('云函数自报得出 kb 那几个字段', !!(g && g.kb), g && g.kb);
  judge('★ 语料装上了（ready）', !!(g && g.kb && g.kb.ready), g && g.kb && g.kb.why);
  judge('★ 条数跟本机一样', !!(g && g.kb && g.kb.entries &&
    g.kb.entries.textbook === mine.textbook && g.kb.entries.zhuawen === mine.zhuawen),
    { 云上: g && g.kb && g.kb.entries, 本机: mine });
  console.log('    （本机：教材 ' + mine.textbook + ' 条 / 追问 ' + mine.zhuawen + ' 条，共问 ' + QUERIES.length + ' 句话）');

  // ---------- ② 逐句比 ----------
  console.log('\n② 每一句：云上的标题和分数，跟本机一样吗');
  const WORST = [];
  let sameTitle = 0, sameScore = 0;
  for (const [step, k] of [['textbook', 2], ['zhuawen', 1]]) {
    for (const q of QUERIES) {
      const a = await ask(step, q, k);
      if (a.status !== 200 || !a.j || !a.j.ok) {
        bad++; ran++;
        console.log('  ✗ [' + step + '] ' + q + '  ← HTTP ' + a.status + ' ' + JSON.stringify(a.j && a.j.error));
        continue;
      }
      const mineH = localHits(step, q, k);
      const cloudH = (a.j.hits || []).map((h) => ({ title: h.title, score: h.score }));
      const d = mineH.length === cloudH.length;
      const t = d && mineH.every((h, i) => h.title === cloudH[i].title);
      const s = d && mineH.every((h, i) => Math.abs(h.score - cloudH[i].score) <= 1e-9 * Math.max(1, Math.abs(h.score)));
      if (t) sameTitle++;
      if (s) sameScore++;
      // 最后一条命中的分数离分数线有多近——差得越小，一点点分数漂移就越可能翻盘。
      // 这里只是**报数**，不是判分：离得近不等于坏，只是值得人扫一眼。
      const gap = mineH.length ? Math.abs(mineH[mineH.length - 1].score - CUT[step]) : 99;
      if (gap < 0.5) WORST.push({ step, q, 最近的命中分: mineH[mineH.length - 1].score, 线: CUT[step], 差: +gap.toFixed(4) });
      if (!t || !s) {
        ran++;
        bad++;
        console.log('  ✗ [' + step + '] ' + q);
        console.log('      本机：' + JSON.stringify(mineH.map((h) => h.title + ' @' + h.score.toFixed(4))));
        console.log('      云上：' + JSON.stringify(cloudH.map((h) => h.title + ' @' + h.score.toFixed(4))));
      }
    }
  }
  const total = QUERIES.length * 2;
  judge('★ 标题逐条一样（' + sameTitle + '/' + total + '）', sameTitle === total, { 一样: sameTitle, 共: total });
  judge('★ 分数逐条一样（' + sameScore + '/' + total + '）', sameScore === total, { 一样: sameScore, 共: total });

  // ---------- ③ 拿到的字段够不够浏览器做它那一步 ----------
  console.log('\n③ 浏览器那条路要用的东西齐不齐');
  const one = await ask('textbook', STUDENT[0], 2);
  judge('★ 带 via:"gate"', one.j && one.j.via === 'gate', one.j && one.j.via);
  judge('★ 带 ms（只有云函数会填）', one.j && typeof one.j.ms === 'number' && one.j.ms >= 0, one.j && one.j.ms);
  judge('★ 没有 model 字段（这一步不该调模型）', one.j && one.j.model === undefined, one.j && one.j.model);
  judge('hit 里有 title / score / text（浏览器要拿 text 拼进提示词）',
    !!(one.j && one.j.hits && one.j.hits[0] && one.j.hits[0].title && typeof one.j.hits[0].score === 'number' && one.j.hits[0].text),
    one.j && one.j.hits && one.j.hits[0] && Object.keys(one.j.hits[0]));

  // ---------- ④ 分数线附近有多少句（只是报数，不是判分）----------
  console.log('\n④ 分数线附近的句子（这些地方一点点分差就会翻盘，值得人扫一眼）');
  if (!WORST.length) console.log('    这一批里没有离分数线 0.5 以内的，翻盘风险低。');
  else WORST.forEach((w) => console.log('    [' + w.step + '] ' + w.q + '  最近命中 ' + w.最近的命中分.toFixed(4) + '，线 ' + w.线 + '，差 ' + w.差));

  console.log('');
  console.log('跑了 ' + ran + ' 条，红的 ' + bad + ' 条。');
  console.log('★ 这道哨兵只保证"云上跟本机是同一份"。**它保证不了"检索得对不对"**——');
  console.log('  那是你在真实对话里才看得出来的事（计划文件验收那节）。');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('探针自己挂了：' + ((e && e.message) || e)); process.exit(1); });

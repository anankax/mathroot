// 漂移哨兵：**云上 gate 那一步的资源库检索，跟本机这一份，是不是同一个答案。**
//
// 跟 probe_kb_cloud.cjs 是同一族，问的是同一件事，只是换了那一步：
//   probe_kb_cloud.cjs   问 gate 的 textbook / zhuawen 两步（语料**打在代码包里**）
//   probe_reslib_cloud.cjs ← 这里，问 gate 的 reslib 一步（语料**在 PG 里**）
//
// 为什么这一步也需要哨兵、而且更需要：
//   textbook 那份语料是**生成物**，生成物会静静地旧下去（生成器忘了跑）；
//   而 reslib 这份语料在**云端**，它走的是另一条容易坏的链——
//     本机 _chunks.jsonl  →（抽取/上传）→ PG 的 res_chunks →（分页取回）→ 云上核
//   这条链上任何一环漏了行、或哪次只上传了一半，**从外面看都是"检索能跑，就是少召回几条"**。
//   这正是项目吃过的那次亏（见 reslib-pg.js 顶上："少取了行"跟"没命中"长得一样）。
//   所以：**本机拿同一份语料跑一遍、云上跑一遍、逐条比标题和分数。**
//
// ★ 它判的是"云上跟本机是不是同一份"，**不判"检索得准不准"**。
//   准不准是孔老师在真实对话里才看得出来的事。
//
// ★ 它**绝不打印语料正文**。这不是顺手做的：回包里每条命中都带着 body，
//   而那是老师的教学材料。探针在解析出 JSON 的那一瞬间就把 body 删掉，
//   末尾还有一道"漏没漏"的自检（见 ④）。要改这个文件时别把 body 放回来。
//
// 跑法：node test/probe_reslib_cloud.cjs
//       GATE_URL=http://127.0.0.1:9000/gate node test/probe_reslib_cloud.cjs

const fs = require('fs');
const path = require('path');

const GATE = process.env.GATE_URL ||
  'https://kax1014-d1g5uttgka7757f39-1472214480.ap-shanghai.app.tcloudbase.com/gate';
const TOKEN = process.env.GATE_TOKEN || '736bff9a8e608b2adc';
const REF = 'https://anankax.github.io/';   // 云函数只认白名单来源

const core = require('../cloudfunctions/reslib/reslib-core.js');

const CHUNKS = path.join(__dirname, '_chunks.jsonl');
if (!fs.existsSync(CHUNKS)) {
  console.log('★ 本机没有 test/_chunks.jsonl —— 它就是推进 PG 的那份语料，没有它就没有比对基准。');
  process.exit(2);
}

// ===========================================================================
//  ★ 输出卫生：这个探针里所有要打印的字都得先过这道口子
// ===========================================================================
// 为什么值得专门设一道：回包里的 body 是老师的教学材料，不该因为跑一次验收
// 就跑到终端、跑到对话记录里去。做法是**在解析的那一瞬间删掉**（见 pickHits），
// 这里再加一道兜底——凡是打出去的字符串，都存一份下来，最后逐条查它**有没有
// 夹带语料原文**。人写代码总会有手滑的时候，手滑不该以"漏了他的材料"收场。
const SAID = [];
let LEAKED = null;
{
  const realLog = console.log.bind(console);
  console.log = function () {
    const line = Array.prototype.map.call(arguments, (a) =>
      (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    SAID.push(line);
    realLog(line);
  };
}

// 命中的每一条：只留元数据，**body 当场删掉**
function pickHits(hits) {
  return (hits || []).map(function (h) {
    return {
      id: h.id, doc: h.doc, shelf: h.shelf, page: h.page,
      title: h.title, score: h.score
      // ★ body 故意不取。别加回来。
    };
  });
}

async function ask(query, k) {
  const r = await fetch(GATE, {
    method: 'POST',
    cache: 'no-store',   // ★ 别吃同源缓存：那会把"没生效"验成"生效"（这坑踩过）
    headers: { 'Content-Type': 'application/json', Referer: REF, 'X-Gate-Token': TOKEN },
    body: JSON.stringify({ step: 'reslib', query: query, k: k })
  });
  const j = await r.json().catch(() => null);
  // ★ 解析完立刻把正文摘掉——后面任何一步都拿不到它了
  if (j && j.hits) j.hits = pickHits(j.hits);
  return { status: r.status, j: j };
}

// ===========================================================================
//  先验尺子自己：这份比对**有没有能力**发现不一样？
// ===========================================================================
// 这一节只问"我在不在工作"，一条都不问产品。
// 尤其是：**别写成"把两边对调再比一次"**——那样是恒绿的（等号两边互换结果一样），
// 一片绿看着像通过，其实什么都没验。要造**真的不一样**给它认。
const selfBad = [];
{
  const A = [{ id: 1, title: '甲', score: 20.51 }, { id: 2, title: '乙', score: 20.43 }];

  // ① 自己跟自己：必须报"一样"（防闭着眼喊不一样）
  if (!sameHits(A, A)) selfBad.push('自己跟自己比竟然报"不一样" —— 比法坏了');

  // ② 换个标题：必须报不一样
  const B = [{ id: 1, title: '甲', score: 20.51 }, { id: 2, title: '丙', score: 20.43 }];
  if (sameHits(A, B)) selfBad.push('换了标题没认出来');

  // ③ ★ 分数差 0.5：必须报不一样。
  //    这条是冲着"容差开太松"去的——把容差写成 1 之类的，分数怎么漂都报绿，
  //    而"分数漂了"恰恰是换语料/换检索器最先露出来的地方。
  const C = [{ id: 1, title: '甲', score: 20.51 }, { id: 2, title: '乙', score: 20.93 }];
  if (sameHits(A, C)) selfBad.push('分数差了 0.5 没认出来 —— 容差开太松，等于没比');

  // ④ ★ 只差 0.01（比两位小数的修约还小）：**必须报不一样**。
  //    这条更狠：它保证的不是"看得见大差"，而是"看得见最小的那一档差"。
  //    云上回包是修约到两位小数的，所以能看见的最小差就是 0.01——
  //    如果连 0.01 都放过，那"逐条比分数"这句验收就是空话。
  const D = [{ id: 1, title: '甲', score: 20.51 }, { id: 2, title: '乙', score: 20.44 }];
  if (sameHits(A, D)) selfBad.push('分数差 0.01 没认出来 —— 修约后能看见的最小差都放过，比分数这事等于没做');

  // ⑤ 少一条 / 多一条：条数不一样也算不一样（防"只比前几条"）
  if (sameHits(A, A.slice(0, 1))) selfBad.push('少了一条没认出来');
}

if (selfBad.length) {
  console.log('');
  console.log('★★★ 尺子自己坏了 —— 下面那条结论**一个字都别信**，先修 test/probe_reslib_cloud.cjs：');
  selfBad.forEach((x) => console.log('    · ' + x));
  process.exit(2);
}

// 两条命中列表算不算"一样"：条数、标题、分数（修约到两位小数，容差取半个单位）
function sameHits(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].title !== b[i].title) return false;
    if (Math.abs(a[i].score - b[i].score) > 0.005) return false;   // 云上修约到两位小数
  }
  return true;
}

// ===========================================================================
//  本机那一份：拿**同一个核**、**同一份语料**跑出来
// ===========================================================================
// 语料直接读 _chunks.jsonl（推 PG 的就是它），核直接 require reslib-core.js。
// 这样"本机"这一侧不含任何云上的东西，两边才是独立量出来的。
const docs = fs.readFileSync(CHUNKS, 'utf8')
  .split('\n').filter(Boolean).map(function (l) {
    const c = JSON.parse(l);
    return { id: c.id, doc: c.doc, shelf: c.shelf, page: c.page, title: c.title, body: c.body };
  });

const QUERIES = [
  '有理数的乘方怎么讲',
  '绝对值与相反数这一节的重点是什么',
  '学生解一元一次方程容易错在哪',
  '平方差公式',
  '学生把 -(-3) 写成 -3 是什么原因'
];
const K = 3;

(async () => {
  console.log('云上那份：' + GATE);
  console.log('本机基准：' + CHUNKS + '（' + docs.length + ' 块）');
  console.log('');

  console.log('  ── 本机建索引 ──');
  let t0 = Date.now();
  const idx = core.makeIndex(docs);
  const buildMs = Date.now() - t0;
  console.log('  用时 ' + buildMs + 'ms，N=' + idx.N + '，平均长度 ' + Math.round(idx.avg) + '\n');

  let bad = 0, ran = 0;
  function judge(what, cond, got) {
    ran++;
    if (cond) { console.log('  ✓ ' + what); return true; }
    bad++;
    console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got));
    return false;
  }

  // ---------- ① 云上 /health 里的 reslib 那块 ----------
  console.log('① 云上那份装上没有');
  const g = await fetch(GATE + '/health', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  judge('★ 答话的是新代码（version === gate-3）', !!(g && g.version === 'gate-3'), g && g.version);
  judge('★ reslib 那一步装上了（ready）', !!(g && g.reslib && g.reslib.ready), g && g.reslib && g.reslib.why);
  // ⚠ 别拿 g.steps 去查 reslib 在不在：那个字段是**调模型**的那几步（topic/routes/step/wrap），
  //   检索这几步本来就不在里面，查了必得 false——一个"量错了东西"的假红。
  //   检索那几步各报各的：给模型看的在 g.kb.steps，资源库这条在 g.reslib（上面那条 judge）。
  console.log('    调模型那几步：' + JSON.stringify(g && g.steps));
  console.log('    给模型的两步：' + JSON.stringify(g && g.kb && g.kb.steps));
  console.log('');

  // ---------- ② 逐句比 ----------
  console.log('② 每一句：云上的标题和分数，跟本机一样吗');
  let sameTitleN = 0, sameScoreN = 0, sameAllN = 0;
  for (const q of QUERIES) {
    const mine = core.search(idx, q, K);
    const mineH = mine.hits.map(function (h) {
      const r = docs[h.i];
      return { title: r.title, score: Math.round(h.score * 100) / 100 };
    });

    const a = await ask(q, K);
    if (a.status !== 200 || !a.j || !a.j.ok) {
      bad++; ran++;
      console.log('  ✗ ' + q + '  ← HTTP ' + a.status + ' ' + JSON.stringify(a.j && (a.j.error || a.j.why)));
      continue;
    }
    // ★ 挂了跟没命中要分得开：云上挂了会带 why，命中列表为空
    if (a.j.why) { bad++; ran++; console.log('  ✗ ' + q + '  ← 云上说：' + a.j.why); continue; }

    const cloudH = a.j.hits;

    const t = mineH.length === cloudH.length &&
      mineH.every((h, i) => h.title === cloudH[i].title);
    const s = mineH.length === cloudH.length &&
      mineH.every((h, i) => Math.abs(h.score - cloudH[i].score) <= 0.005);
    if (t) sameTitleN++;
    if (s) sameScoreN++;
    if (sameHits(mineH, cloudH)) sameAllN++;

    // 逐条都打印（就 3 条），让人眼睛也能扫一遍；分数差单独标出来
    const fmt = (arr) => arr.map((h) => h.score.toFixed(2) + ' ' + h.title).join('\n        ');
    if (t && s) {
      console.log('  ✓ ' + q);
      console.log('        ' + fmt(cloudH));
    } else {
      bad++; ran++;
      console.log('  ✗ ' + q);
      console.log('      本机：\n        ' + fmt(mineH));
      console.log('      云上：\n        ' + fmt(cloudH));
    }
    // 账目：取语料跟打分分开报（冷实例慢是"取"慢，不是"打分"慢）
    console.log('        [云上] rows=' + a.j.rows + ' pages=' + a.j.pages + ' scored=' + a.j.scored
      + ' ms=' + a.j.ms + '（取语料 ' + a.j.corpus_ms + (a.j.corpus_cached ? ' 缓存命中' : ' 冷的')
      + '，打分 ' + a.j.score_ms + '）grams=' + a.j.grams);
  }
  console.log('');
  judge('★ 标题逐条一样（' + sameTitleN + '/' + QUERIES.length + '）', sameTitleN === QUERIES.length,
    { 一样: sameTitleN, 共: QUERIES.length });
  judge('★ 分数逐条一样（' + sameScoreN + '/' + QUERIES.length + '）', sameScoreN === QUERIES.length,
    { 一样: sameScoreN, 共: QUERIES.length });

  // ---------- ③ 缓存那笔账（只报数，不判分）----------
  console.log('\n③ 缓存那笔账');
  const c = await fetch(GATE + '/health', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  const cc = c && c.reslib && c.reslib.cache;
  console.log('    ' + JSON.stringify(cc));
  console.log('    （冷的那一下取语料要几秒；热的那一下 0.1s 上下。上面每句的 ms 里那两笔是分开报的。）');

  // ---------- ④ 漏没漏正文 ----------
  // ★ 这一条查的是**探针自己**：它有没有把老师的语料原文打出去。
  //   凡是打出去的每一行都存着（见开头 SAID），这里拿真语料去撞。
  console.log('\n④ 探针自己漏没漏正文');
  // ★ 判据要留个心眼：有些块的 body 开头就是标题，而**标题本来就要打印**。
  //   不排掉这种，探针会为自己的正常输出喊"漏了"——狼来了喊多了，
  //   真漏的那天也没人信了。所以只拿"不会出现在标题里"的正文片去撞。
  const titleBlob = docs.map((d) => String(d.title || '')).join('\n');
  const needles = docs.slice(0, 1200)
    .map((d) => String(d.body || '').slice(0, 24))
    .filter((x) => x.length >= 24 && titleBlob.indexOf(x) < 0);
  console.log('    取 ' + needles.length + ' 段正文片去撞（已排掉"本身就是标题"的那些）');
  if (!needles.length) {
    judge('★ 对照组非空（有能撞的东西可撞）', false, '一段都没取到，这条"没漏"等于没验');
  } else {
    for (const line of SAID) {
      for (const nd of needles) if (line.indexOf(nd) >= 0) { LEAKED = nd; break; }
      if (LEAKED) break;
    }
    judge('★ 输出里没有夹带任何一句语料原文', LEAKED === null,
      LEAKED === null ? null : '撞上了某一块的正文（具体那句已隐去不打印）');
    if (LEAKED) console.log('    （去 SAID 里找是哪一行打出来的；那句话本身故意不在这里显示）');
  }

  console.log('');
  console.log('跑了 ' + ran + ' 条，红的 ' + bad + ' 条。');
  console.log('★ 这道哨兵只保证"云上跟本机是同一份"。**它保证不了"检索得对不对"**——');
  console.log('  那是孔老师在真实对话里才看得出来的事。');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('探针自己挂了：' + ((e && e.message) || e)); process.exit(1); });

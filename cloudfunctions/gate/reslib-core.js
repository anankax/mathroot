// reslib 的**检索核**——纯函数，不碰网络、不碰 PG、不碰云。
// 放在单独一个文件，是为了能在本机拿真语料逐位验它（test/_reslib_core_check.cjs）。
//
// ---------------------------------------------------------------------------
// 它跟 js/retrieve.js 的关系：**同一套打分，换了算法**
// ---------------------------------------------------------------------------
// js/retrieve.js 是网页端那份。它是"把每块的正文摊成一个二元组**数组**再数"，
// 7706 块就是 540 万个字符串——本机花 324ms，云上 0.2 vCPU 要 3.4 秒，
// 而且每个实例每次请求都重来一遍。
//
// 这一份换了个做法：**不建数组，只数**。
//   · 长度：二元组个数 = 去标点去空格后的字数 - 1（`gramLen`），不用扫
//   · 词频：某个二元组出现了几次 = 它在串里出现了几次（`countIn`，重叠也算）
// 数出来的东西跟"摊成数组再数"**一模一样**——包括重叠那部分
// （"2.2.2" 归一化成 "222"，二元组 "22" 在数组里出现 **2** 次，countIn 也是 2）。
// 这不是"差不多"，是恒等，验收线是逐位一致（见 test/_reslib_core_check.cjs）。
//
// ★ 另外把**不随问题变**的那几样（归一化正文、长度、平均长度）缓存起来：
//   它们只跟语料有关，一个实例算一次就够。问题一变就重算的，只剩"数那 24 个二元组"。
//
// ★ 打分公式一个字没动：K1/B、idf、以及 **IDF 用全集的 N 和 df**（那一条是上一轮
//   修回来的，见 index.js 顶上那段诊断——别再改回"候选集里算 IDF"）。

const K1 = 1.2, B = 0.75;

// 归一化：小写 → 去空白 → 去标点。跟 js/retrieve.js 的 bigrams 前半段**逐字一样**。
function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s　]+/g, '')
    .replace(/[，。、；：？！“”‘’（）《》〈〉【】—…·,.;:?!"'()\[\]<>_/\\|~`@#$%^&*+=]/g, '');
}

// 二元组的**个数**，不建数组。等价于 bigrams(s).length：
//   0 字 → []  → 0
//   1 字 → [s] → 1（js/retrieve.js 里那个特例）
//   n 字 → n-1
function gramLen(n) {
  if (n.length === 0) return 0;
  if (n.length === 1) return 1;
  return n.length - 1;
}

// 二元组 g 在归一化串 n 里出现几次。**重叠也算**，跟逐位 substr 一样。
function countIn(n, g) {
  if (g.length === 1) return (n.length === 1 && n === g) ? 1 : 0;
  let c = 0, i = n.indexOf(g);
  while (i >= 0) { c++; i = n.indexOf(g, i + 1); }
  return c;
}

// 问题拆成二元组（去重、保序）。跟 bigrams() 同一套输出。
function queryGrams(q) {
  const n = norm(q), gs = [];
  if (n.length === 1) gs.push(n);
  else for (let i = 0; i < n.length - 1; i++) gs.push(n.substr(i, 2));
  const seen = {}, out = [];
  for (let j = 0; j < gs.length; j++) if (!seen[gs[j]]) { seen[gs[j]] = 1; out.push(gs[j]); }
  return out;
}

// ---------------------------------------------------------------------------
// 建索引：只留**不随问题变**的东西
// ---------------------------------------------------------------------------
// docs: [{ title, body }]。返回的对象可以长期留在模块作用域里复用。
function makeIndex(docs) {
  const N = docs.length;
  const nbody = new Array(N), ntitle = new Array(N), len = new Array(N);
  let avg = 0;
  for (let d = 0; d < N; d++) {
    const nb = norm(docs[d].body), nt = norm(docs[d].title);
    nbody[d] = nb; ntitle[d] = nt;
    // 口径跟 build() 一致：正文一遍 + 标题两遍
    const L = gramLen(nb) + gramLen(nt) * 2;
    len[d] = L; avg += L;
  }
  avg = N ? avg / N : 1;
  return { N: N, nbody: nbody, ntitle: ntitle, len: len, avg: avg };
}

// ---------------------------------------------------------------------------
// 查一次
// ---------------------------------------------------------------------------
// 返回 { grams, df, scored, hits }。hits 里的 i 是**在 docs 里的下标**，
// 调用方拿它去取真实那一行（正文不在这里，省内存）。
function search(idx, query, k) {
  const grams = queryGrams(query);
  if (!grams.length) return { grams: [], scored: 0, hits: [], why: '这个问题里没有可检索的字' };

  const G = grams.length, N = idx.N;
  const nbody = idx.nbody, ntitle = idx.ntitle, len = idx.len, avg = idx.avg;

  // ── 一趟扫过全库：同时数出 df（给 IDF 用）和每块命中哪几组（给打分用）──
  // ★ df 必须是**全集**的：N 和"有几块含这个组"都从这趟里来。
  //   上一版把它算在"筛出来的候选集"里，稀有词被拉平、常见词被抬高，排序翻了——
  //   那一条的完整诊断在 index.js 顶上，别改回去。
  const df = new Array(G).fill(0);
  const hitsPerDoc = new Array(N);          // 每块：[组号, 次数, 组号, 次数, …]，只放非零的
  for (let d = 0; d < N; d++) {
    const nb = nbody[d], nt = ntitle[d];
    let list = null;
    for (let g = 0; g < G; g++) {
      const gm = grams[g];
      const c = countIn(nb, gm) + countIn(nt, gm) * 2;   // 标题算两遍
      if (!c) continue;
      df[g]++;
      if (!list) list = [];
      list.push(g, c);
    }
    if (list) hitsPerDoc[d] = list;
  }

  // ── IDF：N 和 df 都是全集的 ──
  const idf = new Array(G);
  for (let g = 0; g < G; g++) {
    const n = df[g];
    idf[g] = n ? Math.log(1 + (N - n + 0.5) / (n + 0.5)) : 0;
  }

  // ── 打分 ──
  const scored = [];
  for (let d = 0; d < N; d++) {
    const list = hitsPerDoc[d];
    if (!list) continue;                       // 一组都不沾，必然 0 分
    let s = 0;
    for (let p = 0; p < list.length; p += 2) {
      const w = idf[list[p]];
      if (!w) continue;
      const f = list[p + 1];
      s += w * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (len[d] / avg)));
    }
    if (s > 0) scored.push({ i: d, score: s });
  }
  scored.sort((x, y) => y.score - x.score);

  return { grams: grams, df: df, scored: scored.length, hits: scored.slice(0, k || 3) };
}

module.exports = { K1, B, norm, gramLen, countIn, queryGrams, makeIndex, search };

// reslib 的**第三步**：把「一个问题」变成「几条结果」。
//
// 这一份也是**两份**（reslib/ 和 gate/ 各一份，逐字节一样，哨兵 test/check_reslib_core.cjs）。
// 为什么要独立成第三个文件、而不是两边各写各的——理由跟那两份不一样，值得写清楚：
//
//   reslib/ 那份是**调试台**（量成本、看缓存、验分数、数行数，都能独立跑，不惊动线上）；
//   gate/ 那份是**老师真走的那条路**。
//   如果两边各写一遍"取语料 → 打分 → 挑出那几条 → 拼成回给浏览器的形状"，
//   那么**调试台量出来的东西就不是线上跑的东西**——它就成了一个只会说好话的仪表。
//   现在两边都调下面这一个 retrieve()：
//     "云上 == 本机"（跟 js/retrieve.js 逐位比）**和**"调试台 == 线上"一起按构造成立。
//
//   同族的那次教训写在 reslib-pg.js 顶上：**"少取了行"跟"没命中"从外面看一模一样**。
//   那份文件治的是"取"，这份治的是"取回来之后怎么变成回给浏览器的样子"。
//
// ⚠ 三份的分工，别串：
//     reslib-core.js     怎么算分   —— 纯函数，不碰网络/数据库，本机拿真语料逐位验过
//     reslib-pg.js       怎么把库**完整**取回来 —— 分页 / 缓存 / 平台临时凭证
//     reslib-retrieve.js ← 这里，把两者接起来，外加**定下回给浏览器的形状**
//
// ★ 回给浏览器的形状定在这儿（id/doc/shelf/page/title/score/body），因为前端那条分数线、
//   那两段附注都按这个形状读。改形状只该有一个地方——就是这里。

const core = require('./reslib-core.js');
const PG = require('./reslib-pg.js');

async function retrieve(query, k) {
  const t0 = Date.now();
  const c = await PG.corpus();

  const t1 = Date.now();
  const out = core.search(c.idx, query, k);
  const scoreMs = Date.now() - t1;

  const hits = out.hits.map(function (h) {
    const r = c.rows[h.i];
    return {
      id: r.id, doc: r.doc, shelf: r.shelf, page: r.page,
      title: r.title,
      // ★ 这里是**两位小数**，不是"原样返回"。别照 gate 里 runKb 那条"分数不四舍五入"
      //   去改它：那条说的是**探针拿容差比分数**时的口径，改的是"分数本身说不说得准"。
      //   这里修约的只是**发给浏览器的那一个数**，而真正的走样（换了语料、改了检索器）
      //   在两位小数上一样藏不住——它动的是一整个单位，不是小数点后第三位。
      //   真正要求逐位一致的地方是本机 test/_reslib_core_check.cjs，它比的是**没修约的**double。
      score: Math.round(h.score * 100) / 100,
      body: r.body
    };
  });

  return {
    ok: true,
    q: query,
    grams: out.grams.length,
    rows: c.idx.N,
    pages: c.pages,
    scored: out.scored,
    // ★ 账目分开报：取语料那一下（只在一个实例的头一次发生）跟打分分开，
    //   不然"冷实例慢"会被误读成"检索慢"——实测这两笔差 60 倍（6.3s vs 0.1s）。
    corpus_ms: c.load_ms,
    corpus_cached: c.hits > 0,
    cache_hits: c.hits,
    score_ms: scoreMs,
    ms: Date.now() - t0,
    hits: hits
  };
}

module.exports = { retrieve: retrieve };

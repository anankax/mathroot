// reslib —— 数根的「资源库检索」**调试台**。
//
// 职责只有一件：**吃一个问题，从 PG 的 res_chunks 里捞最相关的几块还回去。**
// 它不认识模型、不认识浏览器、不生成提示词——那些还是 gate 的活。
//
// ★★ 2026-10-02：线上那条路**不在这个函数里，在 gate 里**。
//   实测（见 cloudfunctions/README.md）：HTTP 云函数的运行时**也有**平台注入的临时凭证，
//   所以 gate 能自己读 PG，一把自建钥匙、一个新环境变量都不用加。
//   而 gate 是网站唯一的门房，检索搭在它那几步"只检索不调模型"的步上最省事。
//   这个函数留着当**调试台**：探形状、量成本、数行数、看缓存，都能独立跑，不惊动线上。
//
//   ★ 两边共用同样两份文件，所以"云上 == 本机"是**按构造成立**的：
//       reslib-core.js   打分那套（纯函数，本机拿真语料逐位验过）
//       reslib-pg.js     读库那一半（分页 / 缓存 / 临时凭证）
//     两份在 reslib/ 和 gate/ 各有一份**逐字节一样**的副本，哨兵 test/check_reslib_core.cjs。
//     （云函数按目录打包，跨不了目录，所以只能复制不能共用。）
//
// ---------------------------------------------------------------------------
// 为什么它是**事件函数**，不是 HTTP 函数
// ---------------------------------------------------------------------------
// 事件函数是"平台临时凭证读库"这条路的本家。gate 非走 HTTP 不可（浏览器要跨域直调它），
// 它那条路是实测能走通的，但要配一份降级——见 cloudfunctions/README.md。
// 调试台没这个必要，用最家什的那条。
//
// ---------------------------------------------------------------------------
// ★ 为什么不"先筛 500 个候选再打分"（这条是实测踩出来的，别再改回去）
// ---------------------------------------------------------------------------
// 第一版为了省内存，先用 SQL LIKE 筛出「跟问题共享 ≥1 个二元组」的前 500 个候选，
// 只对候选建索引、打分。结果检索质量**掉得很难看**：
//   "有理数的乘方怎么讲" → 排在头里的是「八上第2章小结与思考」（通篇讲有理数的综述块），
//   真正讲乘方的「专题2.6 有理数的乘方」掉到第 12。
// 本机把嫌疑犯钉死了（test/_prefilter_diag.cjs）：**对的块三次都在候选里**，
// 按"命中数"分别排第 91 / 1 / 1 位——不是被筛掉的，是**打分把它翻掉的**。
//
// 根因一句话：**IDF 是在候选集里算的，不是在全集里算的。**
//   idf = log(1 + (N - n + 0.5)/(n + 0.5))
//   N 从 7706 变成 500，且 df 是在"被抽样过的候选集"里数的，
//   于是稀有词（乘方）的权重被拉平、常见词（有理/数的/怎么）的相对权重被抬高，
//   综述块就压过了真正对症的那一节。这不是调参能救的，是统计量用错了地方。
//
// 治法（test/_prefilter_diag2.cjs 验过，**逐位完全一致**）：
//   ① **不筛**，整表取回来；df / 平均长度 / N 全是全集的，IDF 天然正确
//   ② 每块只留"问题里那几个二元组"的 tf，外加一个长度——**不留完整 tf 表**
//   内存就是这么回来的：347MB → 几 MB（347MB 是完整 tf 表吃的，不是正文）
//
// ★ 库再大下去（几万块以上）该做的是 **bigram → 文档号 的倒排表**，
//   那时候才需要重新引入候选筛选——但那时也必须配一张全库统计量表来算 IDF。
//   现在 7706 块的规模，全取回来是**又准又简单**的那条路。

const core = require('./reslib-core.js');
const PG = require('./reslib-pg.js');
// ★ 「取语料 → 打分 → 拼成回给浏览器的形状」这一步在 reslib-retrieve.js 里，
//   **线上那条路（gate）调的是同一份**——所以这个调试台量出来的就是线上跑的。
//   为什么非共享不可，那份文件的头上有整段。
const ASK = require('./reslib-retrieve.js');
const retrieve = ASK.retrieve;

// ===========================================================================
//  入口。两种进法都认：
//   ① 网关 HTTP 访问 → 事件是 API 网关那个代理形状，回 {statusCode, headers, body}
//   ② 直接调函数（我调试用）→ 事件就是我传的那个对象，回对象本身
// ===========================================================================
function ok(bodyObj, isHttp) {
  if (!isHttp) return bodyObj;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(bodyObj)
  };
}

function fail(status, msg, isHttp) {
  if (!isHttp) return { ok: false, error: msg };
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: false, error: msg })
  };
}

exports.main = async function (event, context) {
  event = event || {};
  const isHttp = !!(event.httpMethod || event.requestContext || event.headers);

  try {
    let input = event;

    if (isHttp) {
      // 拦一道：只认带着对的口令来的。口令在环境变量 RESLIB_KEY 里，
      // **不在代码里**——代码要进仓库，环境变量不进。
      // ★ 这条路现在**没在用**（线上走 gate）；留着是万一以后要把调试台也开出去，
      //   先把它做得不能裸奔。没配就 503，绝不敞开。
      const want = String(process.env.RESLIB_KEY || '').trim();
      if (!want) return fail(503, 'reslib 调试台没开 HTTP 口（环境变量缺 RESLIB_KEY）', true);
      const got = String((event.headers && (event.headers['x-reslib-key'] || event.headers['X-Reslib-Key'])) || '');
      if (got !== want) return fail(401, '口令不对', true);

      let raw = event.body;
      if (event.isBase64Encoded && raw) raw = Buffer.from(raw, 'base64').toString('utf8');
      try { input = raw ? JSON.parse(raw) : {}; }
      catch (e) { return fail(400, '请求体不是 JSON', true); }
    }

    // 诊断模式：把 executePGSql 回来的**形状**摊开看一眼（不返回任何语料）
    if (input.probe) {
      const res = await PG.mgr().database.executePGSql({
        Sql: "SELECT 1 AS n, '二' AS s UNION ALL SELECT 2 AS n, '三' AS s"
      });
      return ok({
        ok: true,
        probe: {
          top_keys: Object.keys(res || {}),
          columns: res && res.Columns,
          rows_type: res && Object.prototype.toString.call(res && res.Rows),
          rows_len: res && res.Rows && res.Rows.length,
          rows_is_array: Array.isArray(res && res.Rows),
          first_row_type: res && res.Rows && typeof res.Rows[0],
          first_row_raw: res && res.Rows && String(res.Rows[0]).slice(0, 120)
        },
        parsed: PG.rowsToObjects(res || {})
      }, isHttp);
    }

    // 整表取回够不够快、吃多少内存——只报数，不返回正文
    if (input.weigh) {
      const t0 = Date.now();
      const got = await PG.allRows();
      let chars = 0;
      for (let i = 0; i < got.rows.length; i++) {
        chars += (got.rows[i].body || '').length + (got.rows[i].title || '').length;
      }
      const tb = Date.now();
      const idx = core.makeIndex(got.rows.map(PG.normRow));
      const buildMs = Date.now() - tb;
      const mu = process.memoryUsage();
      return ok({
        ok: true,
        weigh: {
          rows: got.rows.length,
          pages: got.pages,
          per_page: got.per_page,
          fetch_ms: got.fetch_ms,
          index_ms: buildMs,
          total_ms: Date.now() - t0,
          total_chars: chars,
          avg_len: Math.round(idx.avg),
          rss_mb: Math.round(mu.rss / 1048576),
          heap_mb: Math.round(mu.heapUsed / 1048576)
        }
      }, isHttp);
    }

    if (input.count) {
      const c = await PG.pg('SELECT count(*)::int AS n FROM public.res_chunks');
      return ok({ ok: true, count: parseInt((c[0] || {}).n, 10) }, isHttp);
    }

    // 缓存状态：老实例还热着吗、语料是哪一版、上回读库为什么失败
    if (input.cache) return ok({ ok: true, cache: PG.cacheInfo() }, isHttp);

    const q = String(input.query || input.q || '').trim();
    if (!q) return fail(400, '没给 query', isHttp);
    const k = Math.min(8, Math.max(1, parseInt(input.k, 10) || 3));

    const out = await retrieve(q, k);
    // 诊断用：bodies:false 时把正文字段摘掉，便于把结果贴出来看
    if (input.bodies === false) {
      out.hits = out.hits.map(function (h) {
        const o = {};
        for (const kk in h) if (kk !== 'body') o[kk] = h[kk];
        return o;
      });
    }
    return ok(out, isHttp);

  } catch (e) {
    PG.noteErr(e);
    // ★ 只回消息，**绝不回 event / context / process.env**：网关会往请求里塞
    //   x-cloudbase-context（临时凭证），吐出来等于把钥匙递给调用方。
    return fail(500, String((e && e.message) || e).slice(0, 300), isHttp);
  }
};

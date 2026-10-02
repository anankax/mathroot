// reslib 的**读库那一半**——把 res_chunks 整表取回来，缓存住。
// 跟 reslib-core.js 一样，这份也是**两份**（reslib/ 和 gate/ 各一份，逐字节一样，
// 哨兵是 test/check_reslib_core.cjs）。原因同：云函数按目录打包，跨不了目录。
//
// ---------------------------------------------------------------------------
// ★ 为什么这半段也非共享不可（而不是各写各的）
// ---------------------------------------------------------------------------
// 它里面有几条**决定数字对不对**的东西：
//   · 分页必须 `ORDER BY id`——不带排序的 LIMIT/OFFSET 会**漏行、会重复**
//   · 每页 3000 行——卡在"单次回包 10MB"那个硬顶下面
//   · 取到安全阀就**抛错**，不许悄悄降级
// 这几条任意一条在 gate 那份里漂了，后果是"少取了几百块"。
// 而**"少取了行"跟"没命中"从外面看一模一样**——分不出、没人报、答案慢慢变差。
// 这正是这个项目栽过好几次的那一类，所以不抄第二遍，抽出来共享。
//
// ⚠ 它**不碰打分**。打分在 reslib-core.js，那才是"云上必须等于本机"的正主。
//   这份只管"把哪几个字喂给它"。

const ENV_ID = 'kax1014-d1g5uttgka7757f39';

// 整表取回的安全阀。到这儿说明该上倒排表了，宁可**报错**也别悄悄降级——
// 悄悄降级就正是上面说的那个坑。
const HARD_MAX = 60000;

// ★ executePGSql **单次回包硬顶 10MB**（实测报错原文：
//   "result set exceeds the 10 MB response limit after 5303 rows;
//    use LIMIT/OFFSET to paginate or select fewer columns"）。
//   中文经 JSON 转义后一个字符占 6 字节，一页给 3000 行约 6MB，离 10MB 留够余量。
const PAGE = 3000;
const MAX_PAGES = 20;     // 20×3000 = 6 万行，跟 HARD_MAX 对齐

// 语料缓存多久失效一次。**语料只在他往库里加东西时才变**，加完等一分钟完全可以接受。
// ★ 这个 TTL 是刻意的：不设它，每次查询就多一趟"版本探针"的往返，
//   而那一趟在 0.2 vCPU 上要小一秒——比检索本身还贵。
//   设了它，同一个实例上连着来的对话（老师上课时就是这个节奏）**一趟往返都不用**。
const TTL_MS = 60000;

// ===========================================================================
//  读 PG：走管控面 executePGSql，用运行时自带的临时凭证。**不读任何自建密钥。**
// ===========================================================================
// ★ 这条路成立是**量出来的**，不是读文档猜的：HTTP 云函数的运行时里平台照样注入了
//   临时凭证，而且真能读 PG（一次性探针 httpprobe 实测过，见 cloudfunctions/README.md）。
//   官方文档那句"HTTP Functions must not depend on that default temporary credential
//   injection"是**可靠性**的告诫（长命实例的凭证可能轮换失效 → 偶发失败），
//   不是"HTTP 函数拿不到"。所以调用方必须把**读不到**当成可能发生的事：
//   降级要软，不能让"检索没拿到"变成"老师那边报错"。
let _mgr = null;
function mgr() {
  if (_mgr) return _mgr;
  const mod = require('@cloudbase/manager-node');
  const init = mod.init || (mod.default && mod.default.init);
  if (typeof init !== 'function') throw new Error('manager-node 没有 init');
  _mgr = init({
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN,   // 临时凭证必须带 token
    envId: ENV_ID
  });
  return _mgr;
}

// executePGSql 回来的行是**字符串**，长这样：Rows: ["[\"1\",\"有理\"]"]。
// 形状挺怪的，所以三种可能的形状都兜住——判不出来就**抛**，
// 别装作读到了（宁可报错，也别返回一批空数据让人以为是"没命中"）。
function rowsToObjects(res) {
  const cols = res.Columns || res.columns || [];
  const raw = res.Rows || res.rows || [];
  if (!cols.length && raw.length && typeof raw[0] === 'object' && !Array.isArray(raw[0])) return raw;
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    let r = raw[i];
    if (typeof r === 'string') {
      try { r = JSON.parse(r); } catch (e) { throw new Error('行不是 JSON：' + String(r).slice(0, 80)); }
    }
    if (Array.isArray(r)) {
      const o = {};
      for (let c = 0; c < cols.length; c++) o[String(cols[c]).toLowerCase()] = r[c];
      out.push(o);
    } else if (r && typeof r === 'object') {
      const o2 = {};
      for (const k in r) if (Object.prototype.hasOwnProperty.call(r, k)) o2[String(k).toLowerCase()] = r[k];
      out.push(o2);
    }
  }
  return out;
}

async function pg(sql) {
  const res = await mgr().database.executePGSql({ Sql: sql });
  return rowsToObjects(res);
}

function normInt(v) { const n = parseInt(v, 10); return isNaN(n) ? v : n; }

// 行里每个字段都可能是字符串（executePGSql 全给字符串），page 要的是数字或 null
function normRow(r) {
  let page = r.page;
  if (page === null || page === undefined || page === '' || page === 'NULL') page = null;
  else { page = parseInt(page, 10); if (isNaN(page)) page = null; }
  return { id: normInt(r.id), doc: r.doc, shelf: r.shelf, page: page,
           ord: normInt(r.ord), title: r.title, body: r.body };
}

// 语料版本：行数 + 最大 id。两个都变才认为变了（只加不删的库里，这两个够用）。
async function version() {
  const r = await pg('SELECT count(*)::int AS n, coalesce(max(id), 0)::int AS m FROM public.res_chunks');
  const o = r[0] || {};
  return String(o.n) + ':' + String(o.m);
}

// ★ 冷启动那次**不单独问版本**：整表都已经取回来了，行数和最大 id 就在手里，
//   由它俩算出来的版本号跟 version() 返回的是**同一个值**（都是 "count:max(id)"），
//   却省掉一趟往返回复。
//   为什么值得省：0.2 vCPU 上那趟实测要小一秒；更要紧的是它在冷启动时**什么信息都没多给**——
//   不管库变没变，接下来都得整表取回来。省掉的这趟让 load_ms 的账目也干净了
//   （原来 load_ms - fetch_ms - build_ms 老是差一截，差的就是它）。
function verOf(rawRows) {
  let m = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const n = parseInt(rawRows[i].id, 10);
    if (!isNaN(n) && n > m) m = n;
  }
  return rawRows.length + ':' + m;
}

// ★ 整表取回——**必须分页**（单次回包 10MB 顶）。
//   连账目一起返回：页数、每页耗时、每页取到几行。
//   不带账目的话，"慢了"和"少取了"都看不出来。
async function allRows() {
  const all = [];
  let off = 0, pages = 0, ms = 0;
  const perPage = [];
  for (;;) {
    const t0 = Date.now();
    const rows = await pg('SELECT id, doc, shelf, page, ord, title, body'
      + ' FROM public.res_chunks ORDER BY id LIMIT ' + PAGE + ' OFFSET ' + off);
    const dt = Date.now() - t0;
    ms += dt; pages++;
    perPage.push({ off: off, got: rows.length, ms: dt });
    for (let i = 0; i < rows.length; i++) all.push(rows[i]);
    if (rows.length < PAGE) break;                 // 最后一页（不满）
    off += PAGE;
    if (pages >= MAX_PAGES) throw new Error('分页到 ' + MAX_PAGES + ' 页还没取完，库太大了，该上倒排表了');
  }
  return { rows: all, pages: pages, fetch_ms: ms, per_page: perPage };
}

// ===========================================================================
//  语料缓存：**只跟语料有关的那部分留在实例里**
// ===========================================================================
// 缓存住的是 rows（原样，用来出结果）和 idx（归一化正文/标题 + 长度 + 平均长度，
// 见 reslib-core.makeIndex）。**问题相关的 df / tf / 打分一概不留**——
// 那些每次都要重算，留了就是又一次"统计量用错地方"的开头。
let CACHE = null;   // { ver, at, rows, idx, fetch_ms, pages, per_page, build_ms, load_ms, hits }
let LAST_ERR = '';

const core = require('./reslib-core.js');

async function corpus() {
  const now = Date.now();
  if (CACHE && now - CACHE.at < TTL_MS) { CACHE.hits = (CACHE.hits || 0) + 1; return CACHE; }

  const t0 = Date.now();

  // ★ 只有"手里已经有语料"时才值得问一句"库变了没"（见 verOf 上头那段）。
  //   冷的时候问是白问——变没变都得整表取回来。
  if (CACHE) {
    const v = await version();
    if (CACHE.ver === v) {          // 语料没变，只把表拨一下
      CACHE.at = now;
      CACHE.hits = (CACHE.hits || 0) + 1;
      return CACHE;
    }
  }

  const got = await allRows();
  if (got.rows.length >= HARD_MAX) {
    throw new Error('res_chunks 已到 ' + got.rows.length + ' 行，超过整表取回的安全阀（'
      + HARD_MAX + '）。该上倒排表了，不能靠悄悄降级硬撑。');
  }
  const rows = got.rows.map(normRow);
  const tb = Date.now();
  const idx = core.makeIndex(rows);
  CACHE = {
    ver: verOf(got.rows), at: Date.now(), rows: rows, idx: idx,
    fetch_ms: got.fetch_ms, pages: got.pages, per_page: got.per_page,
    build_ms: Date.now() - tb, load_ms: Date.now() - t0, hits: 0
  };
  return CACHE;
}

// 缓存状态。给自报家门/探针用：老实例还热着吗、语料是哪一版、上回读库为什么失败。
function cacheInfo() {
  return {
    ready: !!CACHE,
    ver: CACHE ? CACHE.ver : null,
    age_ms: CACHE ? Date.now() - CACHE.at : null,
    rows: CACHE ? CACHE.rows.length : null,
    hits: CACHE ? CACHE.hits : null,
    pages: CACHE ? CACHE.pages : null,
    fetch_ms: CACHE ? CACHE.fetch_ms : null,
    build_ms: CACHE ? CACHE.build_ms : null,
    last_err: LAST_ERR || null
  };
}
function noteErr(e) { LAST_ERR = String((e && e.message) || e).slice(0, 200); }

module.exports = {
  ENV_ID: ENV_ID, HARD_MAX: HARD_MAX, PAGE: PAGE, TTL_MS: TTL_MS,
  mgr: mgr, pg: pg, rowsToObjects: rowsToObjects, normRow: normRow,
  version: version, verOf: verOf, allRows: allRows, corpus: corpus,
  cacheInfo: cacheInfo, noteErr: noteErr
};

// 本地检索：把教材索引切成条目，按学生这一轮说的话找相关的几条。
//
// 为什么不用向量：整份索引 118 条、2 万字，二元组 BM25 在纯 JS 里几十毫秒就跑完，
// 不要网络、不要依赖、不要 embedding 接口（DeepSeek 本身也没有）。
// 中文用「字符二元组」建索引，不需要分词器——这个量级下最省事且够用。
var SR = (window.SR = window.SR || {});

SR.retrieve = (function () {

  // 切成条目：每条以 "### " 开头。返回 [{title, body, text}]
  function splitEntries(raw) {
    var parts = String(raw || '').split(/\n(?=###\s)/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!/^###\s/.test(p)) continue;
      var nl = p.indexOf('\n');
      var title = (nl < 0 ? p : p.slice(0, nl)).replace(/^###\s*/, '').trim();
      var body = nl < 0 ? '' : p.slice(nl + 1);
      out.push({ title: title, body: body, text: title + '\n' + body });
    }
    return out;
  }

  // 中文没有词边界，按相邻两字切；标点空白先去掉
  function bigrams(s) {
    s = String(s || '').toLowerCase().replace(/[\s　]+/g, '')
         .replace(/[，。、；：？！“”‘’（）《》〈〉【】—…·,.;:?!"'()\[\]<>_/\\|~`@#$%^&*+=]/g, '');
    var out = [];
    if (s.length === 1) { out.push(s); return out; }
    for (var i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
    return out;
  }

  var K1 = 1.2, B = 0.75;

  // 建索引。标题里的字权重高一些——标题就是"这是哪一节课"
  function build(raw) {
    var docs = splitEntries(raw);
    var df = {}, postings = [], len = [], avg = 0;
    for (var d = 0; d < docs.length; d++) {
      var grams = bigrams(docs[d].body).concat(bigrams(docs[d].title).concat(bigrams(docs[d].title)));
      var tf = {};
      for (var i = 0; i < grams.length; i++) tf[grams[i]] = (tf[grams[i]] || 0) + 1;
      postings.push(tf);
      len.push(grams.length); avg += grams.length;
      for (var g in tf) if (tf.hasOwnProperty(g)) df[g] = (df[g] || 0) + 1;
    }
    avg = docs.length ? avg / docs.length : 1;
    return { docs: docs, df: df, postings: postings, len: len, avg: avg, N: docs.length };
  }

  function search(idx, query, k) {
    if (!idx || !idx.N) return [];
    var qs = bigrams(query), seen = {}, scored = [];
    for (var i = 0; i < qs.length; i++) {
      var g = qs[i];
      if (seen[g]) continue;
      seen[g] = 1;
      var n = idx.df[g];
      if (!n) continue;                                   // 语料里没有这个词，跳过
      var idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
      for (var d = 0; d < idx.N; d++) {
        var f = idx.postings[d][g];
        if (!f) continue;
        var denom = f + K1 * (1 - B + B * (idx.len[d] / idx.avg));
        scored[d] = (scored[d] || 0) + idf * (f * (K1 + 1)) / denom;
      }
    }
    var out = [];
    for (var j = 0; j < idx.N; j++) if (scored[j]) out.push({ i: j, score: scored[j], doc: idx.docs[j] });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, k || 3);
  }

  return { splitEntries: splitEntries, bigrams: bigrams, build: build, search: search };
})();

// 开箱即用：教材索引的索引（首次调用时惰性建好）
SR.textbookIndex = null;
SR.findTextbook = function (query, k) {
  if (!SR.textbookIndex) SR.textbookIndex = SR.retrieve.build(SR.TEXTBOOK || '');
  return SR.retrieve.search(SR.textbookIndex, query, k || 2);
};

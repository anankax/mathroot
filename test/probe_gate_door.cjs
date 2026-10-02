// 门槛探针：**从外面敲云函数 gate 那三道门，看它开不开。**
//
// 为什么这件事非要有、而且不能在浏览器里量：
//   test/probe_flow_panel.cjs 的 F 段在**线上那一页**量的是"门后头那套东西对不对"
//   （云上真把苏科版那几条送回来、跟本机算的一不一样）。可那道门**挡不挡得住人**，
//   在浏览器里量不了——能从 localhost 发出去的请求，浏览器在 CORS 那一层就拦掉了
//   （见那边 F 段顶上那段：腾讯云网关对 localhost 回了两个 ACAO）。
//   而这道门真正的对手**根本不是浏览器**，是"顺手扫到那个域名、拿口令把 118 个问法
//   问一遍的脚本"（js/config.js 那句原话：它挡的是这个，**不是安全**）。
//   所以就在这里用最像脚本的办法敲门：node 直接发 HTTP。
//
// ★ 它只判**门开不开**（状态码 + 那几句原文）。门后头的东西对不对不归它管。
// ★ 先跑红：RED=1 会把每条期望反过来，那几条必须报红——
//   不然没法知道这一把尺子是不是恒绿的（恒绿的尺子比没有尺子更坏）。
//   跑法：RED=1 node test/probe_gate_door.cjs
//
// 用法：node test/probe_gate_door.cjs
// 退出码：0 = 都对；1 = 有地方对不上；2 = 探针自己炸了；3 = 仪器不在（没配云函数）
//
// ⚠ 这一趟会真的往云上发几次请求，KB 那个日计数会 +2（它不花模型额度，见最后一条）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INVERT = !!process.env.RED;
let bad = 0, ran = 0;
// noInv：那几条"我在不在工作"的自检不参与红验反转——
//   ★ 这是尺子纪律：自检只能问"我在不在工作"，不能问"产品对不对"。
//     仪器不在就是不在，把它反过来说"仪器在"没有意义（还会让整趟在门口就退出）。
function judge(what, got, want, noInv) {
  ran++;
  // ★ 红验：把判据**取反**（"相等才算过" → "相等才算红"）。
  //   ⚠ 第一版这里写的是"把 got 和 want 对调"——那是**恒绿**的：
  //     等号两边互换，结果一模一样。RED=1 跑出来 12 条全绿，正是它露馅的地方。
  //     （教训：红验本身也得能红，不然它只是"我跑过一次"的凭证。）
  const inv = INVERT && !noInv;
  const pass = inv ? (got !== want) : (got === want);
  if (pass) { console.log('  ✓ ' + what + (inv ? '（红验：本该如此）' : '')); return true; }
  bad++;
  console.log('  ✗ ' + what + '    ← 拿到 ' + JSON.stringify(got) + '，要的是 ' + JSON.stringify(want)
    + (inv ? '  ★ 这是红验，本该反着' : ''));
  return false;
}

// ---- 地址和口令**从 js/config.js 里读**，不在这儿另写一份 ----
// ★ 写死一份等于"把答案抄进考题"：哪天换了环境／换了口令，这一份不会跟着变，
//   而它会继续拿旧的去敲，报出来的红指错地方。
function readGate() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
  const i = src.indexOf('SR.GATE');
  if (i < 0) return null;
  const seg = src.slice(i, i + 800);
  const u = seg.match(/url:\s*'([^']+)'/);
  const t = seg.match(/token:\s*'([^']*)'/);
  const on = seg.match(/on:\s*(true|false)/);
  return { url: u && u[1], token: t ? t[1] : '', on: on ? on[1] === 'true' : true };
}

async function hit(g, o) {
  o = o || {};
  const h = { 'Content-Type': 'application/json' };
  if (o.token !== false) h['X-Gate-Token'] = o.token || g.token;
  if (o.referer) h['Referer'] = o.referer;
  if (o.origin) h['Origin'] = o.origin;
  const r = await fetch(g.url, {
    method: o.method || 'POST',
    headers: h,
    body: o.method === 'GET' ? undefined : JSON.stringify(o.body || { step: 'textbook', query: '我不会画数轴', k: 2 }),
  });
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  return { status: r.status, j: j };
}

const ALLOWED = 'https://anankax.github.io/';   // 跟云函数里 ALLOW_ORIGIN 的默认值同一个

(async () => {
  const g = readGate();
  console.log('云函数地址（从 js/config.js 读来的）：' + (g && g.url ? g.url.slice(0, 58) + '…' : '(没读到)'));

  // ---------- ⓪ 仪器在不在 ----------
  console.log('\n⓪ 仪器在不在（不在的话后面每一条都是假绿）');
  if (!judge('js/config.js 里读得到 SR.GATE 的地址', !!(g && g.url), true, true)) {
    console.log('\n★ 仪器都不在，到此为止。');
    process.exit(3);
  }
  const health = await hit(g, { method: 'GET' }).catch(e => ({ status: 0, j: null, err: e.message }));
  console.log('    GET / → ' + health.status + '  ' + JSON.stringify(health.j && { name: health.j.name, version: health.j.version, steps: health.j.steps, kb: health.j.kb && health.j.kb.entries }));
  judge('★ 云函数活着，而且自报是 gate', health.j && health.j.name, 'gate', true);
  // ★ 语料真装进去了没有——不先看这一条，"检索跑了但没命中"和"语料根本没装"
  //   从外面看一模一样（这句话是云函数自己顶上写着的）。
  judge('★ 语料真在云函数的代码包里（entries 大于 0）',
    !!(health.j && health.j.kb && health.j.kb.ready && health.j.kb.entries && health.j.kb.entries.textbook > 0), true, true);
  const used0 = health.j && health.j.used, kb0 = health.j && health.j.kbUsed;
  console.log('    这一发用了口令，所以能看到计数：模型 ' + used0 + ' / 知识库 ' + kb0 + '（上限 ' +
    (health.j && health.j.cap) + ' / ' + (health.j && health.j.kbCap) + '）');

  // ---------- ① 不带 Referer ----------
  // ★ 这是**脚本的常态**（curl / python requests 默认都不带）。应当被拒。
  console.log('\n① 不带来源的脚本（Referer 一个不带的常态）');
  const noRef = await hit(g, {}).catch(e => ({ status: 0, j: null, err: e.message }));
  console.log('    → ' + noRef.status + '  ' + JSON.stringify(noRef.j && noRef.j.error));
  judge('★ 不带来源的请求被拒（403）', noRef.status, 403);
  judge('★ 而且拒的理由是"来源不对"（不是撞上别的门）',
    /来源不对/.test(String(noRef.j && noRef.j.error)), true);

  // ---------- ② 别的站当来源 ----------
  console.log('\n② 冒一个别的站当来源（Origin: https://evil.example）');
  const evil = await hit(g, { origin: 'https://evil.example' }).catch(e => ({ status: 0, j: null, err: e.message }));
  console.log('    → ' + evil.status + '  ' + JSON.stringify(evil.j && evil.j.error));
  judge('★ 不是白名单的来源也被拒（403）', evil.status, 403);

  // ---------- ③ 错的口令 ----------
  // ⚠ 错口令必须是**纯 ASCII**：头值里放中文，node 的 fetch 自己就会抛
  //   「Cannot convert argument to a ByteString」——那是尺子坏了，不是门坏了。
  //   （这个坑第一跑就踩了：报出来的红指着云函数，其实是我这一行写错了。curl 反而容忍。）
  console.log('\n③ 口令填错（来源是对的）');
  const badTok = await hit(g, { token: 'definitely-wrong-token', referer: ALLOWED }).catch(e => ({ status: 0, j: null, err: e.message }));
  if (badTok.err) console.log('    （这一发自己就没发出去：' + badTok.err + '）');
  console.log('    → ' + badTok.status + '  ' + JSON.stringify(badTok.j && badTok.j.error));
  judge('★ 错口令被拒（401）', badTok.status, 401);

  // ---------- ④ 门开的时候 ----------
  console.log('\n④ 对的口令 + 对的来源（他自己那两条路走的就是这一发）');
  const good = await hit(g, { referer: ALLOWED }).catch(e => ({ status: 0, j: null, err: e.message }));
  console.log('    → ' + good.status + '  ' + JSON.stringify(good.j && {
    ok: good.j.ok, via: good.j.via, k: good.j.k,
    hits: (good.j.hits || []).map(h => h.title + '@' + h.score),
  }));
  judge('★ 门开了（200）', good.status, 200);
  judge('★ 回的是真检索结果（via:"gate"，hits 里有标题和分数）',
    !!(good.j && good.j.via === 'gate' && (good.j.hits || []).length &&
      good.j.hits[0].title && typeof good.j.hits[0].score === 'number' && good.j.hits[0].text), true);
  // ★ 云上那份语料里那几句【书上原话】得真回来——不然"检索通了但给的是空壳"。
  judge('★ 命中里带着【书上原话】（不是只有标题的空壳）',
    /【书上原话】/.test(String((good.j && good.j.hits && good.j.hits[0] && good.j.hits[0].text) || '')), true);

  // ---------- ⑤ 翻教材这一步**不花模型额度** ----------
  // ★ 这是云函数里那道分岔（KBS 那两步走自己的闸、不碰 DAILY_CAP）唯一能从此处看见的样子。
  //   要是哪天有人把它并回模型那条路，这一条会红——而它红了正好说明那件事发生了。
  console.log('\n⑤ 翻教材这一步花不花模型额度');
  const after = await hit(g, { method: 'GET' }).catch(e => ({ status: 0, j: null, err: e.message }));
  const used1 = after.j && after.j.used, kb1 = after.j && after.j.kbUsed;
  console.log('    这一趟之后：模型 ' + used1 + ' / 知识库 ' + kb1);
  judge('★ 模型那个计数一格没动（翻教材不花额度）', used1, used0);
  // ⚠ 这个计数**活在函数实例的内存里**（云上还没有支持它的库，见 js/config.js 顶上那段）。
  //   实例被回收／换了一个实例来答，这里就会看着"没涨"——那不是产品坏了，
  //   是这两个数不在同一本账上。真碰上了，连着敲两次 GET / 看它跳不跳，再下结论。
  judge('★ 知识库那个计数涨了（说明真去检索了，不是没发生）', kb1, kb0 + 1);

  console.log('');
  console.log('跑了 ' + ran + ' 条，红的 ' + bad + ' 条。' + (INVERT ? '  ★ 这一趟是红验：期望全反过来了，**红才是对的**。' : ''));
  console.log('★ 这道门只保证"门开不开"。**门后头那套东西对不对**（云上那份跟本机是不是同一份）');
  console.log('  由 test/probe_flow_panel.cjs 的 F 段在**线上那一页**量。');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('探针自己挂了：' + ((e && e.message) || e)); process.exit(2); });

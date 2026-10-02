// 契约哨兵：**云上那张形状表，和浏览器这一份，说的是不是同一件事。**
//
// 管到的"两处各写一份"一共三类：
//   ②③ 知识库那两步的名字（textbook / zhuawen）和取几条（k）
//   ⑤  「展开一个环节」云上认的写法，跟 js/chips.js 读链子的正则对不对得上
//   ⑥  资源库那一步：浏览器读的字段（body / title / score）云上那份发不发得出、
//      要的条数越没越过云上的上限（后一条是 2026-10-02 加的，
//      因为 reslib 的坏法**一个字都不会报错**——见那一节的注释）
//
// 为什么必须有它（这是"这一步做不做"这件事上唯一的风险）：
//   云函数 gate 收 `{step, ...}` 之后要**按这一步校验这段回复该有的形状**，
//   不合格就换一句重发。可那张表**只能放在云函数的代码包里**——
//   我的探针够不着它（跑不了 CDP、进不了尺子、不在这台机器的仓库里）。
//   于是"同一件事被写在两个地方"这件事出现了，而它坏的样子的特点是：
//   **没有症状**。云上悄悄少认一种写法，界面上只会表现为"这一步偶尔要重发两次"，
//   没人会往那张表上想。
//   所以把"两份会漂"变成**一个脚本能报出来的事**——就是这一个文件。
//
// ★★ 它判的是"两份是不是同一件事"，**不判"这件事定得对不对"**。
//   比如 gate 认「第 N 个环节」也认「第 N 节」，这条规矩本身好不好，脚本给不了答案；
//   它只能告诉你**两边是不是都认**。
//
// ★ 先跑红：这个脚本的比对机制是先跑红验过的——
//   把 cloudfunctions/gate 复制一份到临时目录、在副本里把某一步的 k 改掉，
//   用 GATE_DIR 指过去，那几条必须报红（见文件末尾的用法）。
//   看见它红过，才信它判得了绿。
//
// ★ 2026-10-02 加 ⑥（资源库那一步的字段 / 条数）时又跑了一遍红验，三种改法都真红过：
//   ① 副本的 reslib-retrieve.js 里 `body: r.body` 改成 `text: r.body`  → 2 条红
//      （自检那条 + 字段那条）——**这就是要拦的坏**：改完界面上那一步照样"跑完了"，
//      只是写着「库里没翻到对得上的」，跟库里真没有一模一样。
//   ② 副本的 index.js 里 `RES_K = 3` 改成 `2`        → 1 条红（默认条数不一样）
//   ③ 副本的 index.js 里 `RES_K_MAX = 8` 改成 `2`    → 1 条红（浏览器要 3，会被悄悄夹掉）
//
// 跑法：node test/check_gate_contract.cjs
//       GATE_DIR=/tmp/改过的gate node test/check_gate_contract.cjs   （红验用）
//       ⚠ 红验要 `cp -r cloudfunctions/gate /tmp/改过的gate` **整目录**搬，
//         因为 ⑥ 读的是目录里的 reslib-retrieve.js，不是 index.js 一个文件。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GATE_DIR = process.env.GATE_DIR || path.join(ROOT, 'cloudfunctions', 'gate');
const GATE_SRC = path.join(GATE_DIR, 'index.js');

let bad = 0, ran = 0;
function judge(what, cond, got) {
  ran++;
  if (cond) { console.log('  ✓ ' + what); return true; }
  bad++;
  console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got));
  return false;
}

// ---- 把 flow.js 原样装进来（跟浏览器同一个 window 形状）----
// ★ 跟 test/probe_chain.cjs 同一个装法：flow.js 顶上写的是 `var SR = window.SR`，
//   node 里没有 window，得替它造一个。
const W = { SR: {} };
new Function('window', 'document',
  'var SR = (window.SR = window.SR || {});\n' +
  fs.readFileSync(path.join(ROOT, 'js', 'flow.js'), 'utf8')
)(W, undefined);
const F = W.SR.flow;

// ---- 从云函数源码里把两张表抠出来 ----
// ★ 为什么不"调一次云函数问它"：那验的是**部署上去的那一份**，
//   而这里要拦的是"**源码里那两份**已经开始不一样了"——那个错要在部署**之前**抓住。
//   （部署漂了是另一件事，那条由 test/probe_kb_cloud.cjs 管。）
// 抠 `const X = { … };` 这一段（收到下一处**顶格的** `};` 为止）。
function cutBlock(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const j = src.indexOf('\n};', i);
  if (j < 0) return null;
  return src.slice(i, j + 3);
}

function loadGateTables() {
  const src = fs.readFileSync(GATE_SRC, 'utf8');
  const out = {};
  // countRoutes 是 STEPS 用的，得跟着一起进去（它只用正则，不碰别的）。
  // ⚠ 取到的是**源码原文**，所以那两份表**改一个字这里就跟着变**——
  //   这正是它要判的（两份是不是同一件事），也是它唯一能判的。
  const ci = src.indexOf('function countRoutes');
  const si = src.indexOf('const STEPS = {');
  const se = si >= 0 ? src.indexOf('\n};', si) : -1;
  if (ci >= 0 && se > ci) {
    try { out.STEPS = new Function(src.slice(ci, se + 3) + '\nreturn STEPS;')(); }
    catch (e) { out.STEPS = null; out.err = 'STEPS 抠不出来：' + e.message; }
  }
  const kbs = cutBlock(src, 'const KBS = {');
  if (kbs) {
    try { out.KBS = new Function(kbs + '\nreturn KBS;')(); }
    catch (e) { out.KBS = null; out.err2 = 'KBS 抠不出来：' + e.message; }
  }
  return out;
}

const G = loadGateTables();

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => (a || []).slice().sort();

(async () => {
  console.log('浏览器这一份：' + path.join(ROOT, 'js', 'flow.js'));
  console.log('云上那一份：  ' + GATE_SRC);
  console.log('');

  // ---------- ① 两份表都得抠得出来 ----------
  console.log('① 两张表都在（抠不出来后面的比对全是假绿）');
  judge('云上 STEPS 抠出来了', !!G.STEPS, G.err || null);
  judge('云上 KBS 抠出来了', !!G.KBS, G.err2 || null);
  judge('浏览器这份的 STEPS / KB_STEPS / MODEL_STEPS 都在',
    !!(F && F.STEPS && F.KB_STEPS && F.MODEL_STEPS), F && Object.keys(F || {}));
  if (!G.STEPS || !G.KBS || !F) {
    console.log('\n★ 表都没齐，后面的比对做了也是白做，到此为止。');
    process.exit(1);
  }

  // ---------- ② 知识库那两步：名字 ----------
  console.log('\n② 知识库那两步的名字（textbook / zhuawen）');
  judge('★ 名字逐项一样', same(sorted(Object.keys(G.KBS)), sorted(F.KB_STEPS)),
    { 云上: sorted(Object.keys(G.KBS)), 浏览器: sorted(F.KB_STEPS) });
  judge('两边都不是空的', Object.keys(G.KBS).length > 0 && F.KB_STEPS.length > 0,
    { 云上: Object.keys(G.KBS).length, 浏览器: F.KB_STEPS.length });

  // ---------- ③ 知识库那两步：取几条 ----------
  // ★ 这个数最容易悄悄漂：云上取 2 条、浏览器只认 1 条过线，
  //   表现就是"云上翻回来的东西被浏览器丢掉一条"，看着像检索不准。
  console.log('\n③ 知识库那两步各取几条（k）');
  for (const step of F.KB_STEPS) {
    const cloudK = (G.KBS[step] || {}).k;
    const mineK = (F.STEPS[step] || {}).k;
    judge('[' + step + '] k 一样（云上 ' + cloudK + ' / 浏览器 ' + mineK + '）', cloudK === mineK,
      { 云上: cloudK, 浏览器: mineK });
  }

  // ---------- ④ 模型那几步：名字 ----------
  console.log('\n④ 模型那几步的名字（topic / routes / step / wrap）');
  judge('★ 名字逐项一样', same(sorted(Object.keys(G.STEPS)), sorted(F.MODEL_STEPS)),
    { 云上: sorted(Object.keys(G.STEPS)), 浏览器: sorted(F.MODEL_STEPS) });

  // ---------- ⑤ 「展开一步」这一步认不认同一件事 ----------
  // ★★ 这是这份表里**唯一一处两边都在真的判断**的地方，也是最容易漂的一处：
  //   云上那个 check 决定"这段回复要不要重发"，而浏览器那边（js/chips.js 的 RE_STEP）
  //   决定"这条链子怎么读"。云上认的写法比浏览器窄 → 云上会**一直重发**产品明明
  //   读得懂的东西；反过来宽 → 云上放过去，产品读不出来，链子断一节。
  //   ⚠ 所以这里比的不是"云上写的对不对"，是**两边是不是同一件事**。
  console.log('\n⑤ 「展开一个环节」这一步：云上认的写法，跟浏览器读链子的写法对不对得上');
  const chipsSrc = fs.readFileSync(path.join(ROOT, 'js', 'chips.js'), 'utf8');
  // ⚠⚠ 这里必须**求值那个字符串字面量**，不能直接拿源码里那几个字符。
  //   chips.js 里写的是 `var UNIT = '(?:个?\\s*环节|节)'`——源码里是**两个反斜杠**，
  //   而那个字符串的**值**里是一个。照源码字符拼出来会得到 `\\s*`（＝字面的
  //   "反斜杠 + s"），于是每一个正例都判成不认，报出一片假红。
  //   （这是同一个家族的第八次：**量到的字符不是它说的那个东西**。
  //     抓它的方式是下面那条自检——先拿一个已知该认的标题试一下尺子。）
  const unitLit = chipsSrc.match(/var UNIT = ('[^']+')/);
  let UNIT = null;
  try { UNIT = unitLit ? new Function('return ' + unitLit[1])() : null; } catch (e) { UNIT = null; }
  judge('在 js/chips.js 里把那个单位正则求出来了（UNIT）', typeof UNIT === 'string' && UNIT.length > 0, UNIT);
  if (UNIT && G.STEPS.step && G.STEPS.step.check) {
    // 浏览器那边是 `第\s*([0-9]+)\s*UNIT\s*[·・.:：]`，这里只取"认不认这个开头"这一段，
    // 不带后面的名字和分隔符——因为云上那个 check 也只判开头。
    const head = new RegExp('^第\\s*[0-9]+\\s*' + UNIT);
    // ---- 尺子自检：它得先认出**肯定该认的**那条，不然下面"两边一致"可能是
    //      "两边都恒为假"混过去的（那是最像绿的一种红）。----
    judge('★ 尺子自检：它认得出「第 2 个环节 · 复述」', head.test('第 2 个环节 · 复述'), head.source);
    judge('★ 尺子自检：它认得出「第 3 节 · 收集错法」', head.test('第 3 节 · 收集错法'), head.source);
    const cases = [
      '第 2 个环节 · 复述', '第3环节·定位', '第 1 环节 · 追问', '第 3 节 · 收集错法',
      '第2节·给台阶', '第 4 个环节 · 收尾', '第 12 个环节 · 名字',
      // 反面：这些**两边都不该认**
      '下一步我们看点 B。', '第二环节 · 名字（中文数字，两边都不认）',
      '第 3 节车厢里坐着人', '我们看第一个环节'
    ];
    let agree = 0, disagree = [];
    for (const s of cases) {
      const cloud = !!G.STEPS.step.check(s);
      const mine = head.test(s.trim());
      if (cloud === mine) agree++;
      else disagree.push({ 句子: s, 云上认: cloud, 浏览器认: mine });
    }
    judge('★ ' + cases.length + ' 个句子上两边判断一致（' + agree + '/' + cases.length + '）',
      agree === cases.length, disagree);
    // 这条单拎出来说：它反过来说明上面那一条不是"两边都恒为真"混过去的
    const cloudNo = cases.filter((s) => !G.STEPS.step.check(s)).length;
    judge('★ 那批反面例子里云上确实有不认的（不然上面那条等于没比）', cloudNo >= 3, cloudNo);
  }

  // ---------- ⑥ 收尾那三行格式，云上没在管 ----------
  // ★ 说清楚一件**没做**的事，免得下一个人以为它验过了：
  //   收尾块（```想说 / ```ggb / 那三行）是**产品自己的命根子**，而云上那张表里
  //   只有 topic/routes/step/wrap 四步、一步都没碰它。这是**故意**的：
  //   围栏是"这一步怎么说"的一部分，留在浏览器（见 js/gate.js 顶上那条分界线）。
  // ---------- ⑥ 资源库那一步：浏览器读的字段，云上那份真发得出来吗 ----------
  // ★ 为什么单拎出来：这一步的坏法**没有症状**。云上把 body 改名成 text、
  //   或者浏览器改成读 h.text，两边的结果都是"这一格跑完了，但附注里那一块没有"——
  //   而面板上写的是「库里没翻到对得上的」，**跟库里真没有长得一模一样**。
  //   它跟②③是同一类（一件事写在两个地方），只是这一步的对家不在 gate/index.js 里，
  //   在 gate/reslib-retrieve.js 里——所以②③那两段抠不到它。
  //
  // ★ 比法是"从两边各自的源码里抠出来再对"：浏览器**读**了哪几个字段
  //   （扫 js/flow.js 里 pluckRes + resNote 两个函数），云上**发**了哪几个字段
  //   （扫 reslib-retrieve.js 里那个 hits 映射的对象字面量）。不是抄一遍字符串——
  //   抄一遍就成了"把产品焊进尺子"，产品一改名尺子跟着改，永远绿。
  console.log('\n⑥ 资源库那一步：浏览器读的字段，云上那份真发得出来吗');

  // 云上**发**的：`const hits = out.hits.map(function (h) { … return { … }; })`
  function emittedFields(src) {
    const a = src.indexOf('const hits = out.hits.map');
    if (a < 0) return null;
    const b = src.indexOf('return {', a);
    if (b < 0) return null;
    const c = src.indexOf('};', b);
    if (c < 0) return null;
    const names = [];
    // ⚠ 一个字面量里可能一行写好几个键（`id: r.id, doc: r.doc, …`），
    //   所以按行切完还得按逗号切——只按行切会漏掉除第一个以外的每一个。
    for (const line of src.slice(b, c).split('\n')) {
      const code = line.replace(/\/\/.*$/, '');          // 先把行尾注释切掉，免得注释里的冒号混进来
      for (const piece of code.split(',')) {
        const m = piece.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
        if (m) names.push(m[1]);
      }
    }
    return names;
  }

  // 浏览器**读**的：h.<字段>（只在 pluckRes / resNote 这两个函数里找）
  const flowSrc = fs.readFileSync(path.join(ROOT, 'js', 'flow.js'), 'utf8');
  const fa = flowSrc.indexOf('function pluckRes');
  const fb = flowSrc.indexOf('function resNote');
  const fc = fb < 0 ? -1 : flowSrc.indexOf('\n  }', fb);
  const readBlock = (fa >= 0 && fb > fa && fc > fb) ? flowSrc.slice(fa, fc) : '';
  const readFields = [...new Set((readBlock.match(/\bh\.([A-Za-z_$][\w$]*)/g) || []).map((s) => s.slice(2)))];

  const RETRIEVE = path.join(GATE_DIR, 'reslib-retrieve.js');
  const retSrc = fs.existsSync(RETRIEVE) ? fs.readFileSync(RETRIEVE, 'utf8') : '';
  const emitFields = retSrc ? emittedFields(retSrc) : null;

  // ---- 尺子自检：两边都得真抠出东西来。
  //   抠出来是空的（改了写法 / 文件不在）跟"两边一致"从结果上没法区分，先把它挡住。
  judge('尺子自检：浏览器那边抠出了它读的字段（抠不出＝下面等于没比）',
    readFields.length > 0, { 抠到: readFields.length, 块字数: readBlock.length });
  judge('尺子自检：云上那边抠出了它发的字段（抠不出＝下面等于没比）',
    Array.isArray(emitFields) && emitFields.length > 0, { 文件在: !!retSrc, 抠到: emitFields });
  // ★ 这条防的是"抠是抠到了，但抠的是一堆不相干的东西"——
  //   云上那份不管怎么改，body 和 title 一定得在里面（浏览器就是靠这两个认东西的）。
  judge('尺子自检：云上那份的字段单子里确实有 body 和 title',
    !!emitFields && emitFields.indexOf('body') >= 0 && emitFields.indexOf('title') >= 0, emitFields);

  if (readFields.length && emitFields && emitFields.length) {
    const missing = readFields.filter((f) => emitFields.indexOf(f) < 0);
    judge('★ 浏览器读的那几个字段（' + readFields.join(' / ') + '），云上那份都发得出来',
      missing.length === 0, { 浏览器读: readFields, 云上发: emitFields, 云上没发的: missing });
  }

  // ---- 取几条：这个数漂了也是没症状的（云上悄悄少给几条，看着像"检索不准"）----
  // ⚠ GATE_SRC 是**路径**，不是源码——上面几张表是 loadGateTables() 抠出来给我们的。
  //   这里要读的是文件正文，得自己读一遍。（第一版就是拿路径去 match，两边都回 null，
  //   报出"云上 NaN"——数字不是它宣称的那件事，又一个。）
  const gateSrc = fs.readFileSync(GATE_SRC, 'utf8');
  const numConst = (name) => {
    const m = gateSrc.match(new RegExp('^const ' + name + ' = (\\d+);', 'm'));
    return m ? Number(m[1]) : null;
  };
  const resK = F.STEPS.reslib && F.STEPS.reslib.k;
  const cloudK = numConst('RES_K');
  const cloudKMax = numConst('RES_K_MAX');
  judge('尺子自检：云上那份的 RES_K / RES_K_MAX 抠出来了',
    cloudK !== null && cloudKMax !== null, { RES_K: cloudK, RES_K_MAX: cloudKMax });
  judge('[reslib] 默认条数一样（云上 ' + cloudK + ' / 浏览器 ' + resK + '）', cloudK === resK, { 云上: cloudK, 浏览器: resK });
  // ★ 浏览器要的条数**超过云上的上限**时，云上会**悄悄夹掉**，回包还是 ok:true，
  //   浏览器一句都不会知道。所以这一条不是"一样就行"，是"不许越过上限"。
  judge('★ 浏览器要的条数没越过云上的上限 ' + cloudKMax + '（越了会被云上悄悄夹掉，回包照样 ok）',
    typeof resK === 'number' && cloudKMax !== null && resK <= cloudKMax,
    { 浏览器要: resK, 云上上限: cloudKMax });

  // ---------- ⑦ 云上这张表管到哪儿了（这条不是判分，是把边界写下来） ----------
  console.log('\n⑦ 云上那张表管到哪儿了（这条不是判分，是把边界写下来）');
  console.log('    云上认的步骤：' + sorted(Object.keys(G.STEPS)).join(' / '));
  console.log('    云上认的知识库步：' + sorted(Object.keys(G.KBS)).join(' / '));
  console.log('    资源库那一步：' + (gateSrc.indexOf("step === 'reslib'") >= 0 ? '认' : '★ 不认') +
    '（它不在 KBS 那张表里，走的是单独一条路）');
  console.log('    ★ 围栏（```想说 / ```ggb）、提示词、账本**一个都不在云上**——');
  console.log('      那是"这一步怎么说"，留在浏览器（js/gate.js 顶上那条分界线）。');

  console.log('');
  console.log('跑了 ' + ran + ' 条，红的 ' + bad + ' 条。');
  console.log('★ 这道哨兵只保证"两份说的是同一件事"。**它保证不了那张表定得对不对**——');
  console.log('  那是你在真实对话里才看得出来的事。');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('哨兵自己挂了：' + ((e && e.message) || e)); process.exit(1); });

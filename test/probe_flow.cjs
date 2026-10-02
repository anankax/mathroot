// 流水线的账本：**"重跑只动它和它下游"这句话，是不是真的。**
//
// 为什么这一条要单独写一个探针：
//   阶段五做的是"把备一次课变成一条看得见的流水线"（见 js/flow.js 顶上）。
//   面板画得对不对，人看一眼就知道；可**账本里那几步的状态**人看不出来——
//   它是靠"哪一步亮着哪一步暗着"体现的，而**亮错了的样子和亮对了的样子长得一模一样**。
//   最要命的一条是重跑：要是 staleAfter 写成"整条从头标起"，
//   面板上一样会出现一排「得重来」，你只会觉得"它挺谨慎"，不会觉得它坏了。
//   所以这里把那句话**量出来**：重跑 textbook 之后，recall 和 textbook 必须还是 done。
//
// ★ 它判的是"账本自己前后一致"，**不判"这条流水线的步骤分得对不对"**——
//   那是你真实走一轮才看得出来的事（计划文件验收那节：人看）。
//
// ★ 先跑红：这个脚本的比对机制是先跑红验过的。做法是把 js/flow.js 复制一份，
//   在副本里把 staleAfter 那道闸去掉（改成从头标起），用 FLOW_FILE 指过去，
//   ③ 那几条必须报红；再把 plan 改成永远返回全长路线，① 必须报红。
//   看见它红过，才信它判得了绿。（两次都真跑过，见文件末尾那条注释。）
//
// ★ 2026-10-02 加 reslib（备课那条从六步变七步）时重跑了一遍红验，三种改法都真红过：
//   ① 把 'reslib' 从 ORDER_FULL 里删掉        → ① 那三条 + 资源库那条，共 4 条红
//   ② staleAfter 改成从头标起                  → ④ 那一片，共 6 条红
//   ③ 把"拿不到就 skip"改成"照样标 done"       → 资源库那条 + 两处状态串，共 3 条红
//   ③ 是专门为新增的那两条（没有本机退路 / 跳过就一个字都不加）做的——
//   少了它，"跳过"和"翻到了空的"在账本上长得一样，那两条等于没写。
//
// ★ 同一天，为 ⑨（那几块材料的短名）又跑了一遍红验，两种改法都真红过：
//   ① 把 shortName 退回"整条路径"    → ⑨ 前八条里红 7 条
//   ② 把 used 改成照 hits 全抄        → **只红一条**
//   ② 那一条单独说：它红的那一条是唯一会红的。因为①那批量的是"名字短不短"，
//   而"出处名单里混进了根本没进提示词的那几块"，从字面上看**名字照样是短的**——
//   ⑨ 里只有那一条在问"报出来的出处，跟真发出去的东西，是不是同一批"。
//
// 跑法：node test/probe_flow.cjs
//       FLOW_FILE=test/改过的flow.js node test/probe_flow.cjs   （红验用；
//       ★ 别写 /tmp —— 这是 Windows，node 会把 /tmp 当 C:\tmp，直接 ENOENT）

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FLOW_FILE = process.env.FLOW_FILE || path.join(ROOT, 'js', 'flow.js');

let bad = 0, ran = 0;
function judge(what, cond, got) {
  ran++;
  if (cond) { console.log('  ✓ ' + what); return true; }
  bad++;
  console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got));
  return false;
}

// ---- 把产品那几个文件原样装进来 ----
// ★ 跟 test/check_gate_contract.cjs 同一个装法：这些文件顶上写的都是 `var SR = window.SR`，
//   node 里没有 window，得替它造一个。**不 require、不翻译、不改一个字**——
//   验的就是浏览器里跑的那一份。
//
// ⚠ 装载顺序是**产品自己的顺序**（index.html 里那几个 script 标签的次序）：
//   config → kb → retrieve → 两份语料 → flow → api。
//   flow 的 cutOf 要 SR.kb、localKb 要 SR.findTextbook，顺序反了会静默退到 0（＝不卡线），
//   那正好是最像绿的一种红。
const W = { SR: {} };
const FAKE_DOC = { createElement: () => ({ appendChild() {}, addEventListener() {} }), getElementById: () => null };
function load(rel, src) {
  const code = src != null ? src : fs.readFileSync(path.join(ROOT, rel), 'utf8');
  new Function('window', 'document', 'location', 'localStorage', 'navigator', code)(
    W, FAKE_DOC, undefined, undefined, undefined);
}
for (const f of ['js/config.js', 'js/kb.js', 'js/retrieve.js', 'js/textbook.js', 'js/zhuawen.js']) load(f);
load(path.basename(FLOW_FILE), fs.readFileSync(FLOW_FILE, 'utf8'));   // 产品那份，或红验那份副本
load('js/api.js');

const S = W.SR;
const F = S.flow;

const states = (r) => r.steps.map((s) => s.id + ':' + s.state).join('  ');
const stateOf = (r, id) => (F.at(r, id) || {}).state;

(async () => {
  console.log('流水线这一份：' + FLOW_FILE);
  console.log('');

  // ---------- ⓪ 尺子自检：先确认装进来的是真东西 ----------
  console.log('⓪ 尺子自检（这些不过，后面全是假绿）');
  judge('js/flow.js 装进来了，SR.flow 在', !!(F && F.start && F.staleAfter && F.plan), F && Object.keys(F));
  judge('★ 本机这份语料也装进来了（教材索引翻得动）', typeof S.findTextbook === 'function', typeof S.findTextbook);
  judge('★ 分数线不是 0（0 等于不卡线，会让"过没过线"这件事量不出来）',
    S.kb.cut('textbook') > 0 && S.kb.cut('zhuawen') > 0,
    { textbook: S.kb.cut('textbook'), zhuawen: S.kb.cut('zhuawen') });
  // ★★ 这一条是给下面「退回本机」那几条**定性**用的：node 里没有 SR.gate，
  //    所以"走本机"是**因为这台机器上没配云函数**，不是因为云上答错了。
  //    哪天有人把 gate.js 也装进来，下面那几条的含义就变了，这条会先红。
  judge('★ 这个探针里没有 SR.gate（所以下面"退回本机"是"没配云函数"那一档）',
    typeof S.gate === 'undefined', typeof S.gate);
  judge('★ 工位开关是产品自己那份（prep 会检索 / draw 不检索）',
    !!(S.WORKS.prep && S.WORKS.prep.retrieve) && !!(S.WORKS.draw && !S.WORKS.draw.retrieve),
    { prep: S.WORKS.prep && S.WORKS.prep.retrieve, draw: S.WORKS.draw && S.WORKS.draw.retrieve });

  // ---------- ① 这条流水线有哪几步 ----------
  console.log('\n① 一道题走一遍是几步，哪几步');
  // ★★ 下面这两张单子是**故意写死的**，不是抄产品报出来的东西。
  //   流水线多一步、少一步、改了顺序，都得有人在这儿改一次字——那个人才会停下来想
  //   "我动的是流水线"。红了的头一件事：看你刚才是不是自己加了一步。
  judge('★ 备课那条：七步，顺序是 凑话→翻教材→翻条目→翻资料库→拼提示词→模型→摆上台',
    JSON.stringify(F.plan('prep')) ===
      JSON.stringify(['recall', 'textbook', 'zhuawen', 'reslib', 'prompt', 'reply', 'paint']),
    F.plan('prep'));
  judge('★ 画图那条：短一截，四步（它压根不检索，画一条"好看的"七步流水线就是骗人）',
    JSON.stringify(F.plan('draw')) ===
      JSON.stringify(['recall', 'prompt', 'reply', 'paint']),
    F.plan('draw'));
  judge('工位名字不认识时不会炸，退回短的那条', Array.isArray(F.plan('这不是个工位')) && F.plan('这不是个工位').length === 4,
    F.plan('这不是个工位'));
  judge('★ 能重跑的就三步（翻教材、翻条目、翻资料库）——「凑话」和「拼提示词」的输入是定死的',
    F.plan('prep').filter((id) => F.STEPS[id].rerun).join(',') === 'textbook,zhuawen,reslib',
    F.plan('prep').filter((id) => F.STEPS[id].rerun));

  // ---------- ② 一步都没走的时候 ----------
  console.log('\n② 刚开一个回合：每一格都得是「还没走到」');
  F.reset();
  const r0 = F.start('prep', '我不会画数轴');
  judge('★ 新回合七格全是 wait', r0.steps.every((s) => s.state === 'wait'), states(r0));
  judge('进度 0/7', F.progress(r0).done === 0 && F.progress(r0).total === 7, F.progress(r0));
  judge('★ 每格都带得住出处（在哪儿跑 / 用谁的东西）——面板上那两颗标签就是它',
    r0.steps.every((s) => s.route && s.src), r0.steps.map((s) => s.route + '/' + s.src));
  F.done(r0, 'recall', { out: '我不会画数轴', note: '6 个字' });
  judge('★ 走完一格，进度报 1/7', F.progress(r0).done === 1, F.progress(r0));
  judge('★ 「凑话」那一步不能重跑（它的输入是定死的，重跑它没意义）',
    F.STEPS.recall.rerun !== true, F.STEPS.recall.rerun);

  // ---------- ③ 走一遍真检索：云上没有 → 退回本机 ----------
  console.log('\n③ 走一遍真检索（这台机器上没配云函数）');
  F.reset();
  const r = F.start('prep', '我不会画数轴');
  const hit = await F.retrieve(r, '我不会画数轴');
  judge('★ 翻教材那步：记的是「本机」，不是「云上」——答不上来就得当场改口',
    stateOf(r, 'textbook') === 'done' && F.at(r, 'textbook').route === '本机',
    { 状态: stateOf(r, 'textbook'), 出处: F.at(r, 'textbook') && F.at(r, 'textbook').route });
  judge('★ 那句"为什么退回来"写清楚了（面板上就是这么显示给你看的）',
    /没配云函数/.test(F.at(r, 'textbook').note), F.at(r, 'textbook').note);
  judge('★ 这句学生话一条都没过线，提示词里那一段就不出现（附注宁可空着也别塞错的）',
    hit.textbook === '' && /一条都没过分数线/.test(F.at(r, 'textbook').note),
    { 附注: hit.textbook, 说明: F.at(r, 'textbook').note });
  judge('★ 翻条目那步也跑完了，出处同样是「本机」',
    stateOf(r, 'zhuawen') === 'done' && F.at(r, 'zhuawen').route === '本机',
    { 状态: stateOf(r, 'zhuawen'), 出处: F.at(r, 'zhuawen') && F.at(r, 'zhuawen').route });
  judge('★ 这两步真翻出东西来了（不是"0 条候选"——那说明语料没装上）',
    !/一条候选都没有/.test(F.at(r, 'textbook').note) && !/一条候选都没有/.test(F.at(r, 'zhuawen').note),
    { 教材: F.at(r, 'textbook').note, 条目: F.at(r, 'zhuawen').note });
  judge('这一步的产物就是提示词里要附的那一段（记在账本上，看得见）',
    typeof F.at(r, 'textbook').out === 'string' && typeof F.at(r, 'zhuawen').out === 'string',
    { 教材: F.at(r, 'textbook').out.length, 条目: F.at(r, 'zhuawen').out.length });
  // ★★ 这一步跟上面两步**不一样**：教材和条目在公开站上没配云函数时能退回本机，
  //   资源库这一步**没有本机退路**（语料不进仓库、不上站，本机只有散着的 docx）。
  //   所以这里要钉的是两件相反的事：它**确实没翻到**（state=skip、out 是空的、
  //   提示词里那段不出现），而且它**没有偷偷退到本机**（route 仍写「云上」）。
  //   只验前一件的话，"悄悄退回本机翻了点什么"也照样绿。
  judge('★ 资源库那步：没有本机退路，拿不到就记「跳过了」——出处仍是「云上」，没偷偷退回本机',
    stateOf(r, 'reslib') === 'skip' && F.at(r, 'reslib').route === '云上',
    { 状态: stateOf(r, 'reslib'), 出处: F.at(r, 'reslib') && F.at(r, 'reslib').route });
  judge('★ 它跳过了，提示词里就**一个字**都不加（跳过的产物必须是空的）',
    F.at(r, 'reslib').out === '' && typeof F.at(r, 'reslib').note === 'string' && F.at(r, 'reslib').note.length > 0,
    { 产物字数: F.at(r, 'reslib').out.length, 说明: F.at(r, 'reslib').note });
  judge('★ 走完只有前三格亮着，资源库那格是「跳过」，模型那两步还没轮到',
    states(r) === 'recall:done  textbook:done  zhuawen:done  reslib:skip  prompt:wait  reply:wait  paint:wait', states(r));
  judge('★ 记下了这一回合用的那句话（重跑那两步的输入就是它）',
    r.query === '我不会画数轴', r.query);

  // 到了这一步，把后面三步也标成走完，好验重跑。
  // ★ 进度只数 done，skip 不进这个数——所以走到底这里报的是 6/7，不是 7/7。
  //   这不是缺陷：那一格本来就是"没走"，把它算成"走完了"才是骗人。
  F.done(r, 'prompt', { out: '（提示词全文）', note: '1234 个字' });
  F.done(r, 'reply', { out: '（模型回的话）' });
  F.paintDone('链子、围栏、图、台阶都摆完了');
  judge('★ 走到头：六个 done、一格 skip，进度 6/7（skip 不算走完）',
    F.progress(r).done === 6 && F.progress(r).total === 7 && states(r).indexOf('wait') < 0,
    F.progress(r));

  // ---------- ④ ★★ 重跑：只动它和它下游 ----------
  console.log('\n④ ★★ 重跑一步：前面几步一个字不动，下游标成「得重来」');
  const n = F.staleAfter(r, 'textbook');
  judge('★ 重跑「翻教材」：凑话和它自己**仍是 done**（这一条就是全部）',
    stateOf(r, 'recall') === 'done' && stateOf(r, 'textbook') === 'done', states(r));
  judge('★ 它下游那几步全变成 stale',
    stateOf(r, 'prompt') === 'stale' && stateOf(r, 'reply') === 'stale' && stateOf(r, 'paint') === 'stale', states(r));
  // ★ 数的是 5：翻条目 / 翻资料库 / 拼提示词 / 模型 / 摆上台。
  //   资源库那格本来是 skip（**不是 wait**）——所以它也在这 5 里，被一起标脏。
  //   这一条同时钉住了 skip 的归属：跳过的一格在下游时照样得重来，
  //   不然重跑「翻教材」之后，面板上留着一块**上一轮的**旧资料库产物没人清。
  judge('★ 报出来的数是"它下游现在有几格得重来"=5：翻条目 / 翻资料库 / 拼提示词 / 模型 / 摆上台',
    n === 5, n);
  judge('★ 这一回合被标脏了（面板会在底下挂一句"拿新的重问一轮"）', r.stale === true, r.stale);
  const n2 = F.staleAfter(r, 'recall');
  judge('★ 重跑「凑话」：下游六步全 stale，一个不留',
    n2 === 6 && states(r) === 'recall:done  textbook:stale  zhuawen:stale  reslib:stale  prompt:stale  reply:stale  paint:stale',
    { n: n2, states: states(r) });
  // ★★ 这条是**回填过的缺陷**：原来写的是"不是终态就恢复成 wait"，于是连点两次重跑时，
  //   第一次标脏的那几格第二次会被降成「还没走到」——面板上那几格说着"没跑过"，
  //   底下那句提示还在说"得重问一次才作数"；更要紧的是「重跑」按钮只在终态出现，
  //   降成 wait 之后按钮就没了，那一步再也点不动。所以这里钉住"再点一次还是 stale"。
  const n3 = F.staleAfter(r, 'recall');
  judge('★ 再点一次同一颗重跑：已经标脏的那几格**仍是 stale**，不会被降成「还没走到」',
    n3 === 6 && states(r).indexOf(':wait') < 0, { n: n3, states: states(r) });

  // ---------- ⑤ 重跑的实际动作（不是只标状态） ----------
  console.log('\n⑤ 按下「重跑」之后真发生的事');
  F.reset();
  const r2 = F.start('prep', '为什么负负得正');
  await F.retrieve(r2, '为什么负负得正');
  F.done(r2, 'prompt', { out: 'x' }); F.done(r2, 'reply', { out: 'y' }); F.paintDone('摆完了');
  const again = await F.rerun(r2, 'textbook');
  judge('★ 重跑拿的是**这一回合原来那句话**（不是空的——空的重算照样绿，最难查）',
    r2.query === '为什么负负得正' && again && typeof again.text === 'string',
    { query: r2.query, 拿到了: !!again });
  judge('★ 重跑完，它自己 done、下游 stale',
    stateOf(r2, 'textbook') === 'done' && stateOf(r2, 'prompt') === 'stale', states(r2));
  judge('★ 不能重跑的那一步（凑话）按下去返回 null，什么都不动',
    (await F.rerun(r2, 'recall')) === null && stateOf(r2, 'recall') === 'done', states(r2));
  // ★★ 这条防的是"白搭一次云函数往返"：画图那条路线里压根没有 textbook 这一格。
  F.reset();
  const r3 = F.start('draw', '画个数轴');
  judge('★ 这一回合里没有的那一步，按重跑直接返回 null —— **一个请求都不发**',
    (await F.rerun(r3, 'textbook')) === null && !F.at(r3, 'textbook'), states(r3));
  const hit3 = await F.retrieve(r3, '画个数轴');
  judge('★ 短路线的回合走一遍检索：两段附注都是空，而且不会凭空长出 search 那两格',
    hit3.textbook === '' && hit3.zhuawen === '' && r3.steps.length === 4, states(r3));

  // ---------- ⑥ 两份会漂的东西：附注拼法 ----------
  console.log('\n⑥ 同一段附注，流水线这份和 api.js 那份算出来是不是一字不差');
  // ★ 这两份必须逐字相同：分数线（过不过线）在这两条里起作用，
  //   而"给不给这条附注"正是最容易改歪的地方。两份漂了，表现为"同样是这句话，
  //   走本机那条路和走云上那条路，附注不一样"——没人会往这里想。
  const QUERIES = ['我不会画数轴', '为什么负负得正', '一元一次方程怎么移项',
    '苏科版 七上 2.2 数轴', '四分位数和箱线图'];
  let same = 0;
  for (const q of QUERIES) {
    const got = await F.oneKb('textbook', q, 2);
    const mine = F.pickTextbook(got.hits, S.kb.cut('textbook'));
    const theirs = S.api.pickTextbook(q, 2);
    if (mine === theirs) same++;
    else {
      console.log('    ✗ ' + q);
      console.log('      流水线：' + JSON.stringify(String(mine).slice(0, 90)));
      console.log('      api.js：' + JSON.stringify(String(theirs).slice(0, 90)));
    }
  }
  judge('★ 五句话上两份附注逐字一样（' + same + '/' + QUERIES.length + '）', same === QUERIES.length, { 一样: same });
  judge('★ 这五句里**有翻到的也有没翻到的**（不然上面那条等于在比两个空串）',
    QUERIES.some((q) => S.api.pickTextbook(q, 2) !== '') && QUERIES.some((q) => S.api.pickTextbook(q, 2) === ''),
    QUERIES.map((q) => q + ':' + (S.api.pickTextbook(q, 2) ? '有' : '空')));
  // 追问条目只给一条：第二条再好也不能冒出来
  judge('★ 追问条目只给第一条（给多条模型就会挑一条照搬，回复立刻千篇一律）',
    F.pickZhuawen([{ score: 99, text: 'A' }, { score: 98, text: 'B' }], 10) === 'A',
    F.pickZhuawen([{ score: 99, text: 'A' }, { score: 98, text: 'B' }], 10));
  judge('★ 第一条没过线就整段不给，哪怕第二条过线了',
    F.pickZhuawen([{ score: 9, text: 'A' }, { score: 20, text: 'B' }], 10) === '',
    F.pickZhuawen([{ score: 9, text: 'A' }, { score: 20, text: 'B' }], 10));
  judge('★ 翻到的条数按分数线卡（不是"有几条给几条"）',
    F.pickTextbook([{ score: 7, text: 'A' }, { score: 5, text: 'B' }], 6) === 'A',
    F.pickTextbook([{ score: 7, text: 'A' }, { score: 5, text: 'B' }], 6));

  // ---------- ⑦ 这一步不许碰网络 ----------
  console.log('\n⑦ 检索这一步不该走网络（配了云函数才走）');
  const realFetch = global.fetch;
  global.fetch = () => { throw new Error('这一步不该发请求'); };
  let threw = null;
  try {
    F.reset();
    const r4 = F.start('prep', '第二题');
    await F.retrieve(r4, '第二题');
    judge('★ 把全局 fetch 拆掉，检索照样跑完（说明它没在偷偷发请求）',
      stateOf(r4, 'textbook') === 'done' && stateOf(r4, 'zhuawen') === 'done', states(r4));
  } catch (e) { threw = e; }
  judge('★ 拆掉 fetch 之后没有异常漏出来', !threw, threw && threw.message);
  global.fetch = realFetch;

  // ---------- ⑧ 边界：没 DOM、回合数够多 ----------
  console.log('\n⑧ 两条边界');
  // ★ 探针里没有 #flowlist，render() 必须静默——它每改一格都调一次，
  //   抛一次整条流水线就断了，而"抛"和"没抛"在屏幕上长得一样（都看不到东西）。
  let renderThrew = null;
  try { F.render(); } catch (e) { renderThrew = e; }
  judge('★ 没有那块 DOM 时 render() 不抛（探针里就没有）', !renderThrew, renderThrew && renderThrew.message);
  F.reset();
  for (let i = 0; i < 35; i++) F.start('prep', '第' + i + '句');
  judge('★ 留最近 30 轮，多的从头上挤掉（这是"看得见"用的，不是存档）',
    F.list().length === 30 && F.list()[0].n === 6, { 轮数: F.list().length, 最旧那轮: F.list()[0] && F.list()[0].n });
  judge('★ cur() 拿到的是最近开的那个（同一时刻只有一个回合在跑）',
    F.cur() === F.list()[F.list().length - 1], F.cur() && F.cur().n);
  judge('★ 空账本时 cur() 回 null，不炸', (function () { F.reset(); const c = F.cur(); F.start('prep', 'x'); return c === null; })());

  // ---------- ⑨ 那几块材料的短名（整条路径不进提示词） ----------
  // ★★ 为什么非量不可：库里存的题名是**整个文件路径**，7706 条平均 103 字、
  //   最长 184 字，而且条条开头都重复一遍 `[宜兴东氿中学]`。三条命中就是三百多字，
  //   白占提示词额度，面板上人也读不动。所以改成"只摆末段"（平均 35 字）。
  //   而这件事坏掉的样子**看不出来**：路径又长回去了，只是"额度悄悄多花一点"，
  //   屏幕上没有任何一行会说不对。所以在这儿钉死。
  console.log('\n⑨ 那几块材料的短名：整条路径不许进提示词');
  const 长路径 = '宜兴东氿中学/13-学科网素材/专题 1.2（3） 一元二次方程的解法（公式法）/（解析版）.docx';
  judge('★ 给一条完整路径，只取最后一段',
    F.shortName({ doc: 长路径 }) === '（解析版）.docx', F.shortName({ doc: 长路径 }));
  judge('★ 反斜杠的路径也认得（Windows 那份真的可能是反斜杠）',
    F.shortName({ doc: 'A\\B\\C\\专题01 有理数.docx' }) === '专题01 有理数.docx',
    F.shortName({ doc: 'A\\B\\C\\专题01 有理数.docx' }));
  judge('★ doc 优先于 title —— title 前面那句「[宜兴东氿中学] 」是冗余的（shelf 另有一个字段）',
    F.shortName({ doc: 'x/y/真名.docx', title: '[宜兴东氿中学] x/y/真名.docx' }) === '真名.docx',
    F.shortName({ doc: 'x/y/真名.docx', title: '[宜兴东氿中学] x/y/真名.docx' }));
  judge('没有 doc 时退回 title，也不炸', F.shortName({ title: 'p/q/名.docx' }) === '名.docx',
    F.shortName({ title: 'p/q/名.docx' }));
  judge('什么都没有时回「（没名字）」，不扔异常', F.shortName({}) === '（没名字）', F.shortName({}));

  // 拼出来的那段正文里，〔n〕后面跟的必须是短名，整条路径不许出现
  const 假命中 = [{ doc: 长路径, title: '[宜兴东氿中学] ' + 长路径, score: 20.5, body: '甲'.repeat(50) },
                  { doc: '宜兴东氿中学/教案/第2章 有理数 教案.docx', score: 18.25, body: '乙'.repeat(50) }];
  const 拼的 = F.pluckRes(假命中);
  judge('★ 拼出来的正文里，整条路径一个字都没有',
    拼的.text.indexOf('宜兴东氿中学/13-学科网素材') < 0 && 拼的.text.indexOf('[宜兴东氿中学]') < 0,
    拼的.text.slice(0, 120));
  judge('★ 〔n〕后面跟的是短名',
    拼的.text.indexOf('〔1〕（解析版）.docx') === 0 && 拼的.text.indexOf('〔2〕第2章 有理数 教案.docx') > 0,
    拼的.text.split('\n').filter((x) => x.indexOf('〔') === 0));
  judge('★ 面板那一行的候选名也是短名（不然面板上读的还是一整条路径）',
    F.resNote({ hits: 假命中, why: '' }).indexOf('宜兴东氿中学/13-') < 0 &&
    F.resNote({ hits: 假命中, why: '' }).indexOf('「（解析版）.docx」20.50') > 0,
    F.resNote({ hits: 假命中, why: '' }));
  // ★★ 这一条是防"出处名单照 hits 全抄"的：命中五条、预算只吃得下两条时，
  //   used 必须只有那两条。照 hits 全抄会摆出"这几块都进了提示词"的假象，
  //   而那几块里的正文**一个字都没发给模型**——又一个"数字不是它宣称的那件事"。
  const 大命中 = [0, 1, 2, 3, 4].map((i) => ({
    doc: 'd/' + i + '.docx', title: 'd/' + i + '.docx', score: 30 - i, body: '丙'.repeat(900)
  }));
  const 挤过 = F.pluckRes(大命中);
  judge('★ 命中五条、预算只吃得下两条时，出处名单只有那两条（不照 hits 全抄）',
    挤过.used.length === 2 && 挤过.used.every((h) => h.body.length === 900) &&
    挤过.used[0].doc === 'd/0.docx' && 挤过.used[1].doc === 'd/1.docx',
    { 进了几条: 挤过.used.map((h) => h.doc), 正文长度: 挤过.text.length });
  // ★ 这条是把上面那条的"反面"钉住：预算够的时候不许再少给人。
  judge('★ 预算够的时候，命中几条就进几条（上面那条不是靠"永远只给两条"混过去的）',
    F.pluckRes([{ doc: 'd/0.docx', score: 9, body: '短' },
                { doc: 'd/1.docx', score: 8, body: '短' }]).used.length === 2,
    F.pluckRes([{ doc: 'd/0.docx', score: 9, body: '短' },
                { doc: 'd/1.docx', score: 8, body: '短' }]).used.length);

  console.log('');
  console.log('跑了 ' + ran + ' 条，红的 ' + bad + ' 条。');
  console.log('★ 这道哨兵只保证"账本自己说的是同一件事"。**它保证不了这条流水线分得对不对**——');
  console.log('  步骤该不该这么切、步名该叫什么，那是你在真实一轮里才看得出来的事。');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('探针自己挂了：' + ((e && e.message) || e)); process.exit(1); });

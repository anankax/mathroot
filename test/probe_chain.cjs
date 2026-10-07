// 备课这条链子的验收：给它一道题，它会不会**一节一节**摆出那条链子？
//
// ★ 2026-10-02 新写（第一版同日作废）。旧那套量的是"五节是不是摆对了"——
//   而五节那套 2026-10-02 已经拆了（孔老师：「被你的 12345 卡死了」）。现在量的是：
//
//   ① 几路   —— **第一轮先给错法清单**（不是链子），每条是**学生的原话**，
//                不是老师的问句（"你当时是怎么想的"那种）。这是本轮改动的**主命题**：
//                "学生的刁难"到底有没有被真的生成出来。
//   ② 一节   —— 一轮恰好一节（一轮只摆一节是镣铐），三行齐、行名一字不差。
//   ③ 递增   —— 轮间节号**递增**（**不强制 +1**：步数由题目定，跳号允许）。
//                读不出来时**原地不动**，绝不许掉回第 1 节。
//   ④ 不多嘴 —— 除了那四行没有别的话（尤其不许问"要不要继续"）。
//   ⑤ 不抄示范 —— 链子里没有原样搬提示词里那段示范（同 SR.EXAMPLE_CHIPS）。
//   ⑥ 台阶条只增不减 —— 走的是产品里真用的 SR.absorbChain（不是这里另写一套）。
//   ⑦ 整条不截断 —— 收尾那轮一次摆完，末节是不是还在（MAX_TOKENS 只有 1024）。
//
// 走的是页面里真真正正的 SR.api.ask（降级链、按 token 裁历史都在里面），不是另搭一套。
//
// 用法:
//   node test/probe_chain.cjs [轮数] [后端] [题目]     走一遍全流程（含收尾"整条"）
//   node test/probe_chain.cjs routes [次数] [后端]      **只采样第一轮**，量"几路"的命中率
// 例:
//   node test/probe_chain.cjs 3 glm
//   node test/probe_chain.cjs routes 8 glm
// ⚠ 要联网、**要花额度**（glm 免费通道那颗是免费的，DeepSeek 花老师自己的 Key）。
//   纯函数那一层不用钱也不用网，走 test/probe_plan.cjs。
const path = require('path'), fs = require('fs'), os = require('os');

// ---- 把数根那几个 js 原样装进来（跟浏览器同一个 window 形状）----
const store = {};
const LS = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const W = { SR: {} };
// ★ 2026-10-06（整改①）：加了 'prompt-base.js'。① 之后每格发出去的提示词都以底座开头
//   （js/api.js 的 buildSystem 第一行拼上去），不装它，这个 Node 装出来的就是
//   "拆完、但没拼底座"的那一份，跟线上真发的不是同一份 —— 读数会条条都对、
//   量的却是另一个东西。[[scanner-numbers-are-not-what-they-claim]]
for (const f of ['config.js', 'prompt-base.js', 'prompt-prep.js', 'textbook.js', 'retrieve.js', 'zhuawen.js', 'api.js', 'render.js', 'chips.js']) {
  // ⚠ 前面补一句 `var SR = window.SR`：浏览器里这些文件共用页面那个全局 SR，
  //   可 chips.js 是直接写 `SR.CHIPS = …`、自己没声明——在 node 的假 window 里
  //   它就是个未定义变量，一跑就 ReferenceError。（跟 probe_fence.cjs 同一个坑。）
  try {
    new Function('window', 'localStorage', 'navigator',
      'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
  } catch (e) { console.log('装 ' + f + ' 炸了：' + e.message); }
}
const SR = W.SR;

const DS_KEY = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))
  .env.ANTHROPIC_AUTH_TOKEN;

const MODE = process.argv[2] === 'routes' ? 'routes' : 'walk';
const TURNS = MODE === 'routes' ? Number(process.argv[3] || 8) : Number(process.argv[2] || 3);
const BACKEND = MODE === 'routes' ? (process.argv[4] || 'glm') : (process.argv[3] || 'glm');
// ★ 默认用一道**真有坎**的题（"只算出一个答案"是这道题的典型翻车），
//   别拿"数轴上 -3 到原点的距离"那种一句话就完的题去测——那种题本来就没有链子可摆，
//   摆出来薄，看不出是提示词不行还是题不行。
const ASK = process.argv[MODE === 'routes' ? 5 : 4] || '数轴上点 A 表示 -2，点 B 表示的数是 x，AB = 5，求 x。';

if (BACKEND === 'glm' && !SR.GLM_KEY) { console.error('config.js 里没有 GLM_KEY，先跑 node test/inject_key.cjs'); process.exit(1); }
SR.api.setBackend(BACKEND);
SR.api.setKey(DS_KEY);

const b = SR.api.backend();
const w = SR.WORKS.prep;
const SYS = (b.promptProfile === 'lean' && w.lean ? w.lean() : w.prompt())
          + '\n\n---\n\n' + SR.PROMPT_PREP_TAIL;
// ★★ 2026-10-02 改：这一行原来写「提示词 N 字符（含收尾块）」，可那个 N 是**这里自己
//   拿 prompt()+TAIL 拼出来的估算**——它算漏了 api.js 按轮次现挂的教材索引、追问条目库、
//   以及第一轮那段「几路」附注。也就是说，量具报的数字不是它宣称的那件事
//   （同族第七次）。现在开头只报"正文有多长"，**真发出去的长度**每轮实测后另打一行。
console.log('后端 ' + b.id + '  档 ' + b.promptProfile + '  正文+收尾块 ' + SYS.length +
  ' 字符（不含按轮次现挂的教材索引／追问库／几路附注——真长度看每一轮那行 [system N]）');
console.log('题目 ' + JSON.stringify(ASK) + '\n');

// ---- 一节的形状判据 ----
// ★ 行的名字必须**逐字**对：提示词里就是这么规定的，模型少一个字（"学生会说："）就算没守形状。
const LINE = {
  stu: /^学生大概会说[：:]/,
  you: /^你接这句[：:]/,
  why: /^这么接的道理[：:]/,
  // ★★ 2026-10-02 放宽：节号不再限于 1–5，**名字也不再校验**——名字正是放开给模型自己起的那部分。
  //   剩下两样是镣铐：`第` + `阿拉伯数字` + `节` + `·`。名字一个字符都不管。
  //   （名字不许同名之类的，由 SR.parseChain 那一层量，见 test/probe_plan.cjs。）
  //
  // ★★ 行首那点 markdown 壳**必须吃掉**。真 glm 写的是 `### 第 1 节 · 展开括号`——产品那边
  //   （chips.js 的 RE_STEP 不锚行首，且 cleanName 会剥壳）**认得出来**，台阶条也照常长格子；
  //   可这把尺子锚在行首，`### ` 一挡就全部读成"没写节标题"，
  //   还把那些标题行统统算进"多出来的话"（一轮 11 句）。**尺子比产品窄，报的全是假警报**
  //   （同族教训：脚本的数字不是它宣称的那件事）。
  // ★★ 2026-10-02：单位从「节」改成「环节」之后，**这把尺子也要两套都认**，
  //   不然模型一换写法，这里报的就是"没写节标题"——**尺子比产品窄，全是假警报**。
  //   ⚠ 这里的量词跟 js/chips.js 的 UNIT 是**同一件事**，但**不能共用那个变量**
  //     （尺子要能独立于产品跑）。改一边就核另一边，别让它们分叉。
  head: /^[\s>#*\-·]*第\s*([0-9]+)\s*(?:个?\s*环节|节)\s*[·・.]\s*(\S.*?)\s*[*#\s]*$/
};
// 「学生大概会说」里出现这些 = 写成**老师问学生的话**了。那是这一轮改动的核心毛病。
// ★ 故意做窄：只认第二人称问句的引子。"他把两个条件看反了"这种第三人称陈述不算错。
const TEACHER_ASK = /你当时|你是怎么|你刚才|你有没有|你分的时候|你读的时候|你算的时候/;
// 几路那几行长这样：`① 学生大概会说：…` / `1. …` / `- …`
const ROUTE_LINE = /^(?:[①-⑥]|\d+\s*[.、)]|[-*])\s*(?:学生大概会说[：:])?\s*(.*)$/;
// 结尾多问的那一句。★ 故意做窄：只认**直接对老师开口**的引子，别把正文里的
// "你想从哪一路开始"这种普通句子也算进去（尺子放宽了，报出来就是假警报）。
const CLOSING_ASK = /老师[，,、]?\s*(请|您|你|要不要)|要不要继续|请选择|请挑一?[路条道]/;

function parse(t) {
  const lines = String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
  const head = lines.find(l => LINE.head.test(l)) || '';
  const m = LINE.head.exec(head);
  return {
    lines,
    headLine: head,
    step: m ? +m[1] : 0,
    named: m ? m[2] : '',
    // 只算"链子那四行"占了几行：节标题 + 三个字段
    body: lines.filter(l => LINE.head.test(l) || LINE.stu.test(l) || LINE.you.test(l) || LINE.why.test(l)),
    extra: lines.filter(l => !(LINE.head.test(l) || LINE.stu.test(l) || LINE.you.test(l) || LINE.why.test(l))),
    stu: (lines.find(l => LINE.stu.test(l)) || '').replace(LINE.stu, '').trim(),
    you: (lines.find(l => LINE.you.test(l)) || '').replace(LINE.you, '').trim(),
    why: (lines.find(l => LINE.why.test(l)) || '').replace(LINE.why, '').trim()
  };
}

// 抄没抄示范：整句 + "六字雷同"。★ 口径跟 chips.js 的 filterCopiedChips 一致
// （连「」一起抹掉），别在这儿另写一个——那正是"改一处忘一处"。
const mood = t => String(t || '').replace(/[\s，。、,.!！?？…—·:：;；"'“”‘’()（）\[\]【】「」]/g, '');
const grams = SR.EXAMPLE_CHIPS.map(mood).reduce((a, c) => {
  for (let i = 0; i + 6 <= c.length; i++) a[c.slice(i, i + 6)] = 1;
  return a;
}, {});
function copied(h) {
  const n = mood(h);
  for (let i = 0; i + 6 <= n.length; i++) if (grams[n.slice(i, i + 6)]) return true;
  return false;
}

// ============================================================
//  尺子自检 —— 这两把尺子今天各错过一次，错了报出来的全是假警报，
//  所以**在联网花额度之前**先拿已知答案的字符串验一遍。任一不过就退出。
// ============================================================
(function () {
  const bad = [];
  const H = s => LINE.head.exec(s);
  // ① 行首 markdown 壳：产品认，尺子以前不认
  const a = H('### 第 1 节 · 展开括号');
  if (!a || a[1] !== '1' || a[2] !== '展开括号') bad.push('认不出 `### 第 1 节 · 展开括号`');
  const b2 = H('**第 2 节 · 换个台阶**');
  if (!b2 || b2[1] !== '2' || b2[2] !== '换个台阶') bad.push('认不出带 `**` 的节标题，或名字没剥干净');
  // ② 负对照：不该被认成节标题的两行
  if (H('第 3 节车厢那句话不用管')) bad.push('把"第 3 节车厢"认成了节标题');
  if (H('我打算第 1 节先让他复述')) bad.push('把计划描述认成了节标题');
  // ③ teacherAsks 只审学生那一行
  if (teacherAsks('- 你接这句：你是怎么乘的？3 乘 x 是多少？').length) bad.push('把「你接这句」那行当成学生的错话报了假警报');
  if (teacherAsks('你接这句：你是怎么移动 x+5 这一项的？').length) bad.push('没带项目符号的「你接这句」也漏过去了');
  if (teacherAsks('1. 你当时是怎么读这道题的？').length !== 1) bad.push('学生那一行真写成老师问句时反倒漏报');
  if (bad.length) {
    console.log('★★★ 尺子自己坏了 —— 下面的结果**一条都别信**，先修 test/probe_chain.cjs：');
    bad.forEach(x => console.log('   · ' + x));
    process.exit(2);
  }
})();

// 跑一轮。★ st 是**产品里真用的那个**台阶条状态（SR.absorbChain），不是这里另写的一套。
async function turn(hist, text, st) {
  const t0 = Date.now();
  const res = await SR.api.ask({ work: 'prep', history: hist.slice(), text,
    onChunk: () => {}, onNotice: () => {} });
  const ms = Date.now() - t0;
  // ★ 真发出去的那段 system 有多长——**在 await 之后立刻取**：api.js 每轮都覆盖它，
  //   晚了就变成下一轮的数（这个探针是串行的，所以这里不会串味）。
  const sysLen = (SR.api.lastSystem || '').length;
  if (res.error) return { ok: false, res, ms, sysLen };
  hist.push({ role: 'user', content: SR.api.userContent(text, []) });
  hist.push({ role: 'assistant', content: res.text });
  const grew = st.slots.length;
  SR.absorbChain(st, String(res.text || ''));            // ← 产品里真用的那一段
  const nowAt = SR.inferStep({ prevAssistant: String(res.text || '') });
  if (nowAt) st.now = nowAt;                             // 读不出来 = 原地不动
  return { ok: true, res, ms, sysLen, grew: st.slots.length - grew };
}

// 几路那几行里，有没有混进"老师的问句"
//
// ★★ 2026-10-02 加了两道排除，都是拿真回复量出来才发现的：
//   ① 模型经常把三行一块写在每条路底下（`- 你接这句：你是怎么乘的？…`）。
//      那两行**本来就该是老师的话**，扫进来报"学生的话写成了老师的问句"是**假警报**
//      ——这条判据问的是**学生那一行**，只有 `学生大概会说` 那一行（或没写行名、直接写
//      一句学生话的那种）才该受审。
//   ② 判据本身（TEACHER_ASK）只认第二人称问句的引子，别放宽。
function teacherAsks(text) {
  const out = [];
  String(text || '').split('\n').forEach(l => {
    const s = l.trim();
    // 这一行是"你接这句 / 这么接的道理"（带不带项目符号都算）——跳过，它们该是老师的话
    if (/^(?:[①-⑥]|\d+\s*[.、)]|[-*·•]|[\s>#])*\s*(?:你接这句|这么接的道理)\s*[：:]/.test(s)) return;
    const m = ROUTE_LINE.exec(s);
    if (!m) return;
    const body = m[1].trim();
    if (!body) return;
    if (TEACHER_ASK.test(body)) out.push(body);
  });
  return out;
}

(async () => {
  // ============================================================
  //  routes 模式：只量第一轮，"几路"到底有没有给出来
  // ============================================================
  // ★ 一次不算数：这条改动是"额外加了一层义务"，而小模型一次只服从得了一件事，
  //   命中率必须采样 8–10 次才看得见真面目（一两次的差别只是抖动）。
  if (MODE === 'routes') {
    // ★★ 2026-10-02 修：这五个计数器原来有两处名不副实——
    //   ① 「路数里是学生的话」那一行数的其实是 okAll（四条全对），名和数对不上；
    //   ② 更要紧的是 `asks` 当时写成 `hasRoute ? teacherAsks(...) : []`：
    //      **没给出几路的那几次，干脆就不查有没有混进老师的问句了**，
    //      于是那一行的分母看着是 8，实际只在"给了几路"的那几次里成立。
    //      （同族教训：脚本的数字不是它宣称的那件事。）现在各数各的，
    //      一行只回答一件事，分母都是 n。
    let hit = 0, planned = 0, noChain = 0, stuVoice = 0, quiet = 0, allOk = 0, failed = 0, n = 0;
    for (let i = 0; i < TURNS; i++) {
      const r = await turn([], ASK, SR.chainState());
      if (!r.ok) { failed++; console.log('第 ' + (i + 1) + ' 次失败：' + r.res.error); continue; }
      n++;
      const pc = SR.parseChain(r.res.text);
      const hasRoute = pc.routeCount >= 2;
      const asks = teacherAsks(r.res.text);
      const nosey = CLOSING_ASK.test(String(r.res.text));
      const okAll = hasRoute && !asks.length && !pc.steps.length && !nosey;
      if (hasRoute) hit++;
      if (pc.planCount) planned++;
      if (!pc.steps.length) noChain++;
      if (!asks.length) stuVoice++;
      if (!nosey) quiet++;
      if (okAll) allOk++;
      console.log((okAll ? '✓' : '✗') + ' 第 ' + (i + 1) + ' 次 · ' + r.ms + 'ms · ' + r.res.model +
        ' · 读到 ' + pc.routeCount + ' 路，计划 ' + (pc.planCount || '没报') + '，链子 ' + pc.steps.length + ' 节' +
        ' · [system ' + r.sysLen + ']');
      if (!hasRoute) console.log('    ⚠ 没给出几路');
      if (asks.length) console.log('    ⚠ 路数里那句像是**老师问学生的话**：' + JSON.stringify(asks));
      if (pc.steps.length) console.log('    ⚠ 这一轮不该摆链子，它摆了 ' + pc.steps.length + ' 节');
      // ★ 2026-10-02 加：这一轮该"摆完就停"（镣铐里那条"不多嘴"）。实测 1/8 结尾会多问一句
      //   「老师，请选择你想从哪一路开始。」——请求挑路**正是这一轮的目的**，所以它不算错话；
      //   但它是一句**额外的话**，提示词明写"摆完就停"。列出来让人判，不直接算失败。
      if (nosey) console.log('    ⚠ 结尾多问了一句（这一轮该摆完就停）');
      console.log('    ── 原文 ──');
      console.log(String(r.res.text).split('\n').map(x => '    ' + x).join('\n'));
      console.log('');
    }
    console.log('===== ' + BACKEND + ' 上采样 ' + n + ' 次（失败 ' + failed + '）=====');
    console.log('  给出几路（≥2 条）                    ' + hit + ' / ' + n);
    console.log('  顺带报了"大概几节"                   ' + planned + ' / ' + n);
    console.log('  这一轮**没**乱摆链子                 ' + noChain + ' / ' + n);
    console.log('  路数里没混进老师的问句               ' + stuVoice + ' / ' + n);
    console.log('  摆完就停（结尾没多问一句）           ' + quiet + ' / ' + n);
    console.log('  四条都对                             ' + allOk + ' / ' + n + '   ← ★ 合起来看，别只看单行');
    console.log('');
    console.log('★ 这是**待判清单**，不是分数。原文都在上面，红了先看原话再下结论。');
    console.log('★ 命中率低不等于提示词错：先看它这一轮**实际给了什么**——给了别的东西也算没过。');
    process.exit(0);
  }

  // ============================================================
  //  walk 模式：几路 → 一节一节 → 整条
  // ============================================================
  const hist = [];
  const st = SR.chainState();
  const rows = [];
  let last = ASK;

  for (let i = 0; i <= TURNS; i++) {
    const closing = (i === TURNS);                       // 最后一轮要"整条"
    const say = closing ? '整条链子从头到尾摆一遍，我拷走。' : last;
    const r = await turn(hist, say, st);
    if (!r.ok) { console.log('第 ' + (i + 1) + ' 轮失败：' + r.res.error); break; }
    const p = r.p = parse(r.res.text);
    const pc = SR.parseChain(r.res.text);
    const chips = SR.fallbackChips({ work: 'prep', first: i === 0, lastUser: say, prevAssistant: r.res.text });
    const snap = { slots: st.slots.map(s => ({ n: s.n, name: s.name })), plan: st.plan, now: st.now };
    rows.push({ i, closing, ms: r.ms, model: r.res.model, p, pc, st: snap, chips, grew: r.grew });

    const tag = closing ? '收尾·整条' : ('第 ' + (i + 1) + ' 轮');
    console.log('— ' + tag + ' · 我说的是「' + say.slice(0, 20) + '」 · ' + r.ms + 'ms · ' + r.res.model);
    if (i === 0) console.log('  几路     ' + pc.routeCount + ' 路，计划 ' + (pc.planCount || '没报') + ' 节');
    console.log('  节标题   ' + (p.headLine || '(没写)') + '   → 读出来是第 ' + p.step + ' 节，台阶条判 ' + st.now);
    console.log('  四行     ' + p.body.length + ' 行   ' + (p.stu ? '学生✓ ' : '学生✗ ') + (p.you ? '你接✓ ' : '你接✗ ') + (p.why ? '道理✓ ' : '道理✗ '));
    console.log('  学生说   ' + (p.stu || '(空)'));
    console.log('  你接这句 ' + (p.you || '(空)'));
    console.log('  道理     ' + (p.why || '(空)'));
    console.log('  台阶条   槽位 ' + st.slots.map(s => s.n).join(',') + '（这轮新长 ' + r.grew + ' 格）/ 预排 ' + st.plan + ' 格 / 停在第 ' + st.now + ' 节');
    if (p.extra.length) console.log('  ⚠ 多出来的话 ' + JSON.stringify(p.extra));
    if (copied(p.body.join(''))) console.log('  ⚠ 抄了提示词里的示范');
    console.log('  按钮     ' + chips.join(' ／ '));
    // ★★ 2026-10-02 补：**原文必须打出来**。原来只有 routes 模式打原文，walk 模式只打摘要
    //   ——于是我这边出现过一次判不了的场面：它一轮摆了 3 节，摘要只说"一轮摆了 3 节"，
    //   可是"它为什么摆了 3 节、是不是把某一步拆成了三个标题"从摘要里看不出来，
    //   而**判不了就得重跑一次**（要联网、要花额度）。摘要是我写的、原文是它写的，
    //   判据永远只能下在原文上。
    console.log('  ── 原文 ──');
    console.log(String(r.res.text).split('\n').map(x => '  │ ' + x).join('\n'));
    console.log('');
    last = '接着往下摆';
  }

  // ---- 判据（打印，不打分）----
  // ★ 这里**只列待判清单**，不算"得几分"：同一条回复可以既是"节号对了"又是"多了一句话"。
  const bad = [];
  let prevStep = 0, prevSlots = 0, prevPlan = 0;
  rows.forEach(r => {
    const tag = r.i === 0 ? '第 1 轮' : (r.closing ? '收尾·整条' : '第 ' + (r.i + 1) + ' 轮');

    if (r.i === 0) {
      // ① 几路：第一轮该给错法清单，而且每条是**学生的话**
      if (r.pc.routeCount < 2) bad.push(tag + '：第一轮没给出几路（读到 ' + r.pc.routeCount + ' 路）——看上面原文它到底给了什么');
      if (r.pc.steps.length) bad.push(tag + '：第一轮就摆了 ' + r.pc.steps.length + ' 节链子，几路那轮不该摆（提示词：先别摆第一节）');
      // ★ 主命题：几路里那几句"学生的话"是不是**学生**说的。老师的问句混进来，
      //   就是诊断二说的那个老毛病（拿追问库去喂学生的嘴）。
      teacherAsks(r.p.lines.join('\n')).forEach(x =>
        bad.push(tag + '：几路里这句像是**老师问学生的话**，不是学生自己说错的话 —— 「' + x.slice(0, 30) + '」'));
    } else if (r.closing) {
      // ⑦ 整条：一次摆完，末节还在不在（MAX_TOKENS 只有 1024）
      const heads = r.p.lines.filter(l => LINE.head.test(l));
      if (heads.length < 2) bad.push(tag + '：「整条」这轮只摆出 ' + heads.length + ' 节');
      else {
        const lastLine = r.p.lines[r.p.lines.length - 1] || '';
        if (LINE.head.test(lastLine))
          bad.push(tag + '：末节像是**被截断**了（最后一行停在节标题上，三行没写完）——看上面原文，多半撞上了 SR.MAX_TOKENS');
      }
      if (r.st.slots.length !== heads.length)
        bad.push(tag + '：台阶条槽位 ' + r.st.slots.length + ' 格，跟这轮摆出的 ' + heads.length + ' 节对不上');
    } else {
      // ② 一节：一轮恰好一节；③ 递增
      const heads = r.p.lines.filter(l => LINE.head.test(l));
      if (!heads.length) bad.push(tag + '：没写节标题（这一轮该摆一节）');
      else if (heads.length > 1) bad.push(tag + '：一轮摆了 ' + heads.length + ' 节（镣铐：一轮只摆一节）');
      if (r.p.body.length < 4) bad.push(tag + '：四行只齐了 ' + r.p.body.length + ' 行');
      if (r.p.step && prevStep && r.p.step <= prevStep)
        bad.push(tag + '：节号没往前走（第 ' + prevStep + ' 节 → 第 ' + r.p.step + ' 节）');
      if (!r.p.step && prevStep) bad.push(tag + '：这轮读不出节号 —— 台阶条会**原地不动**（第 ' + prevStep + ' 节），看上面原文');
    }

    if (r.p.extra.length) bad.push(tag + '：多说了 ' + r.p.extra.length + ' 句（' + r.p.extra[0].slice(0, 20) + '…）');
    // 「你接这句」有没有把答案说出来。★ 这是一条**故意做窄**的启发式：
    //   2026-10-02 第一版写的是 /答案|所以|结果是|=/，把「…都符合"AB = 5"这个条件吗？」
    //   也算成了"说了答案"——它只是**念了一遍题目里的条件**，正是该说的话。
    //   尺子比它宣称的东西宽，报出来的就是假警报（这条教训在记忆里叫"检测脚本的数字
    //   不是它宣称的那件事"）。所以收窄到必须出现"结论"的词。
    if (r.p.you && /答案是|正确的?是|应该?是|结果是|就是\s*-?\d|等于\s*-?\d/.test(r.p.you)) {
      bad.push(tag + '：「你接这句」里像是把答案说出来了（看上面那句原话）');
    }
    if (copied(r.p.body.join(''))) bad.push(tag + '：链子搬了提示词里的示范');

    // ⑥ 台阶条只增不减（走的是产品里真用的 SR.absorbChain 之后的状态）
    if (r.st.slots.length < prevSlots)
      bad.push(tag + '：台阶条槽位**变少了**（' + prevSlots + ' → ' + r.st.slots.length + '）——已经摆出来的节不许藏起来');
    if (r.st.plan < prevPlan)
      bad.push(tag + '：预排格数变少了（' + prevPlan + ' → ' + r.st.plan + '）——计划只增不减');
    if (r.st.slots.length > r.st.plan)
      bad.push(tag + '：槽位 ' + r.st.slots.length + ' 格 > 预排 ' + r.st.plan + ' 格（这两条该同步长，只增不减那条没生效）');
    prevSlots = r.st.slots.length; prevPlan = r.st.plan;
    if (r.p.step) prevStep = r.p.step;
  });

  console.log('===== ' + BACKEND + ' 上走了 ' + rows.length + ' 轮 =====');
  if (!bad.length) console.log('  没有待判的（几路给了、一轮一节、节号递增、四行齐、不多嘴、没抄示范、台阶条只增不减）');
  else bad.forEach(x => console.log('  · ' + x));
  console.log('★ 这是**待判清单**，不是分数。红了先看上面打印的原话再下结论。');
  console.log('★ 脚本判不了的两件事，得你自己看上面原文：');
  console.log('   · 那几条路是不是**真的不同的错法**（还是同一句话换个说法）；');
  console.log('   · 「学生大概会说」那一行**像不像一个孩子在说话**。');
  process.exit(0);
})();

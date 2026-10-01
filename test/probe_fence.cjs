// 数围栏命中率：同一份提示词打 N 次，看模型有几次真写了 ```ggb 和 ```想说。
//
// ★ 这个脚本是"换后端"这件事的头号验收关。
//   提示词是在 DeepSeek 上逐版调出来的，免费通道那几颗模型听不听话，
//   不许假设——只能同一个用例、同一个提示词，在 GLM 上重打一遍对数字。
//
// 走的是页面里真真正正的 SR.api.ask（连降级链、按 token 裁历史都在里面），
// 不是另搭一套请求——另搭的那套测通了不算数。
//
// 用法: node test/probe_fence.cjs [次数] [后端] [用例关键词]
// 例:   node test/probe_fence.cjs 8 glm
//       node test/probe_fence.cjs 8 deepseek
const path = require('path'), fs = require('fs'), os = require('os');

// ---- 把数根那几个 js 原样装进来（跟浏览器同一个 window 形状）----
const store = {};
const LS = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const W = { SR: {} };
// render.js 也装进来：判据要读的是**学生真正看到的那段**（过了拆围栏和三条删行规则之后），
// 不是把 ``` 块抠掉的原文。见 one() 里的 vis。
// chips.js 装进来是为了"抄示范"那格：模型抄了提示词里的示范之后，**产品那头还有一道出口过滤**
// （SR.filterCopiedChips，命中就整组作废、落回本地兜底）。所以这里要判的不是"模型抄没抄"
// （那是信息，小模型一定会抄），而是"抄了的有没有漏到学生眼前"。
for (const f of ['config.js', 'prompt-student.js', 'prompt-lean.js', 'prompt-tail.js', 'prompt-demo.js', 'textbook.js', 'retrieve.js', 'api.js', 'render.js', 'chips.js']) {
  // ⚠ 前面补一句 `var SR = window.SR`：浏览器里这些文件共用页面那个全局 SR
  //   （config.js 的 `var SR` 落到 window 上），可 chips.js 是直接写 `SR.CHIPS = …`、
  //   自己没声明——在 node 的这个假 window 里它就是个未定义变量，一跑就 ReferenceError。
  //   补一句之后两边形状一样了；重复声明 var 在非严格模式下是合法的。
  new Function('window', 'localStorage', 'navigator',
    'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
}
const SR = W.SR;

// DeepSeek 的 Key 现读不落盘（跟 e2e 那套一样）
const DS_KEY = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))
  .env.ANTHROPIC_AUTH_TOKEN;

const N = Number(process.argv[2] || 8);
const BACKEND = process.argv[3] || 'deepseek';
const FILTER = process.argv[4] || '';
const MODELS = process.argv[5] || '';

// GLM 的 Key 是从 config.js 里读出来的（注入脚本灌进去的那份）
if (BACKEND === 'glm' && !SR.GLM_KEY) { console.error('config.js 里没有 GLM_KEY，先跑 node test/inject_key.cjs'); process.exit(1); }
// 第 5 个参数可以临时换模型链（逗号分隔），用来比"同一份提示词换颗模型差多少"，不改 config.js。
// 两条链一起换：不带图走 modelsText、带图走 models，覆盖只改一条会测出乌龙。
if (MODELS) { SR.BACKENDS[BACKEND].models = MODELS.split(','); SR.BACKENDS[BACKEND].modelsText = MODELS.split(','); }
SR.api.setBackend(BACKEND);
SR.api.setKey(DS_KEY);

const b = SR.api.backend();
console.log('后端 ' + b.id + '  模型链 ' + b.models.join(' → ') + '   历史预算 ' + b.budget + ' tokens');
console.log('学生提示词 ' + SR.PROMPT_STUDENT.length + ' 字符\n');

// ★ 判据跟着设计走（2026-10-01 改）：学生模式下 ```想说 不再是硬指标了。
//   实测免费通道那两颗小模型守不住这个围栏（视觉那颗丢角色、文字那颗丢围栏），
//   所以按钮改成"模型给了就用、没给用本地兜底"（js/chips.js）。
//   于是这里要盯的换成了**正文有没有坏**，那才是学生真正读到的东西：
//     回声 —— 模型反过来演学生，把学生那句话重说一遍。
//             实测原话："好的，老师，这道题我不会。请问我应该如何比较 -2 和 1 的大小呢？"
//     念叨 —— 它在跟提示词说话，不是跟学生说话。
//             实测原话："以下是符合规则的回应，分为追问内容和想说环节两部分："
const CASES = [
  { name: '学生·说不会',        mode: 'student', say: '老师，这道题我不会：比较 -2 和 1 的大小。', want: { say: false, ggb: false }, echo: '比较 -2 和 1 的大小' },
  // ★ 这一格**不要求模型出 ggb 围栏**（2026-10-01 改，原来要）。
  //   学生说"画不出来"时，免费通道那颗文字模型（glm-4-flash-250414）实测 0/6~2/6——
  //   它守不住围栏，还会把命令当正文吐出来。而这件事**早就另有安排**：
  //   chat.js 见模型一条真命令都没给，就调 board.giveBlank 在画板上补一条空数轴
  //   （实测 8/8 认得出这句话，见 probe_blank.cjs，那才是这条路的验收关）。
  //   所以这里只盯正文干不干净——围栏交给兜底，别再拿它当红绿。
  //   ⚠ 演示模式那三格还是要 ggb：那是老师在画图，兜底不替它圆场。
  { name: '学生·求画数轴',      mode: 'student', say: '你能帮我画个数轴吗，我画不出来。',        want: { say: false, ggb: false }, echo: '画不出来。',
    note: '画板由 board.giveBlank 补空数轴，验收在 probe_blank.cjs' },
  { name: '学生·说标好了',      mode: 'student', say: '我标好了，-2 标在 0 左边两格，1 标在 0 右边一格。', want: { say: false, ggb: false }, echo: '标在 0 左边两格' },
  { name: '学生·纯计算题',      mode: 'student', say: '老师，解方程 2x+1=7，我算出来 x=3。',     want: { say: false, ggb: false }, echo: '我算出来 x=3' },
  { name: '演示·画动点',        mode: 'demo',    say: '画个数轴，带个动点 P',                   want: { say: false, ggb: true } },
  { name: '演示·画函数交点',    mode: 'demo',    say: '画 y=2x+1 和 y=-x+3，看交点',            want: { say: false, ggb: true } },
  { name: '演示·三维正方体',    mode: 'demo',    say: '切到三维，画个正方体',                   want: { say: false, ggb: true } }
];

async function one(c) {
  const t0 = Date.now();
  let text = '', notice = '';
  const res = await SR.api.ask({
    mode: c.mode, history: [], text: c.say,
    onChunk: p => { text += p; },
    onNotice: m => { notice = m; }
  });
  const ms = Date.now() - t0;
  if (res.error) return { err: res.error, ms, needOwnKey: !!res.needOwnKey };
  const t = res.text || '';
  // ---- 两个"坏味道"判据（2026-10-01 加的，都是实测抓到的真实翻车） ----
  //   抄示范：小模型把提示词里那段示范原样搬进自己的 想说 围栏。
  //           -2 那三行是老示范（正因为被抄，才换成了别的题的数）；
  //           "我先看看这两个数里谁是负的"那三行是换上去的新示范，同样要盯着。
  //   现在的示范（build_prompt.py 的 TAIL）是「我照着题目把条件都标上去了」那三句；
  //   后面三句是**上一版**的示范，留着一起盯——旧文案可能还在别处（比如缓存、旧稿）冒出来。
  //  EX = 提示词正文/收尾里出现过的**所有**「想说」例句。
  //  ★ 2026-10-01 打过脸：原来只列了收尾块那几行，DeepSeek 明明一字不差抄的是
  //    v18 正文里那三句（我看它们在数轴上谁靠左谁靠右…），计数器却一直报 0——
  //    数字不是它宣称的那件事。以后提示词里每加一处例句，都回这儿补一行。
  const EX = ['我照着题目把条件都标上去了', '我大概知道该看哪儿，但说不清', '我卡住了，不知道下一步干什么',
              '我把 -2 标在 0 左边两格', '我标好了，但不确定对不对', '我画不出来，尺子找不到了',
              '我看它们在数轴上谁靠左谁靠右', '我不确定，感觉差不多大', '我不会比，以前就随便写的'];
  const sm = t.match(/```想说([\s\S]*?)```/);
  const lines = sm ? sm[1].trim().split('\n').map(x => x.trim()).filter(Boolean) : [];
  // ★ body = **学生真正读到的那段**：交给 js/render.js 走一遍（拆围栏 + 三条删行规则），
  //   别再自己写个 `replace(/```…```/)` 凑合——那样量的是"抠掉围栏的原文"，
  //   学生实际看到的东西（比如掉围栏漏出来的 A=(-2,0)）根本没进过判据。
  //   删行的规则本身由 test/probe_render.cjs 逐条守。
  const body = SR.render.parseFences(t, { student: c.mode === 'student' }).visible;
  // 漏命令＝模型把画板命令当正文吐出来了（掉围栏）。这是**信息**，不是红绿：
  //   产品那头靠 render.js 删行兜住，兜没兜住由 probe_render.cjs 负责。
  //   这里用一把**故意更松**的尺子（只要有顶格的 `#…` 或 `X=(…)` 就算），
  //   松的尺子只会多报、不会漏报，正适合当"去查一查"的提醒。
  const naive = t.replace(/```[\s\S]*?```/g, '');
  const leak = naive.split('\n').some(ln => /^\s*(#\S|[A-Za-z][A-Za-z0-9_]*\s*=\s*.*\()/.test(ln));
  // ★ 抄了之后**出口那一关过没过**：chat.js 拿到的三个按钮会先过 SR.filterCopiedChips，
  //   命中就整组作废、落回本地兜底。学生看不看得见抄来的按钮，由这一格说了算。
  //   模型抄不抄（copied）是信息——小模型一定会抄，那是提示词里放着示范的代价；
  //   漏没漏（escape）才是红绿。
  const offered = SR.filterCopiedChips(lines);
  return {
    text: t, ms, model: res.model, notice, body, lines, leak,
    copied: lines.filter(l => EX.indexOf(l) >= 0).length,
    escape: lines.some(l => EX.indexOf(l) >= 0) && offered.length > 0,
    meta: /以下是|模拟回复|作为助手|<answer>|<think>|符合规则|环节两部分|说明（符合/.test(body),
    // 回声＝模型反过来演学生。两个硬特征，比拿学生原话比字串准得多：
    //   ① 它管对方叫"老师"——老师不会自称老师（老师说的是"你"）
    //   ② 它开口先应一声，紧接着就**用学生的嘴说话**（"好的，老师…"/"嗯，我不会…"）
    // 实测原话就长这样："好的，老师，这道题我不会。请问我应该如何比较 -2 和 1 的大小呢？"
    // ★ 2026-10-01 把②收窄过一次。原来是「开口就是 好的/嗯/明白了 就记一笔」，
    //   结果抓住的是这句：「好的，你在数轴上标出了-2和1。接下来，你打算比较这两个数的大小吗？」
    //   ——管对方叫"你"、反问一步，这是**老师好好说的话**，不是演学生。
    //   计数器和它宣称的那件事对不上（老毛病），所以②改成"应一声之后必须跟学生口吻"。
    //   判据红了先看上面 ↳ 打出来的原话，别照着数字改提示词。
    echo: /老师[，,、]|请问我/.test(body) ||
          /^(好的|嗯|明白了|我知道了)[，,。!！]?\s*(老师|这道?题我|我(不会|不懂|不知道|没(标|算|画|想)|不(会|懂|确定|清楚)))/.test(body),
    ggb: /```ggb/.test(t), say: /```想说/.test(t)
  };
}

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = [];
  for (const c of CASES) {
    if (FILTER && c.name.indexOf(FILTER) < 0) continue;
    const rs = [];
    for (let i = 0; i < N; i++) {
      rs.push(await one(c));                 // 串行：并发会把免费通道打成 429，测出来的是限流不是听话程度
      await sleep(500);
    }
    const ok = rs.filter(r => !r.err), bad = rs.filter(r => r.err);
    const g = ok.filter(r => r.ggb).length, s = ok.filter(r => r.say).length;
    // 抄示范（模型行为·信息）／拦漏（学生真的看见了·红绿）／念提示词
    const uniq = ok.filter(r => r.copied >= 1).length;
    const esc = ok.filter(r => r.escape).length;
    const mt = ok.filter(r => r.meta).length;
    const ec = ok.filter(r => r.echo).length;
    const avg = ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : 0;
    const models = [...new Set(ok.map(r => r.model))];
    const lk = ok.filter(r => r.leak).length;
    // 学生模式的验收线：正文不许回声、不许念叨，抄来的按钮不许漏到学生眼前。
    // 想说不再是硬指标（有本地兜底 js/chips.js）；ggb 该出就得出（那是演示模式的命根子）。
    const hit =
      (!c.want.ggb || g > 0) && (!c.want.say || s > 0) &&
      (c.mode !== 'student' || (esc === 0 && mt === 0 && ec === 0));
    rows.push({ name: c.name, want: c.want, gotG: g, gotS: s, n: ok.length, hit, uniq: uniq, esc: esc, mt: mt, ec: ec });

    console.log(c.name + '  （该出：' + (c.want.ggb ? 'ggb ' : '') + (c.want.say ? '想说' : '') + (c.want.ggb || c.want.say ? '' : '（都不出）') + '）' +
      (c.note ? '   ※ ' + c.note : ''));
    console.log('    ggb ' + g + '/' + ok.length + '   想说 ' + s + '/' + ok.length + '   均 ' + avg + 'ms' +
      (c.mode === 'student' ? '   回声 ' + ec + '/' + ok.length + '   念叨 ' + mt + '/' + ok.length +
        '   拦漏 ' + esc + '/' + ok.length +
        '   抄示范 ' + uniq + '/' + ok.length + '·漏命令 ' + lk + '/' + ok.length + '（这两个是信息，不是红绿）' : '') +
      (models.length > 1 ? '   用过模型 ' + models.join('、') : '') +
      (bad.length ? '   失败 ' + bad.length + '（' + bad[0].err.slice(0, 60) + '）' : ''));
    // ★ 上面那三个计数**必须把证据打出来**（2026-10-01 加的）。
    //   起因：同一档「学生·说标好了」跑两次，一次 回声 0/6、一次 1/6，判据跟着红绿翻，
    //   可"哪一条被算成了回声"没留下——计数器和它宣称的那件事之间没有可查的线。
    //   三个判据都是启发式正则（尤其 回声 那条 `^(好的|嗯|…)`，老师好好说一句"好的，你标在…"就会中），
    //   所以这里把命中的原话截出来。**数字红了不等于模型坏了，先看这句原话再下结论。**
    const ev = (label, arr) => {
      if (!arr.length) return;
      console.log('      ↳ ' + label + '：' + arr.map(r => '「' + r.body.replace(/\n/g, ' ').slice(0, 50) + '」').join(' '));
    };
    if (c.mode === 'student') {
      ev('回声原文', ok.filter(r => r.echo));
      ev('念叨原文', ok.filter(r => r.meta));
      // 抄示范/漏命令都只是信息——把原话摆出来，是为了让人能判断"这次抄的是哪三句、
      // 提示词那边是不是又换了示范却没同步 EXAMPLE_CHIPS"。
      ev('抄示范原文', ok.filter(r => r.copied >= 1).map(r => ({ body: r.lines.join(' | ') })));
      ev('漏命令原文', ok.filter(r => r.leak).map(r => ({ body: r.text.replace(/```[\s\S]*?```/g, '').replace(/\n/g, ' ⏎ ') })));
      ev('★漏给学生了', ok.filter(r => r.escape).map(r => ({ body: r.lines.join(' | ') })));
    }

    // DUMP=1 把这一档的每一条原文都打出来。
    // 只打"最像样的那一条"会藏住失败样本——4/6 到底是哪两条掉的，不 dump 就看不见。
    if (process.env.DUMP) {
      ok.forEach((r, i) => {
        console.log('    -- #' + (i + 1) + ' ggb=' + r.ggb + ' 想说=' + r.say + ' 回声=' + r.echo +
                    ' 念叨=' + r.meta + ' 抄=' + r.copied + ' 模型=' + r.model);
        console.log('       ' + (r.text || '').replace(/\n/g, ' ⏎ ').slice(0, 300));
      });
    }
    const f = ok.find(r => (r.ggb === c.want.ggb)) || ok[0];
    if (f) {
      const gm = f.text.match(/```ggb([\s\S]*?)```/), sm = f.text.match(/```想说([\s\S]*?)```/);
      // ★ 这里印的必须是 f.body，也就是**判据用的那段（学生真正读到的）**。
      //   原来印的是"把 ```块抠掉的原文"，判的却是别的，两个东西对不上——
      //   想看"兜住没有"，看的就是这行。要原文加 DUMPRAW=1。
      console.log('    〔正文〕' + f.body.replace(/\n/g, ' ⏎ ').slice(0, 80));
      if (process.env.DUMPRAW) console.log('    〔原文〕' + f.text.replace(/\n/g, ' ⏎ ').slice(0, 400));
      if (gm) console.log('    〔ggb〕' + gm[1].trim().replace(/\n/g, ' ; '));
      if (sm) console.log('    〔想说〕' + sm[1].trim().split('\n').map(x => x.trim()).join(' | '));
    }
    console.log('');
  }

  const pass = rows.filter(r => r.hit).length;
  console.log('===== ' + BACKEND + ' 上 ' + pass + '/' + rows.length + ' 个用例达标 =====');
  for (const r of rows) {
    console.log((r.hit ? '  ✓ ' : '  ✗ ') + r.name.padEnd(16) +
      ' 该出 ' + (r.want.ggb ? 'ggb' : '') + (r.want.say ? '+想说' : '') + '  实际 ggb ' + r.gotG + '/' + r.n + '  想说 ' + r.gotS + '/' + r.n +
      // 不达标的那几格，把"为什么红"直接写在旁边——不然还得回头往上翻
      (r.hit ? '' : '   ← ' + [
        (r.want.ggb && r.gotG === 0) ? '该出 ggb 却 0 次' : '',
        (r.want.say && r.gotS === 0) ? '该出想说却 0 次' : '',
        r.ec ? '回声 ' + r.ec : '', r.mt ? '念叨 ' + r.mt : '',
        r.esc ? '抄来的按钮漏给学生 ' + r.esc + ' 次' : ''
      ].filter(Boolean).join('、')));
  }
  process.exit(pass === rows.length ? 0 : 1);
})();

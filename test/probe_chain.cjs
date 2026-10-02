// 备课／讲评这条链子的验收：给它一道题，它会不会**一节一节**摆出那条链子？
//
// ★ 2026-10-02 新写。旧那套（probe_fence.cjs）量的是学生版的 ```ggb / ```想说 两个围栏，
//   而学生版整个砍掉了、那份脚本引的 js/prompt-student.js 早就不存在——它已经跑不起来了。
//   备课这一版换成了"摆链子"，要盯的东西整个变了，所以另起一份，别去改那个死掉的。
//
// 量四件事，每一件都对着一处真实的翻车：
//   ① 逐节推进 —— 第一轮摆第 1 节，说"接着往下摆"就摆第 2 节……（不许一次把五节倒完）
//   ② 一节四行 —— 头一行 `第 X 节 · 名字`，下面三行的名字一字不差
//   ③ 不多嘴   —— 除了那四行没有别的话（尤其不许问"要不要继续"）
//   ④ 不抄示范 —— 链子里没有原样搬提示词里那段示范（同 SR.EXAMPLE_CHIPS）
//
// 走的是页面里真真正正的 SR.api.ask（降级链、按 token 裁历史都在里面），不是另搭一套。
//
// 用法: node test/probe_chain.cjs [轮数] [后端] [题目]
// 例:   node test/probe_chain.cjs 4 glm
const path = require('path'), fs = require('fs'), os = require('os');

// ---- 把数根那几个 js 原样装进来（跟浏览器同一个 window 形状）----
const store = {};
const LS = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const W = { SR: {} };
for (const f of ['config.js', 'prompt-prep.js', 'textbook.js', 'retrieve.js', 'zhuawen.js', 'api.js', 'render.js', 'chips.js']) {
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

const TURNS = Number(process.argv[2] || 4);
const BACKEND = process.argv[3] || 'glm';
// ★ 默认用一道**真有坎**的题（"只算出一个答案"是这道题的典型翻车），
//   别拿"数轴上 -3 到原点的距离"那种一句话就完的题去测——那种题本来就没有链子可摆，
//   摆出来薄，看不出是提示词不行还是题不行。
const ASK = process.argv[4] || '数轴上点 A 表示 -2，点 B 表示的数是 x，AB = 5，求 x。';

if (BACKEND === 'glm' && !SR.GLM_KEY) { console.error('config.js 里没有 GLM_KEY，先跑 node test/inject_key.cjs'); process.exit(1); }
SR.api.setBackend(BACKEND);
SR.api.setKey(DS_KEY);

const b = SR.api.backend();
const w = SR.WORKS.prep;
const SYS = (b.promptProfile === 'lean' && w.lean ? w.lean() : w.prompt())
          + '\n\n---\n\n' + SR.PROMPT_PREP_TAIL;
console.log('后端 ' + b.id + '  档 ' + b.promptProfile + '  提示词 ' + SYS.length + ' 字符（含收尾块）');
console.log('题目 ' + JSON.stringify(ASK) + '\n');

// ---- 一节的形状判据 ----
// ★ 行的名字必须**逐字**对：提示词里就是这么规定的，模型少一个字（"学生会说："）就算没守形状。
const LINE = {
  stu: /^学生大概会说[：:]/,
  you: /^你接这句[：:]/,
  why: /^这么接的道理[：:]/,
  head: /^第\s*([1-5])\s*节\s*[·・.]\s*(复述|定位|追问|给台阶|肯定)/
};
// 除了那四行之外多出来的话。空行不算。
const CHATTER = /要不要|接下来|需要我|还要我|继续吗|可以吗|^好的|^当然/;

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

(async () => {
  const mood = t => String(t || '').replace(/[\s，。、,.!！?？…—·:：;；"'“”‘’()（）\[\]【】]/g, '');
  const grams = SR.EXAMPLE_CHIPS.map(mood).reduce((a, c) => {
    for (let i = 0; i + 6 <= c.length; i++) a[c.slice(i, i + 6)] = 1;
    return a;
  }, {});
  const copied = h => {
    const n = mood(h);
    for (let i = 0; i + 6 <= n.length; i++) if (grams[n.slice(i, i + 6)]) return true;
    return false;
  };

  const history = [];
  let last = ASK;
  const rows = [];
  for (let i = 0; i < TURNS; i++) {
    const t0 = Date.now();
    const res = await SR.api.ask({ work: 'prep', history: history.slice(), text: last,
      onChunk: () => {}, onNotice: () => {} });
    const ms = Date.now() - t0;
    if (res.error) { console.log('第 ' + (i + 1) + ' 轮失败：' + res.error); break; }
    history.push({ role: 'user', content: SR.api.userContent(last, []) });
    history.push({ role: 'assistant', content: res.text });
    const p = parse(res.text);
    // 进度条那一格：走的是产品里真用的那份推断，不是另写一套
    const bar = SR.inferStep({ prevAssistant: res.text, first: i === 0 });
    const chips = SR.fallbackChips({ work: 'prep', first: i === 0, lastUser: last, prevAssistant: res.text });
    rows.push({ i, ms, model: res.model, p, bar, chips });

    console.log('— 第 ' + (i + 1) + ' 轮 · 我说的是「' + last.slice(0, 24) + '」 · ' + ms + 'ms · ' + res.model);
    console.log('  节标题   ' + (p.headLine || '(没写)') + '   → 我读出来是第 ' + p.step + ' 节，进度条判 ' + bar);
    console.log('  四行     ' + p.body.length + ' 行   ' + (p.stu ? '学生✓ ' : '学生✗ ') + (p.you ? '你接✓ ' : '你接✗ ') + (p.why ? '道理✓ ' : '道理✗ '));
    console.log('  学生说   ' + (p.stu || '(空)'));
    console.log('  你接这句 ' + (p.you || '(空)'));
    console.log('  道理     ' + (p.why || '(空)'));
    if (p.extra.length) console.log('  ⚠ 多出来的话 ' + JSON.stringify(p.extra));
    if (copied(p.body.join(''))) console.log('  ⚠ 抄了提示词里的示范');
    console.log('  按钮     ' + chips.join(' ／ '));
    console.log('');
    last = '接着往下摆';
  }

  // ---- 判据（打印，不打分）----
  // ★ 这里**只列待判清单**，不算"得几分"：同一条回复可以既是"节号对了"又是"多了一句话"。
  const bad = [];
  rows.forEach(r => {
    const tag = '第 ' + (r.i + 1) + ' 轮';
    if (!r.p.headLine) bad.push(tag + '：没写节标题');
    else if (r.p.step !== r.i + 1) bad.push(tag + '：该摆第 ' + (r.i + 1) + ' 节，写的是第 ' + r.p.step + ' 节');
    if (r.p.body.length < 4) bad.push(tag + '：四行只齐了 ' + r.p.body.length + ' 行');
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
  });
  console.log('===== ' + BACKEND + ' 上跑了 ' + rows.length + ' 轮 =====');
  if (!bad.length) console.log('  没有待判的（四行齐、节号对、不多嘴、没抄示范）');
  else bad.forEach(x => console.log('  · ' + x));
  console.log('★ 这是**待判清单**，不是分数。红了先看上面打印的原话再下结论。');
  process.exit(0);
})();

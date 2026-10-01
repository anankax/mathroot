// 图片场景 × 提示词档位 × 模型的对照实验（不跑浏览器，直接打 API）。
//
// ★ 为什么要做这个对照：浏览器里那条端到端刚测出 GLM 会**把整道题解出来**，
//   DeepSeek 却守得住（"对错我不判。你先说说第一步…"）。两边差在两处：
//   模型不同、提示词档位也不同（GLM 走精简版，DeepSeek 走全量 v18）。
//   这一个脚本把两处**拆开量**，不然改了也不知道是哪一处起的作用。
//
// 用法: node test/probe_image_prompt.cjs [次数]
const path = require('path'), fs = require('fs'), os = require('os');

const store = {};
const LS = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const W = { SR: {} };
for (const f of ['config.js', 'prompt-student.js', 'prompt-lean.js', 'prompt-tail.js', 'prompt-demo.js', 'textbook.js', 'zhuawen.js', 'retrieve.js', 'api.js']) {
  new Function('window', 'localStorage', 'navigator',
    fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
}
const SR = W.SR;

const N = Number(process.argv[2] || 3);
const IMG = path.join(__dirname, '_case_photo.png');
if (!fs.existsSync(IMG)) { console.error('先跑 py -3 test/mk_problem_image.py'); process.exit(1); }
const DATA_URL = 'data:image/png;base64,' + fs.readFileSync(IMG).toString('base64');

// 学生那句话可以换：SR_SAY="这题我做错了" node test/probe_image_prompt.cjs 4
// ★ 要分别量"他直接问对不对"和"他只说做错了"——v13 当初治的是后一种；
//   前一种是更狠的诱导，得单独看模型守不守得住。
const SAY = process.env.SR_SAY || '老师，这道题我算出来的答案是 x=4，对不对？';

// 学生把整份解答拍过来时，模型最容易干的三件不该干的事
const SOLVED = /x\s*=\s*3|等于\s*3|正确答案|答案是|应该(是|等于)\s*3|解得/;
const JUDGED = /你算错|不对|错了|错误的|不正确/;
const POINTED = /(这一步|这里|这步|哪一步|第二行|第三行|÷\s*2|除以\s*2|去括号|括号).{0,12}(错|不对|有问题|怎么)/;

async function one(models, profile, label) {
  SR.BACKENDS.glm.promptProfile = profile;
  // ★ 两条链一起换。带图那一轮走的是 modelsImage（2026-10-01 起），
  //   只改 models 的话测的还是演示链，会得出"改了没效果"的乌龙结论。
  SR.BACKENDS.glm.models = models;
  SR.BACKENDS.glm.modelsImage = models;
  let out = '';
  const res = await SR.api.ask({
    mode: 'student', backend: 'glm', history: [],
    text: SAY, imageDataUrl: DATA_URL,
    onChunk: p => { out += p; }
  });
  if (res.error) return { err: res.error };
  const body = String(res.text || '').replace(/```[\s\S]*?```/g, '').trim();
  return { body, solved: SOLVED.test(body), judged: JUDGED.test(body), pointed: POINTED.test(body) };
}

(async () => {
  console.log('图: ' + path.basename(IMG) + '  ' + Math.round(DATA_URL.length / 1024) + ' KB 的 data URI');
  console.log('学生说: ' + SAY + '\n');
  // 组合可以用第 3 个参数给："模型:档位,模型:档位"，不给就用下面这套默认
  const arg = process.argv[3] || '';
  const combos = arg ? arg.split(',').map(s => {
    const [m, p] = s.split(':');
    return [[m], p || 'lean', m + ' × ' + (p === 'full' ? '全量 v18' : '精简版')];
  }) : [
    // ★ 对照的摆法（2026-10-01 定）：左边是**现在线上那条链**，右边是**被换掉的那两颗**。
    //   每次动 modelsImage 都回来打一遍这四行，"守住了"和"又塌了"当场看得见。
    [['glm-4.6v-flash'], 'lean', 'glm-4.6v-flash × 精简版（= 现在线上的配置）'],
    [['glm-4.6v-flash'], 'full', 'glm-4.6v-flash × 全量 v18'],
    [['glm-4v-flash'], 'lean', 'glm-4v-flash × 精简版（已弃：会解题）'],
    [['glm-4.1v-thinking-flash'], 'lean', 'glm-4.1v-thinking-flash × 精简版（已弃：会解题+念思维链）']
  ];
  for (const [models, profile, label] of combos) {
    const rs = [];
    for (let i = 0; i < N; i++) { rs.push(await one(models, profile, label)); await new Promise(r => setTimeout(r, 700)); }
    const ok = rs.filter(r => !r.err);
    const bad = rs.filter(r => r.err);
    console.log('── ' + label + '   （成功 ' + ok.length + '/' + rs.length + '）');
    if (bad.length) console.log('     失败: ' + bad[0].err.slice(0, 70));
    if (!ok.length) { console.log(''); continue; }
    console.log('     给答案 ' + ok.filter(r => r.solved).length + '/' + ok.length +
                '   判对错 ' + ok.filter(r => r.judged).length + '/' + ok.length +
                '   点名错步 ' + ok.filter(r => r.pointed).length + '/' + ok.length);
    console.log('     例: ' + ok[0].body.replace(/\n/g, ' ⏎ ').slice(0, 120));
    console.log('');
  }
})();

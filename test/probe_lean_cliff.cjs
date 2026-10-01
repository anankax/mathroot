// 「想说」围栏到底要多短的提示词才守得住？哪颗免费模型守得住？
//
// 背景：656 字的手写短版在 glm-4v-flash 上是 4/4；5303 字的精简版掉到 0/6、1/6。
// 但 656 字那版是"极简"，5303 字这版才是能上线的（有台阶、有禁区）。
// 所以要量的是一件具体的事：**在保住"台阶 + 禁区 + 收尾清单"的前提下，能压到多短。**
//
// 三件事一起数，缺一不可：
//   1. 想说围栏在不在
//   2. 三个句子是不是贴着这道题（还是在照抄提示词里的样例）
//   3. 有没有违反铁律去讲解、去给答案（这一条比前两条更要命）
//
// 用法: node test/probe_lean_cliff.cjs [每格打几次]
const path = require('path'), fs = require('fs');

const store = {};
const LS = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const W = { SR: {} };
for (const f of ['config.js', 'prompt-student.js', 'prompt-lean.js', 'prompt-tail.js', 'prompt-demo.js', 'textbook.js', 'retrieve.js', 'api.js']) {
  new Function('window', 'localStorage', 'navigator',
    fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
}
const SR = W.SR, KEY = SR.GLM_KEY;
const N = Number(process.argv[2] || 6);
const LEAN = SR.PROMPT_LEAN;

// ---- 把精简版按"整节"往下砍，砍出来的每一版都是连贯文档，不是断章 ----
function dropSections(text, titles) {
  const lines = text.split('\n');
  const out = [];
  let skipping = false;
  for (const l of lines) {
    if (/^#\s/.test(l)) skipping = titles.some(t => l.indexOf(t) >= 0);
    if (!skipping) out.push(l);
  }
  return out.join('\n');
}
const MINI = dropSections(LEAN, ['你说话的样子', '教材索引怎么用', '话术禁区', '右边那块画板']);
const MID = dropSections(LEAN, ['教材索引怎么用', '话术禁区']);

const PROMPTS = [
  { tag: '精简版 ' + LEAN.length, sys: LEAN },
  { tag: '砍到 ' + MID.length, sys: MID },
  { tag: '砍到 ' + MINI.length, sys: MINI }
];
const MODELS = ['glm-4v-flash', 'glm-4.1v-thinking-flash'];

const CASES = [
  { n: '说不会', say: '老师，这道题我不会：比较 -2 和 1 的大小。', 贴题: /-2|1|数轴|大小/ },
  { n: '说标好了', say: '我标好了，-2 标在 0 左边两格，1 标在 0 右边一格。', 贴题: /-2|1|数轴|左|右/ },
  { n: '纯计算题', say: '老师，解方程 2x+1=7，我算出来 x=3。', 贴题: /2x|7|x|方程|算/ }
];
// 讲解/给答案的痕迹——这几句一冒头就是铁律破了
const LEAK = /让我们|我们来看|首先|解题|验证一下|所以.{0,6}等于|正确答案|答案是|没错|你算对了|应该|正确/;

async function once(model, sys, say) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: say }],
        temperature: 1.0, max_tokens: 1024, stream: false })
    });
  } catch (e) { return { err: 'NET' }; }
  if (!r.ok) return { err: 'HTTP' + r.status };
  const j = await r.json();
  let t = (j.choices[0].message.content || '');
  // thinking 那颗的思考过程混在正文里，先剥掉再判，不然判的是它的心里话
  t = t.replace(/<think>[\s\S]*?<\/think>/g, '');
  const sm = t.match(/```想说([\s\S]*?)```/);
  const body = t.replace(/```[\s\S]*?```/g, '').trim();
  const lines = sm ? sm[1].trim().split('\n').map(x => x.trim()).filter(Boolean) : [];
  return { ms: Date.now() - t0, say: !!sm, lines, body,
    fresh: lines.length ? lines.some(l => /-2|2x|7|x|数轴|老师/.test(l)) : false,
    leak: LEAK.test(body) };
}

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const p of PROMPTS) {
    for (const m of MODELS) {
      console.log('\n===== ' + m + ' ／ 提示词 ' + p.tag + ' 字 =====');
      for (const c of CASES) {
        const rs = [];
        for (let i = 0; i < N; i++) { rs.push(await once(m, p.sys, c.say)); await sleep(400); }
        const ok = rs.filter(r => !r.err);
        if (!ok.length) { console.log('  ' + c.n + '  全失败（' + rs[0].err + '）'); continue; }
        const s = ok.filter(r => r.say).length;
        const f = ok.filter(r => r.fresh).length;
        const lk = ok.filter(r => r.leak).length;
        const avg = Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length);
        console.log('  ' + c.n.padEnd(5) + ' 想说 ' + s + '/' + ok.length + '  贴题 ' + f + '/' + ok.length +
          '  讲解/泄答案 ' + lk + '/' + ok.length + '  ' + avg + 'ms');
        const one = ok.find(r => r.say) || ok[0];
        if (one.lines.length) console.log('      想说：' + one.lines.join(' | ').slice(0, 80));
        console.log('      正文：' + one.body.replace(/\s+/g, ' ').slice(0, 85));
      }
    }
  }
})();

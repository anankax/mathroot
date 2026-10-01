// 诊断：学生模式在 GLM 上为什么不听话？
//
// 上一轮 probe_fence 的结果：演示模式 6/6 全绿，学生模式崩——想说围栏 0/6，
// 正文还在照抄提示词里的例句（"（好）学生：…"）。两个可能的根因，必须分开：
//   A. 上下文太长：提示词 11711 字符 ≈ 7600 tokens，把 glm-4v-flash（16K）淹了
//   B. 模型太弱：那颗模型本来就撑不住这么长的角色扮演
// 分不清就不能对症下药。所以固定用例，只换一个变量地打：
//   满提示词 × 三颗模型 / 截短提示词 × glm-4v-flash
//
// 用法: node test/probe_glm_prompt.cjs [每个组合打几次]
const path = require('path'), fs = require('fs');

const store = {};
const LS = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const W = { SR: {} };
for (const f of ['config.js', 'prompt-student.js', 'prompt-demo.js', 'textbook.js', 'retrieve.js', 'api.js']) {
  new Function('window', 'localStorage', 'navigator',
    fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
}
const SR = W.SR;
const KEY = SR.GLM_KEY;
if (!KEY) { console.error('config.js 里没有 GLM_KEY'); process.exit(1); }

const N = Number(process.argv[2] || 4);
const FULL = SR.PROMPT_STUDENT;

// 截短版：只留"你是谁 + 只问不答 + 两个围栏的格式 + 交卷前最后一眼"。
// 不是要拿它上线，是用来判断"长提示词"是不是罪魁。
const TAIL = FULL.slice(FULL.lastIndexOf('# 交卷前最后一眼'));
const SHORT = [
  '# 你是谁',
  '',
  '你是「数根」，一个初中数学的错题复盘助手。你陪学生把错题刨到根上：错在哪一步、当时心里怎么想的。',
  '你**只问不答**：不给答案、不判对错、不讲解法。',
  '',
  '# 两个围栏',
  '',
  '要画板出图时（只有"让他把题里的东西标上去"才用），回复里带这一段：',
  '',
  '```ggb',
  '#清空',
  '数轴',
  '```',
  '',
  '**每一条回复的最后**，都必须带下面这一段，给他三个能直接点的话：',
  '',
  '```想说',
  '我看它们在数轴上谁靠左谁靠右',
  '我不确定，感觉差不多大',
  '我不会比，以前就随便写的',
  '```',
  '',
  '三条按这个顺序：第一条说一点思路、第二条含糊没把握、第三条答不上来。一句一条，每条不超过 20 字。',
  '**写的是"学生怎么想、怎么说"，不是"老师在问什么"。**不许向老师要东西。不许把结论写出来。',
  '',
  '---',
  '',
  TAIL
].join('\n');

const CASES = [
  { name: '说不会', say: '老师，这道题我不会：比较 -2 和 1 的大小。' },
  { name: '说标好了', say: '我标好了，-2 标在 0 左边两格，1 标在 0 右边一格。' }
];

async function once(model, sys, say) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: say }],
        temperature: 1.0, max_tokens: 1024, stream: false
      })
    });
  } catch (e) { return { err: 'NET ' + e.message }; }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let code = ''; try { code = JSON.parse(t).error.code; } catch (e) {}
    return { err: 'HTTP' + r.status + (code ? '(' + code + ')' : '') };
  }
  const j = await r.json();
  const text = (j.choices && j.choices[0] && j.choices[0].message.content) || '';
  const usage = j.usage || {};
  return {
    ms: Date.now() - t0, text,
    inTok: usage.prompt_tokens || 0, outTok: usage.completion_tokens || 0,
    say: /```想说/.test(text),
    // 抄例句的特征：正文里冒出提示词自己才有的标记
    echo: /（好）|（差）|```想说```|里写「/.test(text.replace(/```[\s\S]*?```/g, '')),
    fin: j.choices && j.choices[0] && j.choices[0].finish_reason
  };
}

const COMBOS = [
  { label: '满提示词 ' + FULL.length + ' 字 (7.6K tok)', model: 'glm-4v-flash', sys: FULL },
  { label: '短提示词 ' + SHORT.length + ' 字', model: 'glm-4v-flash', sys: SHORT },
  { label: '满提示词', model: 'glm-4.1v-thinking-flash', sys: FULL },
  { label: '满提示词', model: 'glm-4.6v-flash', sys: FULL }
];

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const cb of COMBOS) {
    console.log('\n===== ' + cb.model + ' ／ ' + cb.label + ' =====');
    for (const c of CASES) {
      const rs = [];
      for (let i = 0; i < N; i++) { rs.push(await once(cb.model, cb.sys, c.say)); await sleep(600); }
      const ok = rs.filter(r => !r.err), bad = rs.filter(r => r.err);
      const s = ok.filter(r => r.say).length, e = ok.filter(r => r.echo).length;
      const avg = ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : 0;
      const tin = ok.length ? ok[0].inTok : 0;
      const tout = ok.length ? Math.round(ok.reduce((a, r) => a + r.outTok, 0) / ok.length) : 0;
      console.log('  ' + c.name + '：想说 ' + s + '/' + ok.length + '   抄例句 ' + e + '/' + ok.length +
        '   输入 ' + tin + ' tok  均出 ' + tout + ' tok  ' + avg + 'ms' +
        (bad.length ? '   失败 ' + bad.length + '（' + bad[0].err + '）' : ''));
      const f = ok[0];
      if (f) console.log('      〔' + (f.text || '').replace(/```[\s\S]*?```/g, ' ⟨围栏⟩ ').replace(/\s+/g, ' ').trim().slice(0, 110) + '〕');
    }
  }
})();

// 数围栏命中率：同一个提示词打 N 次，看模型有几次真写了 ```ggb 和 ```想说。
// 用法: node test/probe_fence.cjs [每个温度采几次] [温度,温度,...]
// 例:   node test/probe_fence.cjs 6 1.0 0.6
//
// 这不是在产品里跑的脚本，只是拿来定温度的。Key 现读，不落盘。
const path = require('path'), fs = require('fs'), os = require('os');

function loadPrompt(file) {
  const win = {};
  new Function('window', fs.readFileSync(file, 'utf8'))(win);
  return win.SR;
}
const PS = loadPrompt(path.join(__dirname, '..', 'js', 'prompt-student.js'));
const PD = loadPrompt(path.join(__dirname, '..', 'js', 'prompt-demo.js'));

// 把页面里那几件也装上，好拿到 buildSystem 真正拼出来的那份 system
const W = { SR: {} };
for (const f of ['config.js', 'prompt-student.js', 'prompt-demo.js', 'textbook.js', 'retrieve.js', 'api.js']) {
  new Function('window', 'localStorage', 'navigator',
    fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(
    W, { getItem: () => null, setItem: () => {}, removeItem: () => {} }, { onLine: true });
}
const SRREAL = W.SR;

const KEY = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))
  .env.ANTHROPIC_AUTH_TOKEN;

const N = Number(process.argv[2] || 6);
const TEMPS = (process.argv[3] || '1.0,0.6').split(',').map(Number);
const FILTER = process.argv[4] || '';   // 只跑名字里含这几个字的用例

const CASES = [
  {
    name: '学生·说不会',
    prompt: PS.PROMPT_STUDENT,
    say: '老师，这道题我不会：比较 -2 和 1 的大小。',
    want: { say: true, ggb: false }
  },
  {
    name: '学生·求画数轴',
    prompt: PS.PROMPT_STUDENT,
    say: '你能帮我画个数轴吗，我画不出来。',
    want: { say: true, ggb: true }
  },
  {
    name: '学生·说"我在数轴上标好了"',
    prompt: PS.PROMPT_STUDENT,
    say: '我标好了，-2 标在 0 左边两格，1 标在 0 右边一格。',
    want: { say: true, ggb: false }
  },
  {
    name: '学生·纯计算题（不该出图）',
    prompt: PS.PROMPT_STUDENT,
    say: '老师，解方程 2x+1=7，我算出来 x=3。',
    want: { say: true, ggb: false }
  },
  {
    // 走页面里真正的组装函数（演示模式现在不检索教材索引了）
    name: '演示·画动点（走 buildSystem 真货）',
    prompt: SRREAL.api.buildSystem('demo', '画个数轴，带个动点 P'),
    say: '画个数轴，带个动点 P',
    want: { say: false, ggb: true }
  },
  {
    name: '演示·画函数交点（走 buildSystem 真货）',
    prompt: SRREAL.api.buildSystem('demo', '画 y=2x+1 和 y=-x+3，看交点'),
    say: '画 y=2x+1 和 y=-x+3，看交点',
    want: { say: false, ggb: true }
  }
];

console.log('演示模式 buildSystem 后 system 长度: ' + SRREAL.api.buildSystem('demo', '画个数轴，带个动点 P').length +
            '（裸提示词 ' + PD.PROMPT_DEMO.length + '，多出来的是检索到的教材索引）\n');

// 打算加到学生提示词尾巴上的那段（A/B 用，还没写进产品）
const TAIL = [
  '---',
  '',
  '# 交卷前最后一眼（每一条回复都要过）',
  '',
  '回复写完了，发出去之前，看这两样：',
  '',
  '1. **三个能点的话有没有？** 每一条回复的最后，都必须有一个 ```想说 围栏，一条不落。',
  '   漏了它，学生面前就只剩一个空白输入框，他很可能就此不说话了。',
  '2. **这一轮该不该出图？** 只有"让他把题目里的东西标上去、画出来"的时候才带 ```ggb 围栏，',
  '   而且画板上只许出现题目给的东西，答案一个都不许出现。其余情况不带。',
  '',
  '一条完整的回复长这样，照这个顺序：',
  '',
  '（正文：就一句追问）',
  '',
  '```ggb',
  '#清空',
  '数轴',
  '```',
  '',
  '```想说',
  '我把 -2 标在 0 左边两格',
  '我标好了，但不确定对不对',
  '我画不出来，尺子找不到了',
  '```'
].join('\n');

async function one(c, temp) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [{ role: 'system', content: c.prompt + (c.suffix === 'TAIL' ? TAIL : (c.suffix || '')) }, { role: 'user', content: c.say }],
        temperature: temp, max_tokens: 1024, stream: false,
        thinking: { type: 'disabled' }
      })
    });
  } catch (e) { return { err: '网络:' + e.message }; }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) return { err: 'HTTP' + r.status + ' ' + JSON.stringify(j).slice(0, 200) };
  const text = (j.choices && j.choices[0] && j.choices[0].message.content) || '';
  // 围栏可能因为 max_tokens 被截断，没闭合的也算"它想写"
  return {
    text, ms: Date.now() - t0,
    out: (j.usage && j.usage.completion_tokens) || 0,
    ggb: /```ggb/.test(text), say: /```想说/.test(text),
    truncated: j.choices[0].finish_reason === 'length'
  };
}

(async () => {
  for (const c of CASES) {
    if (FILTER && c.name.indexOf(FILTER) < 0) continue;
    for (const temp of TEMPS) {
      const jobs = [];
      for (let i = 0; i < N; i++) jobs.push(one(c, temp));
      const rs = await Promise.all(jobs);
      const ok = rs.filter(r => !r.err);
      const errs = rs.filter(r => r.err);
      const g = ok.filter(r => r.ggb).length, s = ok.filter(r => r.say).length;
      const tr = ok.filter(r => r.truncated).length;
      const avgOut = ok.length ? Math.round(ok.reduce((a, r) => a + r.out, 0) / ok.length) : 0;
      console.log(
        `温度${temp}  ${c.name}\n` +
        `    ggb ${g}/${ok.length}   想说 ${s}/${ok.length}   被截断 ${tr}   均出 ${avgOut} tokens` +
        (errs.length ? `   失败 ${errs.length}（${errs[0].err.slice(0, 80)}）` : '')
      );
      // 把第一份样本的围栏内容摊开——人眼扫一遍有没有泄答案
      const f = ok.find(r => r.ggb) || ok[0];
      if (f) {
        const gm = f.text.match(/```ggb([\s\S]*?)```/);
        const sm = f.text.match(/```想说([\s\S]*?)```/);
        console.log('    〔样本·正文〕' + f.text.replace(/```[\s\S]*?```/g, '').trim().replace(/\n/g, ' ⏎ ').slice(0, 90));
        if (gm) console.log('    〔样本·ggb〕' + gm[1].trim().replace(/\n/g, ' ; '));
        if (sm) console.log('    〔样本·想说〕' + sm[1].trim().split('\n').map(x => x.trim()).join(' | '));
      }
    }
  }
})();

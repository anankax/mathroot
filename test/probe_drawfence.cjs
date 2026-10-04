// 「作图」那一格的出图率 + 新加的那档出口守不守得住 —— 打真模型，看它真写什么。
//
// 为什么非要有这一把尺子（2026-10-04）：
//   孔老师在作图格里打了一串没法画的东西，模型**凭空画了一张图**出来，还说得头头是道。
//   根因不是它笨：提示词结尾那条是**无条件**的——「老师说"画 xxx"，你回复里就必须有一个
//   ```ggb 围栏」，再加上前面「不反问、默认按最常见的理解画」。两句话合起来，
//   模型**没有"我看不出要画什么"这个出口**，于是它只会硬凑。
//   补法就是给那一条加一档例外（见 js/prompt-draw.js 结尾）。
//
//   ⚠ 可是加了出口就有**反过来的风险**：小模型容易把例外当成常规，
//     于是真让它画的时候它也开始"我看不出要画什么"。所以这一把尺子要**两头都量**：
//       · 真该画的（数轴/标数/三维）—— ```ggb 一条都不许掉；
//       · 真不该画的（一串字符/跟图形无关的话）—— 不许出围栏。
//     只量一头都会得出"改好了"的假象。
//
// 用法：node test/probe_drawfence.cjs [次数] [后端]
//   例：node test/probe_drawfence.cjs 4 glm
const path = require('path'), fs = require('fs'), os = require('os');

// ---- 把数根那几个 js 原样装进来（跟浏览器同一个 window 形状）----
const store = {};
const LS = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const W = { SR: {} };
for (const f of ['config.js', 'prompt-draw.js', 'prompt-say.js', 'textbook.js', 'retrieve.js', 'api.js', 'render.js', 'chips.js']) {
  new Function('window', 'localStorage', 'navigator',
    'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
}
const SR = W.SR;

const DS_KEY = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))
  .env.ANTHROPIC_AUTH_TOKEN;

const N = Number(process.argv[2] || 4);
const BACKEND = process.argv[3] || 'glm';

if (BACKEND === 'glm' && !SR.GLM_KEY) { console.error('config.js 里没有 GLM_KEY'); process.exit(1); }
SR.api.setBackend(BACKEND);
SR.api.setKey(DS_KEY);

const b = SR.api.backend();
console.log('后端 ' + b.id + '  模型链 ' + b.models.join(' → '));
console.log('作图提示词 ' + SR.PROMPT_DRAW.length + ' 字符   每格打 ' + N + ' 次\n');

// ★★ 用例的第一版**全部作废**，别捡回来：
//   我原来写的是「画个数轴，带个动点 P」「把这几个数在数轴上标出来：-3、0、2、5」
//   「切到三维，画个正方体」——这三句**在提示词里逐字都有**（前两句还是它的范例原句）。
//   实测「1111」时我才看清模型干的是什么事：它把提示词里那两段例子**原样粘回来**。
//   所以那三格量到的"出图 4/4"根本证明不了它看懂了话——照抄范例也是 4/4。
//   同一家族第 N+1 次：读数是对的，错的是它量的那个东西。
//   现在**真该画的三格一律换成提示词里没有的句子**，而且每一格还量**它到底写了什么命令**
//   （`must`）——只判"有没有围栏"仍然分不出"画对了"和"抄了一段围栏"。
const CASES = [
  { name: '真·长方形',   say: '画个长方形 ABCD，长 4、宽 3，把两条对角线连起来',
    wantGgb: true, must: /多边形|线段/ },
  { name: '真·抛物线顶点', say: '画 y=x^2-2x-3 的图象，标出它的最低点',
    wantGgb: true, must: /x\^2|x²|f\(x\)/ },
  { name: '真·数轴动点(换句话)', say: '一条数轴，上面有个点 P 可以来回滑动',
    wantGgb: true, must: /Slider|滑块|播放/ },

  // 真不该画的：不许硬凑
  { name: '瞎·乱字符', say: '1111',        wantGgb: false },
  { name: '瞎·无关话', say: '今天天气不错', wantGgb: false },
  // ★ 提示词里给模型看的"认输样子"用的是第三句（「嗯」），跟这三格**都不一样**——
  //   教样子、用没见过的句子考，才量得出它是不是真学会了那个判断，而不是背下了那一句。
  { name: '瞎·乱敲',   say: 'asdfgh',      wantGgb: false }
];

let 绿 = 0, 红 = 0, 自检过 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };

async function one(c) {
  let text = '';
  // ★★ 2026-10-04：这里原来是 `mode: 'draw'` —— **api.js 不认 mode**。
  //   js/api.js:503 写的参数名是 `work`，整个文件里搜不到一处 opts.mode。
  //   于是这一格量到的一直是**默认工位（组卷）**，而且连 prompt-material.js 都没装进来，
  //   system 是空的 → 模型按裸聊天回话（实测第一轮读到的就是「你好👋我是智谱清言」）。
  //   读数本身没错，错的是它量的那个东西——同一家族的第 N 次。
  //   ⚠ 老的 test/probe_fence.cjs 也是这么写的（mode: 'student' / 'demo' 全部落空），
  //     它那些「学生·说不会」的结论同样不作数，别再引用。
  const res = await SR.api.ask({
    work: 'draw', history: [], text: c.say,
    onChunk: p => { text += p; },
    onNotice: () => {}
  });
  if (res.error) return { err: res.error };
  const t = res.text || '';
  // ★★ 判据必须是**画板真拿到的那一段**，不是我在原文里 grep 到 ```ggb。
  //   2026-10-04 栽的：我用 /```ggb/ 去量免费通道那颗文字模型，它得 17/18、看着最好；
  //   可它把围栏写成光秃秃一行 `ggb`（开头三个反引号掉了），render.js 的
  //   parseFences **根本认不出**——那几行命令会被当正文删掉，**画板上一片空白**。
  //   我的正则看着"它画了"，产品上它是**最糟的那种失败**。原文里有围栏 ≠ 画板收到命令。
  //   所以这里一律走真解析器，量 SR.render.parseFences(t).ggb。
  let 块 = [];
  try { 块 = (SR.render.parseFences(t).ggb || []); } catch (e) { 块 = []; }
  const ggb = 块.length > 0;
  const 命令 = 块.join('\n');
  // ★ 第二个判据：**刻度数字叠字**。提示词原来教模型在数轴点上写 `文本("-2", …)`，
  //   可刻度数字是画板自己写的（paperDrawText），两个数就叠在同一个位置、糊成一串。
  //   现在提示词不许它对**整数**再写一遍了。这一格量的是"它听没听"。
  //   ⚠ 只判"轴下面的那种文本"：`文本(` 后面紧跟一个裸数字的那几条。
  const 叠字 = (t.match(/文本\(\s*\\?"?-?\d+(\.\d+)?\\?"?\s*,/g) || []).length;
  // 认输那句是不是说了人话（不一定一字不差，抓到"没看出/要画什么"就算）
  const 认输 = /没看出|看不出|不知道要画|要画什么|说不清/.test(t);
  // ★ 自检：**真发出去的那一段 system 里有没有作图提示词的指纹**。
  //   上面那个 mode/work 的教训就是"探针以为自己装好了、其实没装"。
  //   带上这一格，探针就算再写错参数名，也会当场报出来，而不是给我一份合情合理的错读数。
  const sys = SR.api.lastSystem || '';
  const 带了作图 = sys.indexOf('画板认这几条') >= 0 && sys.indexOf('#三维') >= 0;
  // ★ 诊断用：它**写了**画板命令、可围栏掉了（开头三个反引号没写），于是画板收不到。
  //   这是"最糟的那种失败"里最容易被误判成成功的一种——原文里明明有 ggb 和一堆命令。
  const 围栏掉了 = !ggb && /(^|\n)[ \t]*ggb[ \t]*(\n|$)/.test(t);
  return { text: t, ggb, 命令, 叠字, 认输, model: res.model, sysLen: sys.length, 带了作图, 围栏掉了 };
}

(async () => {
  for (const c of CASES) {
    const 记录 = [];
    for (let i = 0; i < N; i++) {
      const r = await one(c);
      if (r.err) { console.log('  ★ ' + c.name + ' 第 ' + (i + 1) + ' 次报错：' + r.err); 记录.push(null); continue; }
      记录.push(r);
      await new Promise(z => setTimeout(z, 400));
    }
    const 活的 = 记录.filter(Boolean);
    if (!活的.length) { 判(c.name + '（' + N + ' 次全报错，量不到）', false); continue; }
    // ★ 只在头一格自检一次：真发出去的那段 system 是不是作图工位那一份。
    if (!自检过) {
      自检过 = 1;
      const r = 活的[0];
      判('★★ 自检：这一格真发出去的是**作图**提示词（不是别的工位、不是空）',
        r.带了作图 === true, 'system ' + r.sysLen + ' 字符');
    }
    const 有围栏 = 活的.filter(r => r.ggb).length;
    const 掉围栏 = 活的.filter(r => r.围栏掉了).length;
    const 简述 = 活的.map(r => JSON.stringify((r.text || '').replace(/\n/g, ' ').slice(0, 70))).join(' | ');
    if (c.wantGgb) {
      判('★ ' + c.name + '「' + c.say + '」 画板真收到命令 ' + 有围栏 + '/' + 活的.length +
        (掉围栏 ? '（其中 ' + 掉围栏 + ' 次是**写了命令但围栏掉了**）' : ''),
        有围栏 === 活的.length, 活的[0].model);
      // ★ 光有围栏不算数：还得看它**有没有照这句话画**。
      //   只判"有围栏"的话，模型把提示词里的范例原样粘回来也是满分——
      //   上面那版用例就是这么骗过我的。
      const 对题 = 活的.filter(r => c.must.test(r.命令)).length;
      判('   而且真照这句话画了（命令里有 ' + c.must + '）', 对题 === 活的.length, 对题 + '/' + 活的.length);
      // 叠字：老毛病是模型自己在轴下面再写一遍整数刻度数，跟画板写的叠在一起
      const 叠的 = 活的.reduce((s, r) => s + r.叠字, 0);
      判('   没有把整数刻度再写一遍（叠字糊图的老毛病）', 叠的 === 0, '共 ' + 叠的 + ' 条 文本(裸数字,…)');
    } else {
      判('★★ ' + c.name + '「' + c.say + '」 **不许**硬凑一张图（出图 ' + 有围栏 + '/' + 活的.length + '，得是 0）',
        有围栏 === 0, 简述);
      判('   而且它说了一句人话（明说看不出要画什么）',
        活的.filter(r => r.认输).length >= Math.ceil(活的.length / 2),
        活的.map(r => r.认输).join(','));
    }
  }
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

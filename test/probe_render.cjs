// 渲染那层的自检：拆围栏 + "该删的行"三条规则。
//
// ★ 为什么单独一个文件：这三条规则全是"删学生看得见的东西"，删错一次就是
//   把老师的正文吃掉一段，而且**只会在真人用的时候才被发现**——探针跑的是字符串，
//   不会告诉你"我们把老师那句话删了"。所以每条规则都要有反例（该留的必须留下）。
//
// 用法: node test/probe_render.cjs
//   退出码 0 = 全过；1 = 有不该删的被删了或该删的没删
//
// 用例里那些"原话"，都是从 2026-10-01 免费通道（glm-4-flash-250414）的真实回复里抄的：
//   DUMP=1 node test/probe_fence.cjs 6 glm 求画数轴   ← 会把每一条原文打出来
const path = require('path'), fs = require('fs');

const W = { SR: {} };
new Function('window', 'localStorage', 'navigator',
  fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'))(W, {}, { onLine: true });
const R = W.SR.render;

// 反引号写成 BT 免得在这文件里被自己的围栏绕晕
const BT = '```';

const CASES = [
  // ---- 规则一：整行就是一个开关命令 ----
  {
    name: '掉围栏的纯命令（学生）',
    mode: 'student',
    in: '#清空\n数轴\nA=(-2,0)\nB=(0,0)\nC=(2,0)',
    want: ''                      // 真话：这一整段没有一句是给学生看的
  },
  {
    name: '带参数的隐藏/播放',
    mode: 'student',
    in: '看好了。\n#隐藏 t\n#播放 t\n点下面的播放键。',
    want: '看好了。\n点下面的播放键。'
  },
  {
    name: '★反例：老师正文里的"数轴"那行不能删',
    mode: 'student',
    in: '我们在数轴上标出 -2。',
    want: '我们在数轴上标出 -2。'
  },
  {
    name: '★反例：无井号的"播放 暂停"不能删',
    mode: 'student',
    in: '播放 暂停\n这两个键你会用吗？',
    want: '播放 暂停\n这两个键你会用吗？'
  },

  // ---- 规则二：整行只有反引号（没带标签的围栏）----
  {
    name: '★成对的无标签围栏（真实原话）',
    mode: 'student',
    in: '#清空\n数轴\n' + BT + '\n#清空\n数轴\n' + BT + '\n\n' + BT + '想说\n我画不出来\n我不会比\n我不会画\n' + BT,
    want: ''
  },

  // ---- 提示词里的内部编号被念出来（真实原话，见 render.js）----
  {
    name: '★"按办法三，先把空数轴给你。" → 半截插入语删掉',
    mode: 'student',
    in: '按办法三，先把空数轴给你。你自己把题目里的数标上去。',
    want: '先把空数轴给你。你自己把题目里的数标上去。'
  },
  {
    name: '★反例：老师正说"走到第五台阶"不能动',
    mode: 'student',
    in: '我们走到第五台阶了。',
    want: '我们走到第五台阶了。'
  },
  {
    name: '★收尾停在编号上也要认',
    mode: 'student',
    in: '数轴给你了。按办法三',
    want: '数轴给你了。'
  },

  // ---- 标签掉了、内容还在：光秃秃一个"想说"（真实原话，见 render.js）----
  {
    name: '★裸标签想说：短句收成按钮',
    mode: 'student',
    in: '#清空\n数轴\n想说\n我想知道数轴上左边和右边的数谁大\n我不确定左边是负数还是正数',
    want: '',
    say: 1
  },
  {
    name: '★裸标签想说 + 尾巴上那个孤 ``` 不算内容',
    mode: 'student',
    in: '#清空\n数轴\n想说\n我画不出数轴\n我不知道怎么画\n我不会放点\n' + BT,
    want: '',
    say: 1
  },
  {
    name: '★裸标签想说：后面拖着一大段正文，只删标签不删正文',
    mode: 'student',
    in: '想问什么？\n想说\n这道题你当时是怎么做的，从第一步开始说，把你写下来的每一步都念给我听，念到哪算哪。',
    want: '想问什么？\n这道题你当时是怎么做的，从第一步开始说，把你写下来的每一步都念给我听，念到哪算哪。',
    say: 0
  },
  {
    name: '裸标签 ggb 单独一行也删',
    mode: 'student',
    in: '画好了。\nggb\n你看看。',
    want: '画好了。\n你看看。'
  },

  // ---- 规则三：整行就是一条画板赋值（只学生模式删）----
  {
    name: '赋值也删：t=Slider(...)',
    mode: 'student',
    in: 't=Slider(-4,4,0.1)\nP=(t,0)\n你看见点 P 了吗？',
    want: '你看见点 P 了吗？'
  },
  {
    name: '赋值也删：c=正方体(A,B)',
    mode: 'student',
    in: 'c=正方体(A,B)\n转一转看看。',
    want: '转一转看看。'
  },
  {
    name: '★反例：正文里的 y=2x+1 / f(x)=2x+1 / x=3 都要留下',
    mode: 'student',
    in: 'y=2x+1\nf(x)=2x+1\nx=3',
    want: 'y=2x+1\nf(x)=2x+1\nx=3'
  },
  {
    name: '★反例：带汉字的板书行不删',
    mode: 'student',
    in: '顶点 A=(0,0) 就在这里。',
    want: '顶点 A=(0,0) 就在这里。'
  },
  {
    name: '★演示模式不删赋值：老师板书 y=(x+1)(x-2)',
    mode: 'demo',
    in: 'y=(x+1)(x-2)',
    want: 'y=(x+1)(x-2)'
  },

  // ---- 围栏本身还是要照旧摘干净 ----
  {
    name: '正常围栏：正文干净、命令进 ggb',
    mode: 'student',
    in: '数轴给你放这儿了。\n\n' + BT + 'ggb\n#清空\n数轴\n' + BT + '\n\n' + BT + '想说\n我画不出来\n我不会比\n我不会画\n' + BT,
    want: '数轴给你放这儿了。',
    ggb: 1, say: 1
  },
  {
    name: '半截围栏还是藏着（流式）',
    mode: 'student',
    in: '正文' + BT + 'ggb\n#清空\n数轴',
    want: '正文'
  }
];

// ★★ 2026-10-02 修：这里原来传的是 `{ student: ... }`，而产品的选项早就改名成
//   `stripAssign`（见 js/render.js 规则三那段注释、`SR.WORKS[x].stripAssign`）。
//   于是三条"赋值也删"的格子**一直在红**——而红的原因是**尺子喊错了参数名**，
//   跟产品对不对毫无关系。这比一段没写的检查更坏：它红着，别的红就没人看得见了。
//   ⚠ 用例名里那个「学生」是旧说法的残留（当年是"学生版删、演示版留"，
//     现在是"备课／讲评删、画图／出题留"）。**语义没变**（一个开关的开与关），
//     所以夹具一个字不动，只把递给产品的那个名字改对。
// ★ 选项名只在这一个常量里写一次：下面既用它递参数，也拿它去产品源码里核。
//   （这样"尺子喊错名字"这件事本身有一个断言盯着，而不是等它变成一片红。）
const OPT_STRIP = 'stripAssign';

// ---- 尺子自检：产品源码里真的要读这个名字吗 ----
// ★ 这一格是为上面那次翻车写的：参数名被改掉之后**尺子不会自己知道**，
//   它只会一直红，而红的样子跟"产品坏了"长得一模一样。所以直接去源码里找
//   `opts.<名字>`。找不到 = 我们喊的名字产品根本没在听，**上面每一条都不算数**。
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
const nameOK = SRC.indexOf('opts.' + OPT_STRIP) >= 0;
if (!nameOK) {
  console.log('★★★ 尺子喊的选项名（opts.' + OPT_STRIP + '）在 js/render.js 里找不到 ——');
  console.log('    说明产品改过参数名了。**下面那些红绿一条都别信**，先把名字对齐：');
  console.log('    语法：grep -n "opts\\." js/render.js');
  process.exit(3);
}
console.log('尺子自检：产品确实在读 opts.' + OPT_STRIP + '  ✓');
console.log('');

let bad = 0;
for (const c of CASES) {
  const opts = {}; opts[OPT_STRIP] = c.mode === 'student';
  const p = R.parseFences(c.in, opts);
  const got = p.visible;
  const okV = got === c.want;
  const okG = c.ggb == null || p.ggb.length === c.ggb;
  const okS = c.say == null || p.say.length === c.say;
  const ok = okV && okG && okS;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
  if (!okV) {
    console.log('      期望〔' + c.want.replace(/\n/g, ' ⏎ ') + '〕');
    console.log('      实际〔' + got.replace(/\n/g, ' ⏎ ') + '〕');
  }
  if (!okG) console.log('      ggb 块数 期望 ' + c.ggb + ' 实际 ' + p.ggb.length);
  if (!okS) console.log('      想说块数 期望 ' + c.say + ' 实际 ' + p.say.length);
}
console.log('\n===== 拆围栏 ' + (CASES.length - bad) + '/' + CASES.length + ' 通过 =====');
// 上面那行数字没骗人：每一条都印了名字和全绿/全红，红的那条会把它自己的输入输出摊开
process.exit(bad ? 1 : 0);

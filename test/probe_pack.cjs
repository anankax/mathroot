// 「打包」的验收：点一下，老师拿到一个 **别人机器上能解开、中文名不乱码、图有署名**
// 的 .zip（图 + 全程文字）。
//
// ★★ 为什么这份非要有**外部的闸**（test/check_zip.py）：
//   包是我们用 js/docx.js 那个手写的写入器造出来的（CRC 查表、两个头、EOCD 偏移全是自己算的）。
//   要是再拿我们自己的读取器读一遍，错了也是两边一起错——CRC 算错、偏移写错、
//   中文名没置位 11，这几种坏法**在自读自验里一个字节的错都证不出来**。
//   所以最后一关交给 CPython 的 zipfile（一套完全无关的实现），而且那正是
//   "老师双击解压"会走的那条路。
//
// ★ 分两腿，因为"便宜程度"和"能证什么"差一个数量级：
//   A 腿（Node，永远跑）：**纯函数 + 写入器**。
//     · fileName / shapeOf / figures / markdown / withBom 这五件事对不对；
//     · 拿真写入器造一个包，交给 Python 验 → 证明"我们写出来的东西外部读得对"。
//     ★ 还要造一个**故意没带 BOM 的**包，看 Python 是不是真报那一句 —— 不然上面那片绿
//       只证明"闸没响"，不证明"闸会响"。**假绿和假红一样糟。**
//   B 腿（浏览器，要 LIVE=1）：**真画板 + 真界面**。
//     · 水印：shoot（出材料那条）与 shootMarked 的差异必须**只落在右下角那一块**；
//     · 打包全程：喂四条回复 → make() → 字节拿回来 → 交给 Python；
//     · 画板归位：打完包，画板必须回到他点之前的那张图；
//     · 界面上那一颗按钮真的挂上了（在真对话里走一遍，见下面 __stubApi）。
//   ⚠ 两腿缺一不可，也**不许拿 A 腿的绿当 B 腿的绿**：A 腿过了 B 腿没跑，
//     总结那行会明写「B 腿没跑」，别把它读成"过了"。
//
// 用法:
//   node test/probe_pack.cjs              只跑 A 腿
//   LIVE=1 node test/probe_pack.cjs       连 B 腿一起（先 node test/serve.cjs 8138，Chrome 在 9222）
//   SITE=https://anankax.github.io/mathroot/index.html LIVE=1 node test/probe_pack.cjs
//   退出码 0 = 跑的这几腿全过；1 = 有红的；3 = 尺子自己坏了 / 这一腿根本没跑起来
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { spawnSync } = require('child_process');

const PY = path.join(__dirname, 'check_zip.py');
const TMP = path.join(__dirname, '_tmp');
const sha256 = u8 => crypto.createHash('sha256').update(Buffer.from(u8)).digest('hex');

// ============================================================
//  A 腿：纯函数（node 里能跑，几毫秒）
// ============================================================
global.window = global;                    // js/*.js 顶上摸 window，Node 里给它一个
const docx = require('../js/docx.js');     // ← pack.js 的 zip 写入器就是它
const figures = require('../js/figures.js');
const pack = require('../js/pack.js');

const selfBad = [];
if (!pack || typeof pack.make !== 'function') {
  console.log('★ js/pack.js 没加载起来（或者没导出 make）—— 下面每一条都别信。');
  process.exit(3);
}
if (typeof figures.linesOf !== 'function' || typeof figures.bytesOf !== 'function') {
  selfBad.push('js/figures.js 没导出 linesOf / bytesOf：打包要靠它拿"一张图 = 先清空 + 那几行"这条规矩，' +
    '以及"dataURL → 字节"（CRC 必须算在字节上）。缺了的话 B 腿整条都跑不动');
}

let bad = 0;
const say = (ok, name, extra) => {
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name);
  if (extra) console.log('      ' + extra);
};

// ---- 这一场假的对话（形状照真实的抄：链子文字 + 围栏里的画板命令）----
//   ★★ 命令一律写成**多行**——模型在 ```ggb 围栏里就是这么写的（js/render.js:34 原样收下，
//     不碰换行）。这一条是**故意的**、也是这份夹具最要紧的地方：
//     `linesOf()` 原来只切分号，多行那一份**一行都切不开**，整块带着 \n 送进
//     evalCommand → 打包里每张图都是空的，而且**不出声**（pack 只看见 shoot 回了张白图）。
//     假数据要是写成 `A=(1,0);B=(2,0)` 那种单行，这个坏法一个字都量不到。
//   ★ 四条各钉一件事：
//     ① 正常一张图
//     ② 头一块是 f(x)（新图）；第二块是①的**另一种空白写法**（该被当成同一张，不重复收）
//     ③ 只有一个 `#清空`      （模型空发围栏是常态，不算图）
//     ④ 头一块全是 `#` 指令（`#清空`+`#隐藏`，不算图）；**第二块是真图**——
//        它是"这一场最后一张"，老师点到中间某一条去打包时，画板要还原到它（见 B 腿最后一格）
const TURNS = [
  { visible: '先把这两个点摆上去。\n\n第 1 个环节 · 认出起点', ggb: ['A=(-2,0)\nB=(3,0)\nSegment(A,B)'] },
  { visible: '再看它的图象。\n\n第 2 个环节 · 换个角度', ggb: ['f(x)=x^2', '  A=(-2,0)\n  B=(3,0)\n  Segment(A,B)  '] },
  { visible: '这一步没有图，只有话。', ggb: ['#清空'] },
  { visible: '收尾。', ggb: ['#清空\n#隐藏 xAxis', 'C=(1,2)\nD=(4,5)\nSegment(C,D)'] }
];
// 这一包里**该收的**是哪三块（顺序 = 讲课顺序，去重之后）
const WANT_FIGS = [TURNS[0].ggb[0], TURNS[1].ggb[0], TURNS[3].ggb[1]];
pack.__seed(TURNS, '3.1 代数式的值/第二课时');

console.log('===== A 腿：纯函数（' + TURNS.length + ' 条假回复）=====');

// ---- 1. 文件名 ----
const NAME_CASES = [
  ['3.1 代数式的值/第二课时', '数根-3.1 代数式的值 第二课时.zip',
    '斜杠在 Windows 上**根本建不出文件**（不是显示成别的，是存不下来）。课题是老师自己打的字，' +
    '完全可能带着它'],
  ['这一课？', '数根-这一课？.zip',
    '★ 反过来那一格：**全角「？」是合法字符，不许洗掉**。洗了就是把老师自己打的字吃了。' +
    '（ASCII 的 `?` 才是非法的——上面 NASTY 那条撞的就是它。）'],
  ['', '数根-这一课.zip', '没课题时得有个兜得住的默认名，不能是 `数根-.zip`'],
  ['末尾有点...', '数根-末尾有点.zip', 'Windows 会把名字末尾的点和空格悄悄吃掉，然后文件名对不上'],
  ['一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十', '数根-一二三四五六七八九十一二三四五六七八九十一二三四.zip',
    '太长要截（截到 24 字），不然有些解压软件会截断成乱码'],
  ['换\n行\t也\t算', '数根-换 行 也 算.zip', '换行/制表符在文件名里是脏东西，一律换成空格']
];
for (const [inp, want, why] of NAME_CASES) {
  const got = pack.fileName(inp);
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + '文件名〔' + JSON.stringify(inp) + '〕→ ' + got);
  if (!ok) console.log('      期望〔' + want + '〕' + (why ? '\n      ' + why : ''));
}
// ★ 非法字符一个都不许漏出来——这是这一格唯一真正要保证的事，
//   所以拿一份"全非法字符"的字符串去撞（不逐个断言，只问"还剩没剩"）。
const NASTY = 'a\\b/c:d*e?f"g<h>i|j';
const nastyGot = pack.fileName(NASTY);
say(!/[\\\/:*?"<>|]/.test(nastyGot), '非法字符一个都不剩（喂进去 ' + NASTY + '）', '得到〔' + nastyGot + '〕');

// ---- 2. 一张图叫什么（从命令认内容，认不出来绝不硬猜）----
const SHAPE_CASES = [
  ['#三维\nCube((0,0,0),(1,1,1))', '立体图', '认得出'],
  ['Slider(-4,4,0.1)', '动点', '认得出'],
  ['Circle((0,0),2)', '圆', '认得出'],
  ['Polygon((0,0),(1,0),(1,1))', '多边形', '认得出'],
  ['f(x)=x^2', '函数图象', '认得出'],
  ['A=(-2,0)\nB=(3,0)\nSegment(A,B)', '图', '★ 认不出来，必须老实叫「图」'],
  ['', '图', '★ 空命令也是「图」，不许抛异常']
];
for (const [cmds, want] of SHAPE_CASES) {
  const got = pack.shapeOf(cmds);
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + '形状〔' + String(cmds).replace(/\n/g, '⏎').slice(0, 40) + '〕→ ' + got +
    (ok ? '' : '（期望 ' + want + '）'));
}

// ---- 3. ★ 一份命令 = 哪几行（linesOf）----
//   这一格是这份探针里**最值钱**的一格：它是唯一能在 node 里、不碰画板
//   就抓住"多行命令切不开"这个坏法的地方。真出过这个毛病（见 TURNS 上面那段）。
const L1 = figures.linesOf('A=(-2,0)\nB=(3,0)\nSegment(A,B)');
const L2 = figures.linesOf('A=(1,0);B=(2,0)；C=(3,0)');
say(L1.length === 4, '多行的那一份：切成 4 条（前面补的 #清空 + 3 条）', JSON.stringify(L1));
say(L1.every(x => x.indexOf('\n') < 0), '★ 切出来的每一条里**一个换行都不许剩**',
  '剩下的：' + JSON.stringify(L1.filter(x => x.indexOf('\n') >= 0)));
say(L2.length === 4, '单行分号那一份（半角 + 全角）也切成 4 条', JSON.stringify(L2));
say(L1[0] === '#清空' && L2[0] === '#清空', '两份都是开头先 `#清空`（上一张的残留绝不能串进来）');
say(L2.indexOf('') < 0 && figures.linesOf('A=(1,0)\n\n\nB=(2,0)').length === 3,
  '空行/空段被丢掉（不然会往画板塞空命令）', JSON.stringify(figures.linesOf('A=(1,0)\n\n\nB=(2,0)')));
say(JSON.stringify(figures.linesOf('')) === JSON.stringify(['#清空']), '空命令只回一条 `#清空`，不抛异常');

// ---- 4. 这一包里该有哪几张图 ----
const fAll = pack.figures(null), f0 = pack.figures(0), f1 = pack.figures(1);
say(fAll.length === 3, '去重 + 跳过空围栏：四条回复里只该收 3 张图', '实收 ' + fAll.length + ' 张');
say(f0.length === 1, '「到第 1 条为止」只收 1 张', '实收 ' + f0.length + ' 张');
say(f1.length === 2, '「到第 2 条为止」收 2 张（第 2 条那条是重复的，不重复收）', '实收 ' + f1.length + ' 张');
say(JSON.stringify(fAll) === JSON.stringify(WANT_FIGS),
  '收的是**第一次见到的那份原文**（顺序 = 讲课顺序）', JSON.stringify(fAll).slice(0, 80) + '…');

// ---- 5. 全程文字 ----
const md = pack.markdown(null);
const md0 = pack.markdown(0);
say(TURNS.every(t => md.indexOf(t.visible) >= 0), '四条回复的**看得见的文字**都在里面');
say(md.indexOf('A=(-2,0)') < 0 && md.indexOf('Segment(') < 0,
  '★ 画板命令一个字都没进去（那是给板子看的，不能被老师贴进教案）');
say(md0.indexOf(TURNS[0].visible) >= 0 && md0.indexOf(TURNS[3].visible) < 0,
  '「到第 1 条为止」只带第 1 条的文字');
say(md.indexOf('数根 mathroot') >= 0, '末尾有署名（跟工具条「存图」一个道理：这包会被传出去）');

// ---- 6. BOM ----
const bomBytes = pack.withBom('备课全程\n');
say(bomBytes.length === new TextEncoder().encode('备课全程\n').length + 3 &&
  bomBytes[0] === 0xEF && bomBytes[1] === 0xBB && bomBytes[2] === 0xBF,
  '★ .md 头三个字节是 EF BB BF（Windows 记事本靠它认出 UTF-8）',
  '实读 ' + [bomBytes[0], bomBytes[1], bomBytes[2]].map(x => x.toString(16)).join(' '));

// ---- 7. 写入器 + 外部闸 ----
// ★ 这一格是 A 腿的**主项**：拿真写入器造真包，交给 Python。
//   造两个：一个对的（该全绿）、一个**故意没 BOM 的**（该只报 BOM 那一条）。
const FAKE_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
  Buffer.from([0, 0, 0, 120, 0, 0, 0, 90]),      // 宽 120、高 90
  Buffer.from([8, 2, 0, 0, 0]), Buffer.alloc(4)
]);
const png1 = new Uint8Array(FAKE_PNG);
const mdBytes = pack.withBom(md);

function writeZip(tag, files) {
  fs.mkdirSync(TMP, { recursive: true });
  const u8 = docx.write(files);
  const zp = path.join(TMP, 'pack-' + tag + '.zip');
  fs.writeFileSync(zp, Buffer.from(u8));
  fs.writeFileSync(path.join(TMP, 'pack-' + tag + '.json'), JSON.stringify({
    files: files.map(f => ({ name: f.name, size: f.data.length, sha256: sha256(f.data) }))
  }, null, 2));
  return { zip: zp, u8: u8 };
}

function runPy(zipPath, extra) {
  const args = [PY, zipPath].concat(extra || []);
  const r = spawnSync('python', args, { encoding: 'utf8' });
  if (r.error) return { ran: false, why: r.error.message };
  return { ran: true, code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const good = writeZip('node', [
  { name: '01-图.png', data: png1 },
  { name: '02-立体图.png', data: png1 },
  { name: '备课全程.md', data: mdBytes }
]);
const nobom = writeZip('node-nobom', [
  { name: '01-图.png', data: png1 },
  { name: '备课全程.md', data: new TextEncoder().encode(md) }     // ← 故意不带 BOM
]);

const g1 = runPy(good.zip);
console.log('');
console.log('===== A 腿外部闸：python test/check_zip.py（CPython 的 zipfile，另一套实现）=====');
if (!g1.ran) {
  console.log('  ★ 没跑起来（' + g1.why + '）—— **这一格没验，不算过**。');
  console.log('    手动跑：python test/check_zip.py ' + good.zip);
  selfBad.push('python 没跑起来，外部闸这一整块没验');
} else {
  console.log(g1.out.trim().split('\n').map(x => '  ' + x).join('\n'));
  const okClean = g1.code === 0 && /干净/.test(g1.out);
  bad += okClean ? 0 : 1;
  if (!okClean) console.log('  ✗ 我们写出来的真包，外部读取器判它有问题（上面每一条都在讲什么坏了）');

  // ★ 反方向：**闸会响吗。** 这一格比上面那格重要——
  //   一个永远说"干净"的闸，和一片真的干净，在输出上长得一模一样。
  const g2 = runPy(nobom.zip);
  console.log('');
  const lines2 = g2.out.trim().split('\n');
  console.log(lines2.map(x => '  ' + x).join('\n'));
  const hitBom = /BOM/.test(g2.out) && g2.code === 1;
  const onlyBom = hitBom && !/CRC 坏|0x0800|内容对不上|不是一张正常的 PNG|序号不连续/.test(g2.out);
  bad += (hitBom && onlyBom) ? 0 : 1;
  console.log((hitBom && onlyBom ? '  ✓ ' : '  ✗ ') +
    '再把那个「故意没带 BOM」的包喂给它：只报 BOM 这一条，别的都不报' +
    (hitBom ? '' : ' ★ 它没报 —— 上面那格"干净"就不算数'));
}

// ---- A 腿尺子自检 ----
// ★ 只问"我在不在工作"，**不问"产品对不对"**。（逐字比对产品输出会把产品行为焊进自检，
//   产品一退化自检就喊"尺子坏了"，把人指错方向——这条坑 test/probe_math.cjs 顶上记着。）
if (!TURNS.length) selfBad.push('假回复表是空的，"去重收 3 张"是空转通过');
if (!TURNS.some(t => (t.ggb || []).some(g => g.indexOf('\n') > 0)))
  selfBad.push('★ 夹具里**没有一条多行命令** —— "多行切不开"那个坏法（这份探针最值钱的一格）会空转通过。' +
    '模型在 ```ggb 围栏里写的就是多行，假数据写成单行就等于没量');
if (!NAME_CASES.some(c => c[1] !== c[0])) selfBad.push('文件名那条：没有一格"喂进去和出来不一样"的，等于没量到它会不会洗');
if (!NAME_CASES.some(c => c[0].indexOf('？') >= 0)) selfBad.push('文件名那条：没有一格"全角标点该原样留着"的，就分不清"洗干净了"和"洗过头了"');
if (!SHAPE_CASES.some(c => c[1] !== '图')) selfBad.push('形状那条：全是兜底格，认不认得出根本没量到');
if (!SHAPE_CASES.some(c => c[1] === '图')) selfBad.push('形状那条：没有一格兜底的，"见什么说什么"的坏法量不到');
{
  // 拿一份**明知该被洗**的文件名进去，看它到底动不动（只问动没动，不逐字断言）
  const can = pack.fileName('a/b');
  if (can === 'a/b' || can.indexOf('/') >= 0) selfBad.push('喂一个带斜杠的进去，它一点没洗 —— 上面那些"洗掉了"的绿都是假的');
  // ★ 拿一份**明知切得开**的多行命令进去，看 linesOf 到底切不切。
  //   只问"切出来的条数有没有变多"——**不逐字断言它切成了哪几条**：
  //   逐字比对产品输出就是把产品行为焊进自检，产品一改就喊"尺子坏了"（这条坑记着）。
  const n = figures.linesOf('Circle((0,0),1)\nSlider(1,2,0.1)').length;
  if (n < 3) selfBad.push('喂两句多行命令进去，linesOf 只回了 ' + n + " 条（该是 3：#清空 + 两条）——" +
    '上面"每条里没有换行"那片绿是空转通过的');
  // 拿一份**明知有图**的命令串，看 figures 收不收得着（怕它永远返回 []）
  pack.__seed([{ visible: 'x', ggb: ['Circle((0,0),1)'] }], '自检');
  if (pack.figures(null).length !== 1) selfBad.push('喂一条明知有图的命令，figures() 收不着 —— 上面"只收 3 张"那个数不算数');
  pack.__seed(TURNS, '3.1 代数式的值/第二课时');   // 还原，别把自检的假数据留给后面
}

console.log('');
console.log('===== A 腿尺子自检 =====');
if (selfBad.length) {
  console.log('★★★ 尺子自己坏了 —— 下面那份清单**一条都别信**，先修 test/probe_pack.cjs：');
  selfBad.forEach(x => console.log('    · ' + x));
  process.exit(3);
}
console.log('  用例表非空、两边都有（该洗的/不该动的、认得出的/兜底的、多行的/单行的）  ✓');
console.log('  喂一个明知不干净的进去，它真的会动  ✓');
console.log('  喂两句多行命令进去，它真的会切  ✓');
console.log('');
console.log('===== A 腿结果 =====');
console.log('  ' + (bad ? '★ 有 ' + bad + ' 格红了，见上面' : '全过'));
console.log('  ⚠ 这只证明**纯函数和写入器**。真画板画出来的图、界面上那颗按钮，得看 B 腿。');

if (!process.env.LIVE) {
  console.log('');
  console.log('===== B 腿：没跑 =====');
  console.log('  它要真画板出图、真界面上挂按钮（那才是"老师点下去会拿到什么"的直接证据）。');
  console.log('  开法：先 `node test/serve.cjs 8138`，Chrome 挂在 9222，再：');
  console.log('    LIVE=1 node test/probe_pack.cjs');
  console.log('  ★ 上面 A 腿的绿**不能**替 B 腿结账。');
  process.exit(bad ? 1 : 0);
}

// ============================================================
//  B 腿：浏览器
// ============================================================
const http = require('http');
let WebSocket;
try {
  WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
} catch (e) {
  console.log('\n★ B 腿起不来：找不到 ws 模块（' + e.message + '）。退出码 3，别把这次读成"过了"。');
  process.exit(3);
}
const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
  r.on('error', rej); r.end();
});
const closeTab = id => new Promise(res => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res));

(async () => {
  let TAB = null;
  try {
    const t = JSON.parse(await put('/json/new?about:blank'));
    TAB = t.id;
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pend = {};
    const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
    await new Promise(r => ws.on('open', r));
    await send('Runtime.enable', {}); await send('Page.enable', {});
    const q = async e => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      const Rr = r.result;
      if (Rr && Rr.exceptionDetails) return 'THROW: ' + String(Rr.exceptionDetails.exception && Rr.exceptionDetails.exception.description).slice(0, 300);
      return Rr && Rr.result ? Rr.result.value : null;
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const SITE = process.env.SITE || 'http://localhost:8138/index.html';
    console.log('');
    console.log('  （量的地方：' + SITE + '）');
    await send('Page.navigate', { url: SITE });
    await sleep(1200);
    // ★ 硬重载：同域的普通导航会吃缓存，会把**已经生效的改动**误判成"没生效"。
    await send('Page.reload', { ignoreCache: true });
    await sleep(3000);

    // 尺子自检：页面里那几件东西在不在。缺哪一样就**说清是哪一样**，
    // 不是干巴巴一句"没就绪"（上一次栽在这上面：睡的固定秒数，CDN 还没下来就报"功能没了"）。
    const PROBE = `({ pack: typeof SR!=='undefined' && !!(SR.pack && typeof SR.pack.make==='function'),` +
      ` marked: !!(SR.board && typeof SR.board.shootMarked==='function'),` +
      ` shoot: !!(SR.board && typeof SR.board.shoot==='function'),` +
      ` draw: !!(SR.board && typeof SR.board.draw==='function'),` +
      ` saveBytes: !!(SR.docx && typeof SR.docx.saveBytes==='function'),` +
      ` linesOf: !!(SR.figures && typeof SR.figures.linesOf==='function'),` +
      ` bytesOf: !!(SR.figures && typeof SR.figures.bytesOf==='function'),` +
      ` chat: !!(SR.chat && typeof SR.chat.submit==='function'),` +
      ` state: document.readyState })`;
    let parts = null, tried = 0;
    for (; tried < 20; tried++) {
      parts = await q(PROBE);
      if (parts && parts.pack && parts.marked && parts.draw && parts.chat) break;
      await sleep(1000);
    }
    if (!parts || !parts.pack || !parts.marked || !parts.draw || !parts.chat) {
      console.log('\n★★★ B 腿开不了，等了 20 秒还是缺东西 —— 下面每一条都别信：');
      console.log('    SR.pack.make       ' + (parts && parts.pack ? '在' : '★ 不在（js/pack.js 没加载？index.html 里那行 <script> 加了吗？）'));
      console.log('    SR.board.shootMarked ' + (parts && parts.marked ? '在' : '★ 不在'));
      console.log('    SR.board.draw      ' + (parts && parts.draw ? '在' : '★ 不在'));
      console.log('    SR.chat.submit     ' + (parts && parts.chat ? '在' : '★ 不在'));
      console.log('    SR.docx.saveBytes  ' + (parts && parts.saveBytes ? '在' : '★ 不在'));
      console.log('    SR.figures.bytesOf ' + (parts && parts.bytesOf ? '在' : '★ 不在'));
      console.log('    document.readyState ' + (parts ? parts.state : '读不到'));
      await closeTab(TAB); process.exit(3);
    }

    let bBad = 0;

    // ---- 装进页面的量具，只装一份 ----
    // u8 → base64（分块，别用 apply 一次塞几十万个参数——大包会栈溢出）
    await q(`window.__pkB64 = function (u8) {
      var s = '', CH = 8192;
      for (var i = 0; i < u8.length; i += CH)
        s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
      return btoa(s);
    }; 1`);
    // 两张图的逐像素差异：尺寸 + 差异像素数 + **差异落在哪个矩形里**
    await q(`window.__pkDiff = function (aURL, bURL) {
      function load(u) { return new Promise(function (res, rej) {
        var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = u; }); }
      return Promise.all([load(aURL), load(bURL)]).then(function (ims) {
        var a = ims[0], b = ims[1];
        if (a.width !== b.width || a.height !== b.height)
          return { w: a.width, h: a.height, bw: b.width, bh: b.height, sizeDiff: true };
        function px(im) {
          var c = document.createElement('canvas');
          c.width = im.width; c.height = im.height;
          var g = c.getContext('2d'); g.drawImage(im, 0, 0);
          return g.getImageData(0, 0, im.width, im.height).data;
        }
        var da = px(a), db = px(b), n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (var y = 0; y < a.height; y++) for (var x = 0; x < a.width; x++) {
          var i = (y * a.width + x) * 4;
          if (Math.abs(da[i] - db[i]) > 4 || Math.abs(da[i+1] - db[i+1]) > 4 || Math.abs(da[i+2] - db[i+2]) > 4) {
            n++;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        return { w: a.width, h: a.height, sizeDiff: false, n: n, box: n ? [x0, y0, x1, y1] : null };
      });
    }; 1`);

    // ---- 1. 画一张图，比较 shoot 与 shootMarked ----
    console.log('');
    console.log('===== B 腿：水印只落在右下角（存图的署名，不许动到图本身）=====');
    const CMDS = '#清空;A=(-2,0);B=(3,0);Segment(A,B)';
    const drew = await q(`new Promise(function (res) {
      SR.board.draw(SR.figures.linesOf(${JSON.stringify(CMDS)}), function (ok) { res(!!ok); });
    })`);
    if (drew !== true) {
      console.log('  ★ 画板画不出来（draw 回了 ' + JSON.stringify(drew) + '）——下面那几格别信。');
      bBad++;
    } else {
      const two = await q(`new Promise(function (res) {
        SR.board.shoot(function (u1, w1, h1) {
          if (!u1) return res({ err: 'shoot 没出图' });
          SR.board.shootMarked(function (u2, w2, h2) {
            if (!u2) return res({ err: 'shootMarked 没出图' });
            res({ w1: w1, h1: h1, w2: w2, h2: h2, same: u1 === u2 });
          });
        });
      })`);
      if (!two || two.err) {
        console.log('  ✗ ' + (two && two.err ? two.err : '读不到') + ' —— 画不出图就等于打包里没有图');
        bBad++;
      } else {
        const okSize = two.w1 === two.w2 && two.h1 === two.h2;
        console.log('  尺寸：shoot ' + two.w1 + '×' + two.h1 + '　shootMarked ' + two.w2 + '×' + two.h2 +
          '　' + (okSize ? '✓ 一样（署名不许改变尺寸，不然打包里的图会被拉变形）' : '★ 不一样'));
        if (!okSize) bBad++;
        console.log('  两张字节是否相同：' + (two.same ? '★ 相同 —— 署名根本没画上去！' : '不同（署名画上去了）'));
        if (two.same) bBad++;
        if (!two.same && okSize) {
          // 逐像素比：差异必须**只在右下角那一小块**
          const d = await q(`new Promise(function (res) {
            SR.board.shoot(function (u1) { SR.board.shootMarked(function (u2) { res(window.__pkDiff(u1, u2)); }); });
          })`);
          if (!d || typeof d !== 'object') {
            console.log('  ✗ 逐像素比对读不到（' + JSON.stringify(d) + '）');
            bBad++;
          } else {
            const inCorner = d.n > 0 && d.box && d.box[0] > d.w * 0.5 && d.box[1] > d.h * 0.7;
            console.log('  差异像素 ' + d.n + ' 个（占 ' + (100 * d.n / (d.w * d.h)).toFixed(2) + '%），' +
              '范围 x ' + (d.box ? d.box[0] + '–' + d.box[2] : '-') + '、y ' + (d.box ? d.box[1] + '–' + d.box[3] : '-') +
              '（图 ' + d.w + '×' + d.h + '）');
            console.log((inCorner ? '  ✓ ' : '  ✗ ') +
              '差异全部落在**右下角**（x 过半、y 过七成）' + (inCorner ? '' : ' —— 署名的位置不对，或者它顺手改了别的地方'));
            if (!inCorner) bBad++;
          }
        }
      }
    }

    // ---- 2. 界面上那一颗按钮 ----
    // ★ 这一格是**真走了一遍对话**：把 SR.api.ask 换成一个假的（不花钱、不联网），
    //   然后调真的 SR.chat.submit。于是气泡、账本、按钮全都是**产品自己那条路**建出来的，
    //   不是我们在页面里手搓一个 .packbtn 再量它。
    console.log('');
    console.log('===== B 腿：界面上那颗「打包」（真走一遍对话，模型换成假的）=====');
    const ui = await q(`(function () {
      try {
        var rail = document.querySelector('.workbtn[data-work="prep"]');
        if (rail) rail.click();
        var work = SR.chat.getWork();
        window.__pkOrigAsk = SR.api.ask; window.__pkOrigReady = SR.api.ready;
        SR.api.ready = function () { return true; };
        var REPLY = '我们先看这两个点。\\n\\n第 1 个环节 · 认出起点\\n\\n' +
                    '\`\`\`ggb\\nA=(-2,0)\\nB=(3,0)\\nSegment(A,B)\\n\`\`\`\\n';
        SR.api.ask = function () {
          return Promise.resolve({ text: REPLY, model: 'probe-stub' });
        };
        SR.chat.submit('3.1 代数式的值');
        return { work: work };
      } catch (e) { return { err: String(e && e.message || e) }; }
    })()`);
    if (!ui || ui.err) {
      console.log('  ★ 走不起来：' + JSON.stringify(ui) + '　（这一格没验，不算过）');
      bBad++;
    } else {
      await sleep(700);
      const got = await q(`(function () {
        var bars = document.querySelectorAll('.msg.assistant .copybar');
        var pk = document.querySelector('.msg.assistant .copybar .packbtn');
        var cp = document.querySelector('.msg.assistant .copybar .copybtn');
        if (!pk) return { none: true, bars: bars.length, cp: !!cp };
        var r = pk.getBoundingClientRect();
        var br = pk.parentNode.getBoundingClientRect();
        return {
          work: SR.chat.getWork(), bars: bars.length, cp: !!cp,
          text: pk.textContent, disabled: !!pk.disabled,
          rects: pk.getClientRects().length,
          arrow: getComputedStyle(pk, '::before').content,
          w: Math.round(r.width), h: Math.round(r.height),
          barH: Math.round(br.height),
          inBar: r.left >= br.left - 1 && r.right <= br.right + 1,
          name: SR.pack.fileName(), count: SR.pack.count()
        };
      })()`);
      if (!got || got.none) {
        console.log('  ✗ 气泡下面**没有**「打包」这一颗（copybar 有 ' + (got ? got.bars : '?') +
          ' 个，「复制这段」' + (got && got.cp ? '在' : '★ 也不在') + '）');
        bBad++;
      } else {
        const rows = [
          ['工位是备课（打包只在备课/讲评挂）', got.work === 'prep', got.work],
          ['「复制这段」也在（两颗挨着）', got.cp === true, got.cp],
          ['按钮真的可见（量的是 getClientRects，不是 display）', got.rects > 0, got.rects + ' 个矩形'],
          ['上面那个 ↓ 真的渲染出来了', /↓/.test(String(got.arrow)), JSON.stringify(got.arrow)],
          ['写着「打包」、不是灰的', got.text === '打包' && got.disabled === false, got.text + (got.disabled ? '（灰的）' : '')],
          ['没把那一排挤成两行（按钮没比条子高）', got.barH < got.h * 1.8, '按钮 ' + got.w + '×' + got.h + '，条子高 ' + got.barH],
          ['按钮在条子范围内（没被 overflow 切掉）', got.inBar === true, ''],
          ['账本记了这 1 条', got.count === 1, 'count=' + got.count],
          ['★ 包名用的是**这一场的第一句话**（课题）', got.name === '数根-3.1 代数式的值.zip', got.name]
        ];
        for (const [name, ok, extra] of rows) {
          if (!ok) bBad++;
          console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '　—— ' + extra : ''));
        }

        // ---- 2b. 360px 那档 ----
        //   ★ 「打包」是往那一排上**加的第二颗**按钮，而这一排窄屏上很贵
        //     （js/chat.js 那段长注释里量过：360px 时画板工具条 5 个孩子只剩 20px 余量）。
        //     加完之后必须自己量一遍，不能靠"看代码觉得放得下"。
        const NARROW = { width: 360, height: 640, deviceScaleFactor: 2, mobile: true };
        await send('Emulation.setDeviceMetricsOverride', NARROW);
        await sleep(450);
        const small = await q(`(function () {
          var pk = document.querySelector('.msg.assistant .copybar .packbtn');
          var cp = document.querySelector('.msg.assistant .copybar .copybtn');
          if (!pk || !cp) return { none: true, pk: !!pk, cp: !!cp };
          var r = pk.getBoundingClientRect(), c = cp.getBoundingClientRect();
          var br = pk.parentNode.getBoundingClientRect();
          return { vw: innerWidth, rects: pk.getClientRects().length,
                   w: Math.round(r.width), h: Math.round(r.height),
                   inBar: r.left >= br.left - 1 && r.right <= br.right + 1,
                   barH: Math.round(br.height),
                   sameRow: Math.abs(r.top - c.top) < 4,       // 两颗并排，没被挤到两行
                   overlap: r.left < c.right - 1 && r.right > c.left + 1 };
        })()`);
        await send('Emulation.clearDeviceMetricsOverride', {});   // ★ 量完就还原，别把标签页留在窄屏
        await sleep(300);
        const rowsN = [
          ['360px：按钮还在、没被藏起来', !!(small && !small.none && small.rects > 0),
            small && small.vw ? ('视口 ' + small.vw + 'px' + (small.none ? '，按钮没了' : '')) : '读不到'],
          ['360px：跟「复制这段」**并排**，没被挤成两行', !!(small && small.sameRow), small && small.sameRow === false ? '两颗不在同一行' : ''],
          ['360px：两颗没叠在一起', !!(small && small.overlap === false), small && small.overlap ? '叠上了，有一半点不着' : ''],
          ['360px：按钮没被 overflow 切掉', !!(small && small.inBar), '']
        ];
        for (const [name, ok, extra] of rowsN) {
          if (!ok) bBad++;
          console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '　—— ' + extra : ''));
        }
      }
      // 把假 API 摘掉、对话清掉（探针只借这个标签页用，但别留着一份假 api 在页面里）
      await q(`(function () {
        try { if (window.__pkOrigAsk) SR.api.ask = window.__pkOrigAsk; if (window.__pkOrigReady) SR.api.ready = window.__pkOrigReady; } catch (e) {}
        try { SR.chat.reset(); } catch (e) {}
        return 1; })()`);
      await sleep(400);
    }

    // ---- 3. 打包全程 + 画板归位 + 外部闸 ----
    //
    //   ★★ 这里**故意点到第 2 条**（`make(1)`），不是最后一条。理由：
    //     点最后一条的话，"画完把最后那张再画回来"那句还原是**看不出来的**
    //     ——板子本来就停在最后那张上。要点中间那一条，画板才会先被
    //     前两张图轮番换掉、再由 finish() 还原回"这一场的最后一张"，
    //     那条路径才有得量。（这条路径是真会走的：js/chat.js:466 每一条回复的
    //     打包按钮传的都是**它自己的序号**，老师摆到第三节想先拷走完全合理。）
    console.log('');
    console.log('===== B 腿：真打一个包（画板真画、图真收、字节真交出去）=====');
    const LASTBLK = TURNS[TURNS.length - 1].ggb[TURNS[TURNS.length - 1].ggb.length - 1];
    const seedAndBefore = await q(`(function () {
      SR.pack.__seed(${JSON.stringify(TURNS)}, '3.1 代数式的值/第二课时');
      return { n: SR.pack.count() };
    })()`);
    // 先把画板摆到"这一场的最后一张图"上 —— 老师没点打包之前，板子就是这个样子
    const before = await q(`new Promise(function (res) {
      SR.board.draw(SR.figures.linesOf(${JSON.stringify(LASTBLK)}), function (ok) {
        if (!ok) return res('');
        SR.board.shoot(function (u) { res(u); });
      });
    })`);
    if (typeof before !== 'string' || before.slice(0, 5) !== 'data:') {
      console.log('  ★ 摆不出"点打包之前"那张图（拿到 ' + JSON.stringify(String(before).slice(0, 60)) + '）——下面几格别信。');
      bBad++;
    } else {
      console.log('  账本里 ' + (seedAndBefore && seedAndBefore.n) + ' 条（4 条假回复里该收 3 张图）');
      const made = await q(`new Promise(function (res) {
        SR.pack.make(1, null, function (r) {
          if (!r.ok) return res({ ok: false, why: r.why });
          res({ ok: true, name: r.name, figs: r.figs, missed: r.missed,
                b64: window.__pkB64(r.bytes), len: r.bytes.length });
        });
      })`);
      if (!made || !made.ok) {
        console.log('  ✗ make() 没打成：' + JSON.stringify(made));
        bBad++;
      } else {
        console.log('  make(1) 回来了：' + made.name + '　' + made.figs + ' 张图　' +
          (made.missed ? '★ ' + made.missed + ' 张没画出来（没进包！）' : '没有画不出来的') +
          '　' + made.len + ' 字节');
        if (made.figs !== 2) { bBad++; console.log('  ✗ 该是 2 张图（到第 2 条为止 + 去重之后），实际 ' + made.figs); }
        if (made.missed) bBad++;
        if (made.name !== '数根-3.1 代数式的值 第二课时.zip') {
          bBad++; console.log('  ✗ 包名不对：' + made.name);
        }
        // 落盘 + 交给 Python
        //   ⚠ 清单里只写名字、**不写 sha256**（页面里拿不到每个文件的字节，
        //     make() 只回整包的字节）→ check_zip.py 那边"内容没给就不比内容"，
        //     第 3 条会明写"没查"。别因此以为内容被验过了。
        fs.mkdirSync(TMP, { recursive: true });
        const zp = path.join(TMP, 'pack-live.zip');
        fs.writeFileSync(zp, Buffer.from(made.b64, 'base64'));
        fs.writeFileSync(path.join(TMP, 'pack-live.json'), JSON.stringify({
          files: [TURNS[0], TURNS[1]].map((t, i) => ({
            name: (i + 1 < 10 ? '0' : '') + (i + 1) + '-' + pack.shapeOf(t.ggb[0]) + '.png'
          })).concat([{ name: '备课全程.md' }])
        }, null, 2));
        const gl = runPy(zp);
        if (!gl.ran) {
          console.log('  ★ python 没跑起来（' + gl.why + '）—— **这一格没验，不算过**');
          console.log('    手动跑：python test/check_zip.py ' + zp);
          selfBad.push('python 没跑起来，B 腿的外部闸没验');
        } else {
          console.log(gl.out.trim().split('\n').map(x => '  ' + x).join('\n'));
          if (gl.code !== 0) { bBad++; console.log('  ✗ 真打出来的包，外部读取器判它有问题（上面每一条都在讲什么坏了）'); }
        }

        // 画板归位
        // ★★ 归位要**等它收敛**，不能睡一个固定秒数。
        //   第一次写成 `sleep(1500)` 时它报了红（差 854 个像素）——而那是我量得太早：
        //   还原是 `run()` 排队跑的（550ms 一条，最后一条跑完 GeoGebra 还要几帧才画稳），
        //   加上打包本身刚累了十几条命令，1.5 秒有时够、有时不够。
        //   一个"看运气的红"比没有这条检查更坏：真坏了会被当成"又抽风了"，
        //   没坏的时候又冤枉一次产品。所以改成**连拍**（底下量的是"多久归位"，
        //   不是"1.5 秒那一刻归位没归位"）。
        let after = '', d = null, waited = 0;
        for (let k = 0; k < 10; k++) {
          await sleep(700);
          waited = Math.round((k + 1) * 0.7 * 10) / 10;
          after = await q(`new Promise(function (res) { SR.board.shoot(function (u) { res(u); }); })`);
          if (typeof after !== 'string' || after.slice(0, 5) !== 'data:') break;
          if (after === before) break;
          d = await q(`window.__pkDiff(${JSON.stringify(before)}, ${JSON.stringify(after)})`);
        }
        if (typeof after !== 'string' || after.slice(0, 5) !== 'data:') {
          console.log('  ✗ 打完包之后读不出画板（' + JSON.stringify(String(after).slice(0, 60)) + '）');
          bBad++;
        } else if (after === before) {
          console.log('  ✓ ★ 画板归位：点到**第 2 条**去打包，板子还是他点之前那张（这一场最后一张）' +
            '——逐字节相同（等了 ' + waited + ' 秒收敛）');
        } else {
          console.log('  ✗ 画板没归位：连拍 ' + waited + ' 秒，最后一次仍差 ' + (d && d.n) + ' 个像素' +
            '　范围 x ' + (d && d.box ? d.box[0] + '–' + d.box[2] : '-') +
            '、y ' + (d && d.box ? d.box[1] + '–' + d.box[3] : '-') +
            '（图 ' + (d && d.w) + '×' + (d && d.h) + '）');
          console.log('      —— 老师点到中间某一条去打包，回来会发现板上的图被换成别的了');
          bBad++;
        }
      }
    }

    // ---- B 腿里那些"这个数不可能是真的"的兜底 ----
    if (!TURNS.some(t => t.ggb && t.ggb.length)) selfBad.push('B 腿的假回复表里一条画板命令都没有，"收不着图"和"本来就无图"分不开');
    // ★ 归位那一格能成立，靠的是"最后一条的最后一块"和"前两条的图"**不是同一张**。
    //   要是夹具被改成一样，那一格就变成"反正画什么都一样"，永远绿，什么也证不出来。
    if (figures.key(LASTBLK) === figures.key(TURNS[0].ggb[0]) || figures.key(LASTBLK) === figures.key(TURNS[1].ggb[0]))
      selfBad.push('★ B 腿的"画板归位"空转：这一场最后一张图跟前两张是同一张 —— ' +
        '画板变成什么样都算"归位成功"，那一格什么也证不出来');

    await closeTab(TAB);
    console.log('');
    console.log('===== B 腿结果 =====');
    console.log('  ' + (bBad ? '★ 有 ' + bBad + ' 处不对，见上面' : '这里没有不对的'));
    console.log('  ⚠ 还有两件这份探针**管不着**，只能你双击看：');
    console.log('    · 解压软件里中文文件名乱不乱码（位 11 我们置上了，Win10+ 应该没事，但没法替你验）');
    console.log('    · .md 双击用记事本打开是不是正常中文（BOM 在，理论上就是正常的）');
    if (selfBad.length) {
      console.log('');
      console.log('★★★ 尺子自己坏了 —— 上面那些绿一条都别信：');
      selfBad.forEach(x => console.log('    · ' + x));
    }
    process.exit((bad || bBad || selfBad.length) ? 1 : 0);
  } catch (e) {
    console.log('\n★ B 腿炸了：' + e.message);
    console.log('  （最常见的是 Chrome 没挂在 9222，或者 test/serve.cjs 不在 8138。）');
    if (TAB) await closeTab(TAB);
    process.exit(3);
  }
})();

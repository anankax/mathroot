// 本地素材索引生成器 —— 「后备资源」那一半能做的部分。
//
// ★ 先读清楚这份脚本**不干什么**：它不搬文件、不解文档内容、不上传任何东西。
//   它只把孔老师本机上那些课件/教案/例题册的**文件名、章节号、在哪个文件夹**扫成一张表。
//   起因是 2026-10-01 那句"把知识库里的学科网素材、教材、胡小群、葛教研员、上好课
//   都做成网站的读取资源"——见 24-知识库\05-后备资源（本地素材索引·不随站发布）.md：
//   那些素材的著作权不在孔老师手上，公开站（anankax.github.io/mathroot）不能放。
//   能放的是**指路牌**：哪一节、手上有哪些文件。文件名和章节号是事实，不是作品。
//
// 产出两个东西：
//   1. js/resource-index.js          —— 给网站读的（**被 .gitignore 挡住，不进仓库**）
//   2. 24-知识库\06-本地素材总索引.md —— 给他备课翻的（按册、按节排好）
//
// 用法:
//   node test/build_resource_index.cjs            # 两个都生成
//   node test/build_resource_index.cjs --dry      # 只印统计，不落盘
//   KB=别的路径 node test/build_resource_index.cjs
const fs = require('fs'), path = require('path');

const KB = process.env.KB || 'C:\\数学办公\\宜兴东氿中学';
const SIDE = [                                  // 不在 24-知识库 底下、但在同一台机器上的两摞
  { dir: 'C:\\数学办公\\胡小群', 源: '胡小群课程' },
  { dir: 'C:\\数学办公\\苏科版课本', 源: '苏科版课本（扫描件）' }
];
const OUT_JS = path.join(__dirname, '..', 'js', 'resource-index.js');
const OUT_MD = path.join(KB, '24-知识库', '06-本地素材总索引.md');

// 扫哪些文件夹（相对 KB）。14-新备课组资料 是备课组共用的，也算手上有的。
const ROOTS = [
  ['00-教材', '教材PDF'],
  ['01-课件', '自备课件'],
  ['02-学案', '学案'],
  ['09-葛·中考指导组教学设计', '葛教研员设计'],
  ['11-教案', '教案'],
  ['12-我自己的课件', '自制课件'],
  ['13-学科网素材', '学科网素材'],
  ['14-新备课组资料', '备课组资料'],
  ['17-教辅与参考书', '教辅参考书']
];

// 图片一律不入索引——苏科版课本那边有 1300 多张页图，条数会淹掉真正有用的那些。
// 页图按"某个文件夹里有多少张"记一笔就够。
const SKIP_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.mp4', '.avi']);

// 文件名里那些"哪家的、哪一版"的噪声。删掉它们，"这一节叫什么"才露出来。
const NOISE = [
  /（教学课件）/g, /\(教学课件\)/g, /（课件）/g, /（新教材苏科版）/g, /（新教材）/g,
  /数学苏科版2024[七八九]年级[上下]册/g, /数学新教材苏科版[七八九]年级[上下]册/g,
  /数学苏科版[七八九]年级[上下]册/g, /苏科版2024版/g, /苏科版/g,
  /[七八九]年级[上下]册/g, /第\s*\d+\s*课时/g, /预研学版/g,
  /[（(]\s*[一二三四五六七八九十]\s*[)）]/g,
  /【上好课】/g, /举一反三系列/g, /电子课本/g, /高清正式版/g, /新版/g, /新教材/g
];

// 册别。★ 别写成"七上|七年级上"这种连着的字串——实测大批文件名和文件夹名是
//   "…2026-2027学年苏科版九年级数学上册…"，年级和上/下册中间还夹着"数学"两个字，
//   连着写会一条都认不出来（第一版就是这么漏了 456 条）。
//   所以先抓"几年级"，再在同一串里找上/下册。
function bookOf(s) {
  let m = s.match(/([七八九])年级[^\\]{0,12}?([上下])\s*册/);
  if (m) return m[1] + m[2];
  m = s.match(/([七八九])年级[^\\]{0,12}?([上下])学期/);
  if (m) return m[1] + m[2];
  // 只写了年级、没写上下（胡小群那边按 L7/L8/L9 整学年分，本来就不分上下）
  m = s.match(/([七八九])年级/) || s.match(/(初一|初二|初三)/);
  if (m) {
    const g = { 初一: '七', 初二: '八', 初三: '九' }[m[1]] || m[1];
    return g + '年级';
  }
  // 简写"七上"——葛老师那边就是拿它当文件夹名的（09-…\七上\…）。
  // 放在最后判：前面几条更具体，先让它们命中。
  m = s.match(/([七八九])([上下])/);
  if (m) return m[0];
  return '';
}

function clean(name) {
  let s = name;
  // 开头的节号要去掉：節号另外单独存一栏，留着名字里会变成"2.3 2.3绝对值与相反数"这种叠字。
  s = s.replace(/^\s*\d+(\.\d+)*\s*/, '');
  for (const re of NOISE) s = s.replace(re, '');
  return s.replace(/[_+]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-—·、]+|[\s\-—·、]+$/g, '').trim();
}

// 关键词：从这一节叫什么里切出来，喂给检索用。
function wordsOf(sec, name) {
  const out = new Set();
  if (sec) out.add(sec);
  const parts = clean(name).split(/[（()）、，,·\-—/\s]+/);
  for (const p of parts) {
    const t = p.trim();
    if (t.length >= 2 && !/^[\d.]+$/.test(t)) out.add(t);
  }
  return Array.from(out);
}

function walk(dir, rel, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '\\' + e.name : e.name;
    if (e.isDirectory()) { walk(full, r, out); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (SKIP_EXT.has(ext)) { out.imgs++; continue; }
    if (['.docx', '.doc', '.pptx', '.ppt', '.pdf', '.md', '.txt'].indexOf(ext) < 0) continue;
    const base = e.name.slice(0, -ext.length);
    const m = base.match(/(\d+)\.(\d+)/);
    out.files.push({
      册: bookOf(r) || bookOf(base),
      节: m ? m[1] + '.' + m[2] : '',
      名: clean(base) || base,
      型: ext.slice(1),
      路径: r
    });
  }
}

const out = { files: [], imgs: 0 };
for (const [rel, 源] of ROOTS) {
  const before = out.files.length;
  const sub = { files: [], imgs: 0 };
  walk(path.join(KB, rel), rel, sub);
  for (const f of sub.files) { f.源 = 源; out.files.push(f); }
  out.imgs += sub.imgs;
  console.log(String(源).padEnd(14) + String(sub.files.length).padStart(5) + ' 个文件' +
    (sub.imgs ? '（另有 ' + sub.imgs + ' 张图片，没入索引）' : ''));
}
for (const s of SIDE) {
  const sub = { files: [], imgs: 0 };
  walk(s.dir, '', sub);
  for (const f of sub.files) { f.源 = s.源; f.路径 = s.dir + '\\' + f.路径; out.files.push(f); }
  out.imgs += sub.imgs;
  console.log(String(s.源).padEnd(14) + String(sub.files.length).padStart(5) + ' 个文件' +
    (sub.imgs ? '（另有 ' + sub.imgs + ' 张图片，没入索引）' : ''));
}

// 排序：先按册（七上→九下），再按节号，再按来源。
const ORDER = ['七上', '七下', '八上', '八下', '九上', '九下',
  '七年级', '八年级', '九年级', ''];
out.files.sort((a, b) => {
  const d = ORDER.indexOf(a.册) - ORDER.indexOf(b.册);
  if (d) return d;
  if (a.节 !== b.节) return (a.节 || 'zzz') < (b.节 || 'zzz') ? -1 : 1;
  return a.路径 < b.路径 ? -1 : 1;
});
for (const f of out.files) f.词 = wordsOf(f.节, f.名);

console.log('\n共 ' + out.files.length + ' 条（另有 ' + out.imgs + ' 张图片只计数）');
const byBook = {};
for (const f of out.files) byBook[f.册 || '?'] = (byBook[f.册 || '?'] || 0) + 1;
for (const k of ORDER) if (byBook[k]) console.log('  ' + (k || '?') + '：' + byBook[k]);
// 认不出册别的那些，按来源分组印出来——多半是文件名里真没写年级（比如按课时命名的），
// 不是脚本漏看。要往回收就先看这儿，别直接改正则瞎猜。
const noBook = out.files.filter(f => !f.册);
if (noBook.length) {
  const bySrc = {};
  for (const f of noBook) bySrc[f.源] = (bySrc[f.源] || 0) + 1;
  console.log('  认不出册别 ' + noBook.length + ' 条，来自：' +
    Object.keys(bySrc).map(k => k + ' ' + bySrc[k]).join('、'));
  console.log('  头几条长这样：');
  noBook.slice(0, 5).forEach(f => console.log('    ' + f.路径));
}

if (process.argv.indexOf('--dry') >= 0) { console.log('\n--dry：没落盘。'); process.exit(0); }

// ---- 1. 给网站读的 ----
// ★ 这个文件被 .gitignore 挡着，只在他本机存在。公开站上没有它，
//   js/resources.js 加载失败就静静算了，界面上不会多出一个点了没反应的按钮。
const js = [
  '// 本文件由 test/build_resource_index.cjs 生成，不要手改，也不要提交。',
  '// 里面只有文件名、章节号和本机路径，没有素材内容——那些内容的著作权不在孔老师手上，',
  '// 不能随公开站发出去。详见 24-知识库\\05-后备资源（本地素材索引·不随站发布）.md',
  'var SR = (window.SR = window.SR || {});',
  'SR.RESOURCES = ' + JSON.stringify({
    生成时间: new Date().toISOString().slice(0, 16).replace('T', ' '),
    基准目录: KB,
    条数: out.files.length,
    素材: out.files
  }, null, 0) + ';',
  ''
].join('\n');
fs.writeFileSync(OUT_JS, js, 'utf8');
console.log('\n写好 ' + OUT_JS + '（' + (Buffer.byteLength(js) / 1024).toFixed(0) + ' KB，不进仓库）');

// ---- 2. 给他备课翻的 ----
const L = [];
L.push('# 本地素材总索引（本机专用 · 不进仓库、不上站）');
L.push('');
L.push('> 由 `数根\\test\\build_resource_index.cjs` 扫出来，' + new Date().toISOString().slice(0, 10) + ' 生成。');
L.push('> **这里只有文件名和位置，没有内容**——素材本身的著作权不在我们手上，只能当"指路牌"用。');
L.push('> 要重新生成：`cd C:\\数学办公\\数根 && node test\\build_resource_index.cjs`');
L.push('');
L.push('共 **' + out.files.length + '** 个文件（另有 ' + out.imgs + ' 张图片只计数，没列）。');
L.push('');
let curBook = null, curSec = null;
for (const f of out.files) {
  const b = f.册 || '（文件名里没写册别）';
  if (b !== curBook) {
    curBook = b; curSec = null;
    L.push('', '## ' + b, '');
    L.push('| 节 | 名称 | 类型 | 来源 | 位置 |');
    L.push('|---|---|---|---|---|');
  }
  const s = f.节 || '—';
  L.push('| ' + s + ' | ' + f.名 + ' | ' + f.型 + ' | ' + f.源 + ' | `' + f.路径 + '` |');
}
L.push('');
fs.writeFileSync(OUT_MD, L.join('\n'), 'utf8');
console.log('写好 ' + OUT_MD);

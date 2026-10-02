// 把本机素材传进 CloudBase PG 存储的 materials 桶（私有）。
//
// ★★ 这个脚本的规矩：钥匙从 .env.local 里读，
//   **脚本不打印钥匙、不打印它的长度、出错也不把它拼进消息**。
//   传完之后那把钥匙就该被删掉——它只干这一趟活。
//   （钥匙怎么进去的：双击 test\_放进钥匙.cmd，自己粘、自己落盘。）
//
// 依据是官方文档 postgresql-development-cloudbase/references/storage-pg.md：
//   上传口  POST/PUT https://{envId}.api.tcloudbasegateway.com/v1/storages/object/{bucket}/{name}
//   认证    Authorization: Bearer <service_role token>
//   对象键  不要重复桶名（桶走 from()，键就是桶里面的路径）
//   service_role 旁路 RLS，所以传的时候不用先配策略；**读的时候才要**。
//
// ★★ 键必须转写：桶只认一小撮字符（实测见下），中文文件名里的全角标点
//   一个都过不去。所以磁盘上的真名走 `rel`，桶里的键走 `safeKey(rel)`。
//   进清单、进登记表的**两个都存**，界面上显示的一直是 rel（真名）。
//
// ★ 只走下面 ROOTS 里点名的目录。**绝不整盘扫**——同一个根底下有
//   `宜兴东氿中学\25-各种密钥`，整盘扫会把它一起传上去。
//
// 用法：
//   node test/upload_materials.cjs                    → 只传 1 个文件试形状，打印完整回包
//   node test/upload_materials.cjs --all              → 全部
//   node test/upload_materials.cjs --all --roots 学科网,周练
//   node test/upload_materials.cjs --list             → 只数不传（不用钥匙）
//
// 传完写一份 test/_upload_manifest.json（同名的键覆盖，不抹掉上一批）。

const fs = require('fs');
const path = require('path');
const https = require('https');

const ENV_ID = 'kax1014-d1g5uttgka7757f39';
const BUCKET = 'materials';
const API_BASE = 'https://' + ENV_ID + '.api.tcloudbasegateway.com';
const BASE_DIR = 'C:\\数学办公';
const KEY_FILE = path.join(__dirname, '..', '.env.local');
const MANIFEST = path.join(__dirname, '_upload_manifest.json');

// 桶的 per-file 上限，跟 storage.buckets.file_size_limit 对齐（2026-10-02 抬到 200MB，
// 好让学科网那 44 个大课件上去；改完已读回核对过）。
const MAXFILE = 209715200;   // 200MB

// 一块一块点名的来源。
//   rel   相对 BASE_DIR
//   only  真名里必须含这个词（不满足的算"本来就不要"，不算跳过）
//   skip  ★ 真名的**完整前缀**（也是相对 BASE_DIR），必须从 BASE_DIR 那层写起。
//         写短了它一辈子匹配不上——这里踩过一次。
const ROOTS = [
  { name: '葛',       rel: '宜兴东氿中学\\09-葛·中考指导组教学设计' },
  { name: '学案',     rel: '宜兴东氿中学\\02-学案' },
  {
    name: '新备课组', rel: '宜兴东氿中学\\14-新备课组资料',
    // _讲义工作区 是「周练卷→复习讲义」管线的**草稿区**：527 张中间 PNG、
    // 加上 .py/.json/.txt，682 个文件 258MB，全是过程产物，不是素材。
    skip: '宜兴东氿中学\\14-新备课组资料\\_讲义工作区\\'
  },
  { name: '孔安欣',   rel: '宜兴东氿中学\\10-孔安欣编辑内容' },
  { name: '学科网',   rel: '宜兴东氿中学\\13-学科网素材' },
  { name: '周练',     rel: '宜兴东氿中学\\03-试卷周练' },
  { name: '胡小群',   rel: '胡小群' },
  { name: '胡小群md', rel: '胡小群_md' },
  {
    name: '中考数学', rel: '中考试卷\\江苏省中考',
    only: '数学',
    // 这两套目录互为副本（1908 个同名文件），留「江苏省中考历年真题」那一套，
    // 不然数学卷会白传两遍。skip 要写全：从 BASE_DIR 起。
    skip: '中考试卷\\江苏省中考\\01江苏省13市中考历年真题2008-2025 新\\'
  }
];

// ---------- 类型 ----------
// 认得的给准确的 Content-Type；认不得的兜底 octet-stream——**不挑类型，全都传**。
const MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.wmf': 'image/wmf', '.emf': 'image/emf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.py': 'text/x-python; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
  '.rar': 'application/vnd.rar',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed'
};

// 不上云的几样，各自说明理由——**要记一笔，不能静默丢**。
// 判据：体验版存储是按月持续扣资源点的（存储 GB × 1200 点/月），
//       额度只有 3000 点/月，所以"体积大但不读"的东西不上。
const SKIP_EXT = {
  '.crdownload': '垃圾：浏览器没下完的残片',
  '.part': '垃圾：没下完的残片',
  '.tmp': '垃圾：临时文件',
  // ★ 学科网大课件：全量里 52 个占 2.92GB（总体积的 76%），却只占文件数的 3.5%，
  //   而且模型要读的是教案讲义，不是这些课件。全部留在本机。
  '.pptx': '大课件：本机留档，不上云',
  '.ppt': '大课件：本机留档，不上云'
};

// ---------- 键的净化 ----------
// ★★ 桶只认一小撮字符，实测（test/_probe_chars.cjs，19 个符号一个个试）：
//     认：英文数字、- _ . 空格 +、汉字（U+4E00–U+9FFF）
//     不认：几乎**所有**别的符号——全角括号（）【】、顿号、全角逗号/冒号、
//           破折号、间隔号·、方括号花括号、波浪号……中文文件名里那些标点
//           一个都过不去，报 STORAGE_INVALID_KEY。
// 所以这里用**白名单**：不在名单里的一律转成 _<小写码位>_（只用桶认得的字符，
// 可逆）。原始路径照样存在 rel 里，进清单、进登记表，界面上一直显示原名。
const SAFE_CH = /[A-Za-z0-9\-_. +]/;
function safeKey(rel) {
  let out = '';
  for (const ch of rel) {                 // for...of 按码位走，代理对不会被拆坏
    if (ch === '/' || SAFE_CH.test(ch)) { out += ch; continue; }
    const n = ch.codePointAt(0);
    if (n >= 0x4e00 && n <= 0x9fff) { out += ch; continue; }   // 汉字原样留
    out += '_' + n.toString(16).padStart(4, '0') + '_';
  }
  return out;
}

// ---------- 读钥匙：只判"在不在、像不像"，不碰值 ----------
function readKey() {
  if (!fs.existsSync(KEY_FILE)) return { err: '没找到 ' + KEY_FILE };
  let txt;
  try { txt = fs.readFileSync(KEY_FILE, 'utf8'); }
  catch (e) { return { err: '读不了 .env.local：' + (e && e.message) }; }
  const m = txt.match(/^\s*CLOUDBASE_APIKEY\s*=\s*(.+?)\s*$/m);
  if (!m) return { err: '.env.local 里没有 CLOUDBASE_APIKEY= 这一行' };
  let v = m[1].trim();
  if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) {
    v = v.slice(1, -1).trim();
  }
  if (!v) return { err: 'CLOUDBASE_APIKEY 是空的' };
  if (/[^\x21-\x7e]/.test(v)) return { err: '.env.local 里那行还是占位符——请把中文整段删掉，换成钥匙' };
  return { key: v };
}

// ---------- 发一次上传（PUT = 覆盖，重跑不会炸）----------
function put(key, buf, mime, token) {
  return new Promise(function (resolve) {
    const enc = key.split('/').map(encodeURIComponent).join('/');
    const u = new URL(API_BASE + '/v1/storages/object/' + BUCKET + '/' + enc);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'PUT',
      timeout: 300000,
      headers: {
        'Authorization': 'Bearer ' + token,   // ★ 只在请求头里，不进任何日志
        'Content-Type': mime,
        'Content-Length': buf.length
      }
    }, function (res) {
      // ★ 攒 Buffer 再一次性解码。写成 `body += c` 会在每个 TCP 分块上各按 UTF-8 解一次，
      //   一个汉字被劈成两半就各自变成 U+FFFD——原来只在错误提示里露脸，
      //   但同一处写法在 _list_all.cjs 里造出过"世上不存在的乱码键名"。
      const chunks = [];
      let total = 0;
      res.on('data', function (c) { chunks.push(c); total += c.length; if (total > 8000) req.destroy(); });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 600) });
      });
    });
    req.on('timeout', function () { req.destroy(); resolve({ err: '超时' }); });
    req.on('error', function (e) { resolve({ err: (e && e.message) || String(e) }); });
    req.end(buf);
  });
}

// ---------- 走目录；垃圾 / 被过滤掉的 / 太大传不动的各记一笔，别让它悄悄消失 ----------
function walk(dir, r, out, skip, big) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, r, out, skip, big); continue; }
    if (!e.isFile()) continue;
    if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
    // rel = 本机上的真实相对路径（跟磁盘一模一样）。skip/only 判的是它。
    const rel = path.relative(BASE_DIR, full).split(path.sep).join('/');
    if (r.skip && rel.indexOf(r.skip.replace(/\\/g, '/')) === 0) {
      skip['（草稿/副本目录，已略）'] = (skip['（草稿/副本目录，已略）'] || 0) + 1; continue;
    }
    if (r.only && rel.indexOf(r.only) < 0) continue;   // 过滤掉的不算"跳过"，是本来就不要
    const ext = path.extname(e.name).toLowerCase();
    const why = SKIP_EXT[ext];
    if (why) { skip['（' + why + '）'] = (skip['（' + why + '）'] || 0) + 1; continue; }
    let st; try { st = fs.statSync(full); } catch (err) { continue; }
    if (st.size > MAXFILE) {
      skip['（超过 200MB，桶会挡下）'] = (skip['（超过 200MB，桶会挡下）'] || 0) + 1;
      big.push({ rel: rel, size: st.size });
      continue;
    }
    out.push({
      key: safeKey(rel), rel: rel, local: full, size: st.size,
      mime: MIME[ext] || 'application/octet-stream', ext: ext || '(无后缀)'
    });
  }
}

function human(n) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + 'GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
  return Math.max(1, Math.round(n / 1024)) + 'KB';
}

(async function main() {
  const argv = process.argv.slice(2);
  const all = argv.indexOf('--all') >= 0;
  const listOnly = argv.indexOf('--list') >= 0;
  let want = null;
  const ri = argv.indexOf('--roots');
  if (ri >= 0 && argv[ri + 1]) want = argv[ri + 1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);

  const use = want ? ROOTS.filter(function (r) { return want.indexOf(r.name) >= 0; }) : ROOTS;
  if (!use.length) {
    console.log('  ✗ --roots 没匹配上。可选：' + ROOTS.map(function (r) { return r.name; }).join('、'));
    return;
  }

  console.log('');
  const files = [], skip = {}, big = [];
  for (const r of use) {
    const d = path.join(BASE_DIR, r.rel);
    if (!fs.existsSync(d)) { console.log('  ⚠ 本机没有（跳过）：' + r.rel); continue; }
    const before = files.length;
    walk(d, r, files, skip, big);
    const sub = files.slice(before);
    const sz = sub.reduce(function (s, f) { return s + f.size; }, 0);
    console.log('  ' + r.name + '：' + sub.length + ' 个，' + human(sz) + '   （' + r.rel + '）');
  }
  const total = files.reduce(function (s, f) { return s + f.size; }, 0);
  console.log('  ────────────────────────────────────────────');
  console.log('  这趟要传的：' + files.length + ' 个文件，' + human(total));

  // 净化后的键会不会撞车？（理论上只有"文件名里本来就带 _xxxx_"才可能）
  const seenK = {}, dup = [];
  files.forEach(function (f) { if (seenK[f.key]) dup.push(f.key); else seenK[f.key] = f.rel; });
  if (dup.length) {
    console.log('\n  ✗ 净化后有两个文件撞到同一个键，先别传：');
    dup.slice(0, 5).forEach(function (k) { console.log('      ' + k + '\n        ← ' + seenK[k]); });
    return;
  }

  const changed = files.filter(function (f) { return f.key !== f.rel; });
  if (changed.length) {
    console.log('  ── 键转写：' + changed.length + ' 个名字里带桶不认的符号 ──');
    changed.slice(0, 2).forEach(function (f) {
      console.log('      真名  ' + f.rel);
      console.log('      键    ' + f.key);
      console.log('');
    });
  }

  const sk = Object.keys(skip).sort();
  if (sk.length) console.log('  ⚠ 没传的：' + sk.map(function (k) { return k + '×' + skip[k]; }).join('、'));
  if (big.length) {
    const bs = big.reduce(function (s, b) { return s + b.size; }, 0);
    console.log('  ⚠ 超过 200MB、这趟先没传的 ' + big.length + ' 个（共 ' + human(bs) + '）：');
    big.slice().sort(function (a, b) { return b.size - a.size; }).slice(0, 8).forEach(function (b) {
      console.log('      ' + human(b.size).padStart(8) + '  ' + b.rel);
    });
  }
  if (!files.length) { console.log('  没有可传的文件，停。'); return; }
  if (listOnly) { console.log('  （--list：只数不传，没碰网络）\n'); return; }

  const k = readKey();
  if (k.err) {
    console.log('');
    console.log('  ✗ ' + k.err);
    console.log('');
    console.log('  别用记事本改——双击这个文件把钥匙粘进去：');
    console.log('    ' + path.join(__dirname, '_放进钥匙.cmd'));
    console.log('');
    return;
  }

  const todo = all ? files : files.slice(0, 1);
  if (!all) console.log('\n  【试形状】只传 1 个，看回包；确认对了再加 --all\n');

  const done = [];
  let ok = 0, bad = 0;
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    let buf; try { buf = fs.readFileSync(f.local); }
    catch (e) { console.log('  ✗ 读不了 ' + f.rel); bad++; continue; }
    const r = await put(f.key, buf, f.mime, k.key);
    if (r.status >= 200 && r.status < 300) {
      ok++;
      done.push({ bucket: BUCKET, key: f.key, rel: f.rel, local: f.local, size: f.size, mime: f.mime, ext: f.ext });
      if (!all || (i + 1) % 25 === 0 || i === todo.length - 1) {
        const pc = all ? '[' + (i + 1) + '/' + todo.length + '] ' : '';
        console.log('  ' + pc + '✓ ' + f.rel.slice(-60) + '   ' + human(f.size));
      }
    } else {
      bad++;
      console.log('  [' + (i + 1) + '/' + todo.length + '] ✗ HTTP ' + (r.status || '—') + '  ' + (r.err || r.body));
      if (i === 0 && !all) { console.log('\n  ↑ 第一个就失败，先别往下走，把上面这条回包发我。'); return; }
    }
  }

  const sec = (Date.now() - t0) / 1000;
  console.log('\n  传完：成功 ' + ok + '，失败 ' + bad + '，用时 ' + (sec > 60 ? (sec / 60).toFixed(1) + ' 分' : Math.round(sec) + ' 秒'));
  if (done.length) {
    let old = [];
    try { old = (JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).files) || []; } catch (e) {}
    const map = {};
    old.concat(done).forEach(function (f) { map[f.key] = f; });
    const merged = Object.keys(map).map(function (kk) { return map[kk]; });
    fs.writeFileSync(MANIFEST, JSON.stringify({ when: new Date().toISOString(), bucket: BUCKET, count: merged.length, files: merged }, null, 1), 'utf8');
    console.log('  清单写到：' + MANIFEST + '（累计 ' + merged.length + ' 条）');
  }
})();

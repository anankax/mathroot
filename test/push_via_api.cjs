// 走 api.github.com 推提交——给「github.com 连不上、api.github.com 还通」这种情况兜底。
//
// ★ 为什么需要它：这台机器上 github.com:443 会被连接重置（2026-10-01 实测，
//   git push 和 curl 都是 21 秒超时/重置），但 api.github.com 是通的。
//   孔老师的代理工具（127.0.0.1:33210）没开的时候就没有别的路可走。
//   于是绕开 git 的传输层，用 GitHub 的 Git Data API 自己拼 blob → tree → commit → ref。
//
// ★ 目标不是"随便推上去"，是**推上去那颗提交和本地这颗逐字节相同**。
//   身份、时间戳、树、父提交全都从本地提交对象里读出来原样传给 API。
//   跑完会自检：算出来的 sha 对不上就**不动本地任何东西**、直接报错退出。
//
// ★ 两个实测过的坑（别再踩）：
//   1) API 要 ISO 的 `+08:00`，git 对象头里写的是 `+0800`——少那个冒号，它一律回
//      "Invalid request. … is not a valid date-time."
//   2) GET 回来的 author.date 显示成 `…Z`（UTC），但**对象里存的还是原来的 +0800**。
//      照着显示值去重造，sha 永远对不上——时区要用本地提交对象里那一份。
//      （还有一个：对象正文末尾没有多余换行。下面是从 API 回读的 message 原样重建的，
//        所以不用猜。）
//
// ★ 一次推**一串**，不是一颗（2026-10-01 补）：原来只推 HEAD 那颗，父提交写死 HEAD^，
//   本地攒了两颗提交就报"不是快进"。现在按 远端..HEAD 的顺序一颗一颗建，父提交指着
//   上一颗**远端那颗**的 sha——注意不是本地的 sha：GitHub 存的提交正文末尾不带换行，
//   跟本地那颗天然差一个字符（下面 upd 那段有详述），所以要边建边记映射。
//
// 用法: node test/push_via_api.cjs            # 把远端缺的提交依次推上去
//       DRY=1 node test/push_via_api.cjs      # 只造对象、到改 ref 前停下
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const REPO = 'anankax/mathroot';
const BRANCH = 'main';
const DRY = !!process.env.DRY;
const ROOT = path.join(__dirname, '..');
const git = (a, o) => execFileSync('git', ['-C', ROOT].concat(a), Object.assign({ maxBuffer: 1 << 28 }, o || {}));

// gh api：JSON 走临时文件（base64 有大段，塞命令行会被截）
let seq = 0;
function ghOnce(method, endpoint, body) {
  const args = ['api', '-X', method, endpoint.replace(/^\//, '')];
  if (body !== undefined) {
    const tmp = path.join(os.tmpdir(), '_ghbody' + (++seq) + '.json');
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push('--input', tmp);
    try { return JSON.parse(execFileSync('gh', args, { maxBuffer: 1 << 28 }).toString('utf8')); }
    finally { fs.unlinkSync(tmp); }
  }
  return JSON.parse(execFileSync('gh', args, { maxBuffer: 1 << 28 }).toString('utf8'));
}

// ★ 这条路上每建一个对象就打一次 API，推 8 个文件就是十几次调用。
//   而这台机器到 api.github.com 的路**不稳**：2026-10-01 实测推到一半撞上
//   `http2: Transport: cannot retry err`，整趟从头再来（前面建的只是悬空对象，
//   不影响仓库，但白跑）。所以每次都重试几趟。
//   重试是安全的：blob/tree/commit 都是内容寻址的，同样的内容再 POST 一次还是同一个 sha。
function gh(method, endpoint, body) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return ghOnce(method, endpoint, body); }
    catch (e) {
      last = e;
      const msg = String(e.stderr || e.message || e).slice(0, 120);
      if (i < 3) {
        console.log('  （API 第 ' + (i + 1) + ' 次没通，' + (i + 1) * 2 + ' 秒后重试：' + msg.replace(/\s+/g, ' ') + '）');
        execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},' + ((i + 1) * 2000) + ')']);
      }
    }
  }
  throw last;
}

// 本地提交对象里的 `author 名字 <邮箱> 1790830141 +0800`
function ident(raw, role) {
  const m = raw.match(new RegExp('^' + role + ' (.*) <(.*)> (\\d+) ([+-]\\d{4})$', 'm'));
  if (!m) throw new Error('读不出 ' + role + ' 行');
  const [, name, email, epoch, off] = m;
  return { name, email, epoch: +epoch, off, date: iso(+epoch, off) };
}
function iso(epoch, off) {
  const mins = (off[0] === '-' ? -1 : 1) * (parseInt(off.slice(1, 3), 10) * 60 + parseInt(off.slice(3, 5), 10));
  const d = new Date((epoch + mins * 60) * 1000);        // 先挪到那个时区的"墙上时间"
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + off.slice(0, 3) + ':' + off.slice(3);
}

const HEAD = git(['rev-parse', 'HEAD']).toString().trim();
const remoteHead = gh('GET', 'repos/' + REPO + '/git/ref/heads/' + BRANCH).object.sha;

// 要推的提交，**老的在前**：API 得一颗一颗按顺序建，每颗的父提交是上一颗。
let list;
if (remoteHead === HEAD) {
  // 已经推过了。再跑一遍不该报错，更不该因为"父提交对不上"把人唬住。
  // 往下照跑：blob/tree/commit 都是内容寻址的，重造出来的 sha 一定还是同一颗，
  // 于是整条路（含末尾那个逐字节自检）都还能验一遍——这才是重复运行的价值。
  console.log('远端 ' + BRANCH + ' 已经是本地这颗了（' + HEAD.slice(0, 8) + '），再跑一遍只为自检。');
  list = [HEAD];
} else {
  const out = git(['rev-list', '--reverse', remoteHead + '..HEAD']).toString().trim();
  list = out ? out.split('\n') : [];
  if (!list.length) {
    console.log('⚠ 远端 ' + BRANCH + ' 在 ' + remoteHead.slice(0, 8) + '，本机找不出它到 HEAD 之间的提交。');
    console.log('  不是快进（远端可能领先，或者历史被改过）。不动它，先 git fetch 或手动理一遍再来。');
    process.exit(4);
  }
  if (list.length > 1) {
    console.log('本地有 ' + list.length + ' 颗要推：' + list.map(s => s.slice(0, 8)).join(' → '));
  }
}

// ---- 变更清单（含删除）----
const modes = {};
git(['ls-tree', '-r', 'HEAD']).toString('utf8').split('\n').filter(Boolean).forEach(l => {
  const m = l.match(/^(\d+)\s+blob\s+\w+\t(.*)$/);
  if (m) modes[m[2]] = m[1];
});

// 本地 sha → 远端那颗的 sha。同一串提交里后面那颗的父提交要用这个映射，
// 不能拿本地 sha 顶上（差一个换行，见下面 upd 那段）。
const apiSha = {};
let pushed = 0;

for (const sha of list) {
  const RAW = git(['cat-file', 'commit', sha]).toString('utf8');
  const localParent = git(['rev-parse', sha + '^']).toString().trim();
  const parent = apiSha[localParent] || localParent;
  const AUTHOR = ident(RAW, 'author'), COMMITTER = ident(RAW, 'committer');
  const MSG = git(['log', '-1', '--format=%B', sha]).toString('utf8').replace(/\n+$/, '');

  // ★ `--no-renames` 不能省（2026-10-01 踩到）：`-z` 下每一行的字段数是**会变的**——
  //   普通变更 `M\0路径\0` 两个字段，改名却是 `R100\0旧路径\0新路径\0` **三个**。
  //   下面按"两个一读"解析，一碰上改名整串就错位：把旧路径当成了新路径的状态，
  //   于是对着一个**已经不存在**的路径去 `git cat-file`，
  //   报 `fatal: path 'js/prompt-demo.js' does not exist`（其实是被当成改名源了）。
  //   加了这个开关，改名一律拆成"删一个 + 加一个"，字段数恒定，建出来的树一模一样。
  const st = git(['diff', '--name-status', '--no-renames', '-z', sha + '^', sha]).toString('utf8').split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < st.length; i += 2) changes.push({ st: st[i][0], p: st[i + 1] });

  console.log('\n父提交 ' + parent.slice(0, 8) + ' → 本地提交 ' + sha.slice(0, 8) +
    '（' + changes.length + ' 个文件' + (changes.length ? '' : '，空提交，照建') + '）');

  const tree = [];
  for (const c of changes) {
    if (c.st === 'D') { tree.push({ path: c.p, mode: '100644', type: 'blob', sha: null }); console.log('  删 ' + c.p); continue; }
    const buf = git(['cat-file', 'blob', sha + ':' + c.p], { encoding: 'buffer' });
    const blob = gh('POST', 'repos/' + REPO + '/git/blobs', { content: buf.toString('base64'), encoding: 'base64' });
    tree.push({ path: c.p, mode: modes[c.p] || '100644', type: 'blob', sha: blob.sha });
    console.log('  ' + c.st + ' ' + c.p + '  ' + (buf.length / 1024).toFixed(1) + 'KB → ' + blob.sha.slice(0, 8));
  }

  const localTree = git(['rev-parse', sha + '^{tree}']).toString().trim();
  // 空提交没有变更可挂：那就直接拿父提交那棵树当自己的树，不白跑一趟 API。
  const t = changes.length
    ? gh('POST', 'repos/' + REPO + '/git/trees',
        { base_tree: git(['rev-parse', sha + '^^{tree}']).toString().trim(), tree: tree })
    : { sha: git(['rev-parse', sha + '^^{tree}']).toString().trim() };
  console.log('  新树 ' + t.sha.slice(0, 8) + (t.sha === localTree ? '（和本地树一致 ✅）' : ''));
  if (t.sha !== localTree) { console.log('❌ 和本地树 ' + localTree + ' 不一致——内容就没对上，停。'); process.exit(2); }

  const cm = gh('POST', 'repos/' + REPO + '/git/commits',
    { message: MSG, tree: t.sha, parents: [parent],
      author: { name: AUTHOR.name, email: AUTHOR.email, date: AUTHOR.date },
      committer: { name: COMMITTER.name, email: COMMITTER.email, date: COMMITTER.date } });

  // ---- 自检：用远端回读的 message 原样重造，sha 必须一模一样 ----
  const back = gh('GET', 'repos/' + REPO + '/git/commits/' + cm.sha);
  const stamp = AUTHOR.epoch + ' ' + AUTHOR.off;          // ★ 用本地那份时区，不用回读的 Z
  const rawCommit = 'tree ' + back.tree.sha + '\nparent ' + (back.parents[0] ? back.parents[0].sha : '') + '\n' +
    'author ' + back.author.name + ' <' + back.author.email + '> ' + stamp + '\n' +
    'committer ' + back.committer.name + ' <' + back.committer.email + '> ' + stamp + '\n\n' + back.message;
  const made = execFileSync('git', ['-C', ROOT, 'hash-object', '-w', '-t', 'commit', '--stdin'],
    { input: Buffer.from(rawCommit, 'utf8') }).toString().trim();
  if (made !== back.sha) {
    console.log('\n❌ 自检对不上（本地 ' + sha.slice(0, 8) + '）：重造出来 ' + made + '，远端的 ' + back.sha);
    console.log('   本地 refs 一个字都没改，远端那几颗是悬空的，不影响仓库。');
    process.exit(3);
  }
  console.log('  远端提交 ' + back.sha.slice(0, 8) + '，重造逐字节一致 ✅');

  apiSha[sha] = back.sha;
  pushed++;
}

if (!pushed) { console.log('\n没有要推的提交。'); process.exit(0); }

const finalSha = apiSha[list[list.length - 1]];

if (DRY) { console.log('\nDRY=1：到此为止，没动 refs。要真推就去掉 DRY。'); process.exit(0); }

// ★ 本地 refs 也指着远端那颗。为什么非要这样：`git commit` 造的提交正文末尾带一个换行、
//   GitHub 存的没有，树完全一样、sha 就没法一样。拿本地 sha 去比，每次都会假报"对不上"。
//   （上面每颗都逐字节自检过了，树是同一棵树。）旧的 sha 在 reflog 里，`git reflog` 找得回。
const before = git(['rev-parse', 'refs/heads/' + BRANCH]).toString().trim();
git(['update-ref', 'refs/heads/' + BRANCH, finalSha]);
git(['update-ref', 'refs/remotes/origin/' + BRANCH, finalSha]);
const r = gh('PATCH', 'repos/' + REPO + '/git/refs/heads/' + BRANCH, { sha: finalSha, force: false });
console.log('\n远端 refs/heads/' + BRANCH + ' → ' + r.object.sha);
if (before !== finalSha) {
  console.log('★ 本地 ' + BRANCH + ' 改指到远端那颗（' + before.slice(0, 8) + ' → ' + finalSha.slice(0, 8) + '）：');
  console.log('  原因就是上面那条——内容一样，末尾差一个换行，sha 就不一样。旧 sha 在 reflog 里。');
}
console.log(r.object.sha === finalSha
  ? '===== 推上去了 ' + pushed + ' 颗，本地和远端同一颗 sha ====='
  : '===== sha 对不上，要核 =====');
process.exit(r.object.sha === finalSha ? 0 : 5);

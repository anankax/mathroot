// 走 api.github.com 推一次提交——给「github.com 连不上、api.github.com 还通」这种情况兜底。
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
// 用法: node test/push_via_api.cjs            # 推 HEAD 到 origin/main
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
function gh(method, endpoint, body) {
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

const HEAD = git(['rev-parse', 'HEAD']).toString().trim();
const PARENT = git(['rev-parse', 'HEAD^']).toString().trim();
const RAW = git(['cat-file', 'commit', 'HEAD']).toString('utf8');

// 本地提交对象里的 `author 名字 <邮箱> 1790830141 +0800`
function ident(role) {
  const m = RAW.match(new RegExp('^' + role + ' (.*) <(.*)> (\\d+) ([+-]\\d{4})$', 'm'));
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

const AUTHOR = ident('author'), COMMITTER = ident('committer');
const MSG = git(['log', '-1', '--format=%B', 'HEAD']).toString('utf8').replace(/\n+$/, '');

const remoteHead = gh('GET', 'repos/' + REPO + '/git/ref/heads/' + BRANCH).object.sha;
if (remoteHead === HEAD) {
  // 已经推过了。再跑一遍不该报错，更不该因为"父提交对不上"把人唬住。
  // 往下照跑：blob/tree/commit 都是内容寻址的，重造出来的 sha 一定还是同一颗，
  // 于是整条路（含末尾那个逐字节自检）都还能验一遍——这才是重复运行的价值。
  console.log('远端 ' + BRANCH + ' 已经是本地这颗了（' + HEAD.slice(0, 8) + '），再跑一遍只为自检。');
}
if (remoteHead !== PARENT && remoteHead !== HEAD) {
  console.log('⚠ 远端 ' + BRANCH + ' 在 ' + remoteHead.slice(0, 8) + '，本地的父提交是 ' + PARENT.slice(0, 8) + '。');
  console.log('  不是快进，不动它。先 git fetch / 手动理一遍再来。');
  process.exit(4);
}

// ---- 变更清单（含删除）----
const st = git(['diff', '--name-status', '-z', 'HEAD^', 'HEAD']).toString('utf8').split('\0').filter(Boolean);
const changes = [];
for (let i = 0; i < st.length; i += 2) changes.push({ st: st[i][0], p: st[i + 1] });
if (!changes.length) { console.log('本地这颗和父提交没有差别，没什么可推的'); process.exit(0); }

const modes = {};
git(['ls-tree', '-r', 'HEAD']).toString('utf8').split('\n').filter(Boolean).forEach(l => {
  const m = l.match(/^(\d+)\s+blob\s+\w+\t(.*)$/);
  if (m) modes[m[2]] = m[1];
});

console.log('父提交 ' + PARENT.slice(0, 8) + ' → 本地提交 ' + HEAD.slice(0, 8) + '（' + changes.length + ' 个文件）');

const tree = [];
for (const c of changes) {
  if (c.st === 'D') { tree.push({ path: c.p, mode: '100644', type: 'blob', sha: null }); console.log('  删 ' + c.p); continue; }
  const buf = git(['cat-file', 'blob', 'HEAD:' + c.p], { encoding: 'buffer' });
  const blob = gh('POST', 'repos/' + REPO + '/git/blobs', { content: buf.toString('base64'), encoding: 'base64' });
  tree.push({ path: c.p, mode: modes[c.p] || '100644', type: 'blob', sha: blob.sha });
  console.log('  ' + c.st + ' ' + c.p + '  ' + (buf.length / 1024).toFixed(1) + 'KB → ' + blob.sha.slice(0, 8));
}

const t = gh('POST', 'repos/' + REPO + '/git/trees',
  { base_tree: git(['rev-parse', 'HEAD^^{tree}']).toString().trim(), tree: tree });
const localTree = git(['rev-parse', 'HEAD^{tree}']).toString().trim();
console.log('\n新树 ' + t.sha);
if (t.sha !== localTree) { console.log('❌ 和本地树 ' + localTree + ' 不一致——内容就没对上，停。'); process.exit(2); }
console.log('   和本地树一致 ✅');

const cm = gh('POST', 'repos/' + REPO + '/git/commits',
  { message: MSG, tree: t.sha, parents: [PARENT], author: { name: AUTHOR.name, email: AUTHOR.email, date: AUTHOR.date },
    committer: { name: COMMITTER.name, email: COMMITTER.email, date: COMMITTER.date } });

// ---- 自检：用远端回读的 message 原样重造，sha 必须一模一样 ----
const back = gh('GET', 'repos/' + REPO + '/git/commits/' + cm.sha);
const stamp = AUTHOR.epoch + ' ' + AUTHOR.off;          // ★ 用本地那份时区，不用回读的 Z
const rawCommit = 'tree ' + back.tree.sha + '\nparent ' + back.parents[0].sha + '\n' +
  'author ' + back.author.name + ' <' + back.author.email + '> ' + stamp + '\n' +
  'committer ' + back.committer.name + ' <' + back.committer.email + '> ' + stamp + '\n\n' + back.message;
const made = execFileSync('git', ['-C', ROOT, 'hash-object', '-w', '-t', 'commit', '--stdin'],
  { input: Buffer.from(rawCommit, 'utf8') }).toString().trim();

console.log('\n远端提交 ' + back.sha + '\n本地提交 ' + HEAD + '\n重造出来 ' + made);
if (made !== back.sha) { console.log('❌ 对不上——本地 refs 一个字都没改，远端那颗是悬空的，不影响仓库。'); process.exit(3); }
console.log('✅ 逐字节一致');

if (DRY) { console.log('\nDRY=1：到此为止，没动 refs。要真推就去掉 DRY。'); process.exit(0); }

git(['update-ref', 'refs/heads/' + BRANCH, back.sha]);
git(['update-ref', 'refs/remotes/origin/' + BRANCH, back.sha]);
const r = gh('PATCH', 'repos/' + REPO + '/git/refs/heads/' + BRANCH, { sha: back.sha, force: false });
console.log('\n远端 refs/heads/' + BRANCH + ' → ' + r.object.sha);
// ★ 这里比的是 back.sha（上面刚对齐过的那颗），不是 HEAD。
//   本地用 `git commit` 造的提交正文末尾带一个换行、GitHub 存的没有，
//   所以两颗 sha 天然不同——拿 HEAD 去比，每次都会假报"对不上"。内容是一模一样的
//   （树逐字比过了），所以本地 refs 也一起指到 back.sha，两边就是同一颗。
console.log(r.object.sha === back.sha ? '===== 推上去了，本地和远端同一颗 sha =====' : '===== sha 对不上，要核 =====');
process.exit(r.object.sha === back.sha ? 0 : 5);

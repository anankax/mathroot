// 一把一把地跑探针，**每把之前给它一张干净页面**。
//
// 为什么非这样不可（2026-10-06 夜）：
//   这些探针大多数是"从 8138 的标签页里挑一个来用"。挨着跑的时候，
//   上一把留下的页面状态（`Network.setCacheDisabled` 会把 ggbApplet 弄死、
//   上一把正在 reload、上一把摆进去的 fixture）会漏给下一把 ——
//   于是下一把报出**跟产品缺陷长得一模一样**的红：
//      · probe_seeboard  → `ReferenceError: SR is not defined`（抓到了正在 reload 的那一页）
//      · probe_draw_ui   → 「30 秒没等到 ggbApplet」（上一把刚把缓存关掉）
//      · probe_blueprint6→ 「点头之后真出了东西 137 字」（免费档那一趟本来就会丢，跟前面无关）
//   治法不是"把红解释掉"，是**别让它们共用一张页面**。
//
// 用法：node test/_跑一遍.cjs probe_a probe_b ...
const path = require('path'), http = require('http'), { execFileSync } = require('child_process');
const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: 9222, path: p }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))) }).on('error', rej));
const 新 = p => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); q.on('error', rej); q.end() });
const 关 = p => new Promise(r => { const q = http.request({ host: '127.0.0.1', port: 9222, path: p, method: 'GET' }, x => { x.on('data', () => { }); x.on('end', r) }); q.on('error', r); q.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const 名单 = process.argv.slice(2);
  for (const f of 名单) {
    const 旧 = (await 取('/json/list')).filter(t => t.type === 'page' && /8138/.test(String(t.url)));
    for (const t of 旧) await 关('/json/close/' + t.id);
    await 新('/json/new?http://localhost:8138/index.html');
    await sleep(3500);
    let 出 = '', 码 = 0;
    try { 出 = execFileSync(process.execPath, [path.join(__dirname, f + '.cjs')], { encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) { 出 = String(e.stdout || '') + String(e.stderr || ''); 码 = e.status == null ? 9 : e.status; }
    require('fs').writeFileSync(path.join(__dirname, '_out', f + '_final.txt'), 出);
    const 汇 = (出.match(/\d+ 绿 \/ \d+ 红[^\n]*/g) || []).slice(-1)[0] || '（无汇总）';
    const 红 = (出.match(/^.*❌.*$/gm) || []).map(x => x.trim());
    console.log('════ ' + f + ' ════');
    console.log('   ' + 汇 + '   退出码=' + 码);
    红.forEach(x => console.log('   ' + x));
    if (!红.length && 码 !== 0) console.log('   ★ 没打汇总就退了（退出码 ' + 码 + '）—— 上面那份 _out 里有现场');
  }
})();

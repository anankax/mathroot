// 「翻教材」那一档的边界：本机该有，公开站上**连请求都不发**。
//
// ★ 这条要验的是**两件相反的事**，缺一件就等于没验（同族的是 probe_resources.cjs）：
//   1. 本机：教材索引照常装上，「翻教材」照常把附注塞进 system；
//   2. 非本机（= 公开站的处境）：js/textbook.js **一次请求都不发**，翻教材静默退回
//      "没检索到"那一档，而**追问条目库照常**。
//
// ★★ 为什么不能只判 typeof SR.TEXTBOOK：
//   那是**两个原因共用的结果**——"压根没发请求"和"发了、404 了"都会让它是 undefined。
//   只判这一个，等于把真正要保证的那件事（没去拿）漏掉。这里直接数
//   CDP 的 Network.requestWillBeSent 里 textbook.js 出现了几次。
//
// ★ 也别拿 Network.setBlockedURLs 冒充公开站：拦请求验的是"文件拿不到"，
//   而 js/kb.js 的 local() 那道门要证明的是"没去拿"。两件事，别混。
//
// ★★ 断言不焊产品措辞。锚点是**在 Node 里拿真语料跑同一个检索器**算出来的
//   （js/retrieve.js + js/textbook.js + js/kb.js 都是 window.SR 全局写法，
//   在假 window 里加载一遍就是了）。于是"system 里该不该有这一段"这件事，
//   两个分支用同一个字符串判，而这个字符串是从文件长出来的、不是我想出来的。
//   ——焊一句我以为的标注语，产品一改字词就报假警，那正是这个仓库栽过的坑。
//
// ★ 那条"追问条目库照常"是**对照组，不是废话**：没有它，一个把两份语料
//   一起挡掉的实现也能让上面几条全绿——门坏了反而更像通过。
//
// 用法（先起 node test/serve.cjs 8138，Chrome 在 9222）：
//   本机     node test/probe_textbook_boundary.cjs
//   冒充公开站 SR_PAGE=http://192.168.2.61:8138/index.html node test/probe_textbook_boundary.cjs
//            （同一份代码、同一个服务，只是 host 不叫 localhost——正好走 local() 的假那一支）
//   真公开站 SR_PAGE=https://anankax.github.io/mathroot/ node test/probe_textbook_boundary.cjs
//            （推上线之后再跑；那时 js/textbook.js 应当 404）
// 退出码：0 = 对；1 = 有问题；2 = 探针自己炸了；3 = 尺子坏了（锚点都算不出来，先修仪器）
const path = require('path'), http = require('http'), fs = require('fs'), cp = require('child_process');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const REPO = path.join(__dirname, '..');
// 一句**点了知识点名**的话：泛泛的话本来就召不回，拿它当靶子会把
// "门挡住了"和"这句话本来就不命中"混成一件。这句按本机那一档必须命中。
const Q = '数轴上到原点的距离是3的点有几个';

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}
// 关掉自己开的那个标签页。★ 探针开的页必须自己关——只 ws.close() 不关页，
//   开一次攒一个，上一批就是这么攒到四十几个的。
function closeTab(tid) {
  return new Promise(res => {
    const r = http.request({ host: 'localhost', port: 9222, path: '/json/close/' + tid, method: 'GET' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', () => res(null)); r.end();
  });
}

// ---- 在 Node 里用**真语料**跑一遍同一个检索器，算出"该给的那一段" ----
function anchorFromDisk() {
  const loc = { hostname: 'localhost', protocol: 'http:' };
  const win = { location: loc };
  for (const f of ['js/retrieve.js', 'js/textbook.js', 'js/kb.js']) {
    new Function('window', 'location', fs.readFileSync(path.join(REPO, f), 'utf8'))(win, loc);
  }
  const SR = win.SR;
  const hits = SR.findTextbook(SR.kb.queryFor(Q, []), 2) || [];
  const cut = SR.kb.cut('textbook');
  const kept = hits.filter(h => h.score >= cut).map(h => h.doc.text.trim());
  return { kept: kept.join('\n\n'), top: kept.length ? kept[0] : '', scored: hits.length };
}

(async () => {
  // ---- 前置：仓库状态。这是**外部锚点**——不由页面自己说了算 ----
  const tracked = cp.execSync('git ls-files js/textbook.js', { cwd: REPO }).toString().trim();
  const tbPath = path.join(REPO, 'js', 'textbook.js');
  const onDisk = fs.existsSync(tbPath);
  console.log('前置｜git 里有没有 js/textbook.js : ' + (tracked ? '★ 有 —— ' + tracked : '没有'));
  console.log('前置｜本机盘上有没有              : ' + (onDisk ? '有（' + fs.statSync(tbPath).size + ' 字节）' : '没有'));
  ok('js/textbook.js 不在仓库里（撤下来了）', !tracked, tracked || undefined);
  ok('本机那份文件还在（本机能力没被连根拔）', onDisk);

  // ---- 锚点：从盘上那份真语料算，不在浏览器里请教产品 ----
  if (!onDisk) { console.log('★ 本机没有 js/textbook.js，锚点算不出来——先修仪器。'); process.exit(3); }
  const A = anchorFromDisk();
  const ANCHOR = A.top.slice(0, 40);            // 头 40 字足够独特，又不至于被截断影响
  console.log('\n锚点（本机语料按这句话该给的第一条，取头 40 字）:');
  console.log('  ' + (ANCHOR || '★ 空——检索器对这句话一条都没给'));
  console.log('  该给的合计 ' + A.kept.length + ' 字，候选 ' + A.scored + ' 条\n');
  if (!ANCHOR) {
    console.log('★ 锚点都算不出来，后面的判什么都没意义——先修仪器（语料还在盘上吗？句子还命中吗？）。');
    process.exit(3);
  }

  // ---- 开页 ----
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  let reqTb = 0, reqZw = 0;                 // 数请求，这才是本探针的命根子
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; return; }
    if (r.method === 'Network.requestWillBeSent') {
      const u = (r.params && r.params.request && r.params.request.url) || '';
      if (/textbook\.js(\?|$)/.test(u)) reqTb++;
      if (/zhuawen\.js(\?|$)/.test(u)) reqZw++;
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300);
    return R && R.result ? R.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.chat&&SR.api&&SR.kb)')) break; await wait(500); }
  await wait(800);

  const host = await q('location.hostname');
  const proto = await q('location.protocol');
  const onLocal = (['localhost', '127.0.0.1', ''].indexOf(host) >= 0) || proto === 'file:';
  console.log('这一趟跑在 : ' + proto + '//' + (await q('location.host')) +
              '　→　按' + (onLocal ? '**本机**' : '**非本机（公开站的处境）**') + '那一档判\n');

  const before = await q('typeof SR.TEXTBOOK');
  ok('首屏还没有教材索引（延迟装载还生效）', before === 'undefined', before);

  // 假 fetch：不真打模型，只把**真发出去的那一段**抓下来。
  // ★ work 必须给 prep／review——附注是挂在工位上的（SR.WORKS[x].retrieve），
  //   不给 work 就落回默认的 material，而它 retrieve:false，附注本来就不该有。
  await q(`window.__cap=null; window.fetch=function(u,o){ window.__cap=JSON.parse(o.body);
    var s='data: {"choices":[{"delta":{"content":"嗯，你说。"}}]}\\n\\ndata: [DONE]\\n\\n';
    return Promise.resolve(new Response(s,{status:200,headers:{'Content-Type':'text/event-stream'}})); };`);

  const sys = await q('(async function(){ window.__cap=null;'
    + ' await SR.api.ask({work:"prep", text:' + JSON.stringify(Q) + ', history:[], parts:[], onChunk:function(){}});'
    + ' return window.__cap ? window.__cap.messages[0].content : null; })()');
  const sysS = sys === null || sys === undefined ? '' : String(sys);
  const len = sysS.length;
  // 产品自己留的那一份（api.js 的 SR.api.lastSystem）——跟线上的这份对不对得上，
  // 是个便宜的独立交叉验证：它俩不一致，说明"它自己以为发了什么"和"真发了什么"是两码事。
  const last = await q('typeof SR.api.lastSystem === "string" ? SR.api.lastSystem : null');
  const tbNow = await q('typeof SR.TEXTBOOK');
  const zwNow = await q('typeof SR.ZHUAWEN');
  const hitsNow = await q('typeof SR.TEXTBOOK === "string" ? (SR.findTextbook(SR.kb.queryFor('
    + JSON.stringify(Q) + ', []), 2) || []).length : -1');
  const yuans = (sysS.match(/【书上原话】/g) || []).length;

  console.log('跑完一轮之后：');
  console.log('  typeof SR.TEXTBOOK        : ' + tbNow);
  console.log('  typeof SR.ZHUAWEN         : ' + zwNow);
  console.log('  对 textbook.js 的请求数   : ' + reqTb);
  console.log('  对 zhuawen.js  的请求数   : ' + reqZw);
  console.log('  system 里有没有那段锚点   : ' + (sysS.indexOf(ANCHOR) >= 0 ? '有' : '没有'));
  console.log('  system 里【书上原话】处数 : ' + yuans);
  console.log('  system 字数               : ' + len + '\n');
  ok('产品自己记的那一份 system，跟真发出去的一致', last === null || last === sysS,
     last === null ? '（这版还没留 lastSystem）' : { 记的: String(last).length, 发的: len });

  if (onLocal) {
    // ★ 尺子自检：本机这一档**本来**就该装上。装不上说明是仪器的问题
    //   （生成脚本没跑过 / 服务没起 / 端口不对 / 工位没给对），不是边界的问题。
    if (tbNow !== 'string') {
      console.log('★ 本机这趟教材索引都没装上——先修仪器（跑过 test/build_prompt.py 吗？服务起在 8138 吗？'
        + 'Chrome 的 9222 是这个 profile 吗？），这时候判"公开站有没有藏住"什么都说明不了。');
      await closeTab(t.id); ws.close(); process.exit(3);
    }
    ok('本机：教材索引装上了', tbNow === 'string', tbNow);
    ok('本机：追问条目库也装上了', zwNow === 'string', zwNow);
    ok('本机：确实发了一次 textbook.js 请求（本来就该发）', reqTb >= 1, reqTb);
    ok('★ 本机：按同一句话该给的那一段，原样进了 system（锚点逐字对）',
       sysS.indexOf(ANCHOR) >= 0, { 锚点: ANCHOR, 命中: sysS.indexOf(ANCHOR) >= 0 });
    ok('本机：检索器给出的候选数跟盘上那份对得上（同一套语料）', hitsNow === A.scored, { 页里: hitsNow, 盘上: A.scored });
    ok('本机：对话没被挡住（system 正常发出去）', len > 200, len);
    console.log('\n===== 本机这一档：' + (FAIL === 0 ? '通过（照常翻教材）' : '有问题') + ' =====');
  } else {
    ok('★ 非本机：**一次都没有请求** js/textbook.js', reqTb === 0, reqTb);
    ok('非本机：SR.TEXTBOOK 从头到尾是 undefined', tbNow === 'undefined', tbNow);
    ok('★ 对照：追问条目库照常请求、照常装上（门只挡该挡的那一份）',
       reqZw >= 1 && zwNow === 'string', { 请求数: reqZw, typeof: zwNow });
    ok('★★ 非本机：那段教材索引**一个字都没进 system**（锚点逐字找，找不到才算数）',
       sysS.indexOf(ANCHOR) < 0, { 锚点: ANCHOR, 找到了: sysS.indexOf(ANCHOR) >= 0 });
    ok('非本机：system 里一处【书上原话】都没有', yuans === 0, yuans);
    ok('非本机：对话照常跑通，没把页面弄塌', len > 200, len);
    console.log('\n===== 非本机这一档：' + (FAIL === 0 ? '通过（连请求都不发，且对话照常）' : '有问题') + ' =====');
  }

  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e); process.exit(2); });

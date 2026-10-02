// 端到端：**在真来源上，把「资料库那一步」走通到底**。
//
// 它回答的是孔老师批的那句话里最后那一格——「前端拿到答案」：
//   本机抽 → 存 PG → 云函数查 → 喂模型 → **前端拿到答案**
// 前面四格各有一把尺子了（_extract / _pg_ingest / probe_reslib_cloud / check_prep_prompts），
// 这一把是唯一**从头到尾一次走完**的：真人打字 → 流水线跑 → 云上翻 → 附注进提示词 → 模型回话 → 屏幕上出字。
//
// ★★ 为什么必须在 https://anankax.github.io 这个来源上跑，不能在本机跑：
//   云函数 gate 有两道门槛，第二道认 Referer（见 cloudfunctions/gate/index.js 的 ALLOW_ORIGIN），
//   白名单里**只有 https://anankax.github.io**。本机那个来源（不管 localhost 还是局域网 IP）
//   会被回 403「来源不对」——那一步就记成"没翻到"，而**"来源被挡"和"库里真没有"从外面看一模一样**。
//   另一条路（从 localhost 调）另外还坏在 CORS 上：网关对 localhost 这个来源回了两个
//   Access-Control-Allow-Origin，Chrome 判 MultipleAllowOriginValue，请求根本到不了函数。
//   ⇒ 所以这一步只能在真来源上验，没有别的地方能替代。
//
// ★★ 那线上那份代码怎么办？——**用本机这份顶上去**。
//   线上现在（HEAD 12f0b17）**根本没有 js/flow.js 和 js/gate.js**，index.html 里也没引它们。
//   所以这个探针把 https://anankax.github.io/mathroot/* 的每一个请求都拦下来、
//   用本机磁盘上的文件回给它。于是：**来源还是真的那个来源**（Referer、CORS 全按真来源走），
//   **代码是本机工作区这一份**。这两件事分开说清楚，别混成"我验过线上了"。
//   ⚠ 它**不推 GitHub**。要真上线是另一件事（孔老师点头才推）。
//
// ★ 它**绝不打印语料正文**：账本里那一步的 `out` 就是他的材料原文，
//   所以读账本时只取长度、不取内容（见 readLedger）。要改这个文件时别把 out 放回来。
//
// ★ 五之二（那几块材料的名字）跑过红验：在**真的 js/flow.js** 上把 shortName 改回
//   "整条路径"（备份 → 改 → 跑 → 还原，md5 核过），那一条真红：
//   出处 3 条、带完整路径的 3 条，产物从 1920 字涨到 2125 字。
//   ⇒ 它量的是真这条路，不是"函数单独拿出来对不对"（那个是 probe_flow ⑨）。
//   ⚠ 另一条（"出处条数 ＝ 块数"）在这一轮**红不了**：云上按 k=3 只回三条，
//     三条又都装得下，所以"照命中全抄"跟"只收进去的那几条"在这一轮**结果一样**。
//     真要逼它红得让命中数多过预算，那是 probe_flow ⑨ 里那条合成用例干的活。
//     别以为这里绿了就说明那条防线在——它在这儿本来就不受力。
//
// 用法（Chrome 开在 9222）：
//   node test/probe_reslib_e2e.cjs
//   ASK='绝对值这一节怎么讲' node test/probe_reslib_e2e.cjs
// 退出码：0 = 都对；1 = 有地方对不上；2 = 探针自己炸了；3 = 器械没起来（页面/代码没装上）

const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://anankax.github.io';
const PAGE = ORIGIN + '/mathroot/';

// 云函数那道门。探针**不直接调它**——只从网络事件里看浏览器有没有发、回了什么。
const GATE = 'https://kax1014-d1g5uttgka7757f39-1472214480.ap-shanghai.app.tcloudbase.com/gate';

// ★ 这两句是**我写在 js/api.js 里的字**，不是他的材料。
//   拿它们当"附注到底进没进提示词"的判据：它们出现在发给模型的 body 里，就说明那一段真拼进去了。
const MARK_RESLIB = '# 附：这一轮从老师资料库里翻出来的几块';
const MARK_TEXTBOOK = '# 附：这一轮给你翻出来的教材索引';
// 提示词里那一节的节名（js/prompt-prep.js，两份同名）——附注末尾那句指路就是指着它。
const MARK_SECTION = '# 手上翻到的东西怎么用';

const ASK = process.argv[2] || '有理数的乘方这一节怎么讲';

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
// 自己开的标签页自己关（别往他的浏览器里倒垃圾）。只关**自己开的那个 id**。
function closeTab(id) {
  return new Promise(res => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id },
    x => { x.resume(); x.on('end', res); }).on('error', res));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

let TAB = null;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank')); TAB = t.id;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });

  // ---- 网络事件的账（判"有没有真发出去"靠它，不靠账本）----
  const posted = [];          // {url, method, postData}
  const status = {};          // requestId → status
  const fulfilled = [];       // 本机顶上去的几个文件
  const fellThrough = [];     // 本机没有、只好放它走线上那份的

  ws.on('message', async m => {
    const r = JSON.parse(m);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; return; }
    if (r.method === 'Network.requestWillBeSent') {
      const q = r.params.request;
      posted.push({ id: r.params.requestId, url: q.url, method: q.method, postData: q.postData || '' });
    }
    if (r.method === 'Network.responseReceived') {
      status[r.params.requestId] = r.params.response.status;
    }
    // ★ Fetch 拦下的每一个请求**都必须有个了断**（fulfill 或 continue），
    //   漏一个那一发请求就永远挂着、页面卡住——看着像"网站坏了"，其实是探针自己。
    if (r.method === 'Fetch.requestPaused') {
      const { requestId, request } = r.params;
      let done = false;
      try {
        const u = new URL(request.url);
        if (u.host === 'anankax.github.io' && u.pathname.indexOf('/mathroot') === 0) {
          let rel = u.pathname.slice('/mathroot'.length).replace(/^\/+/, '') || 'index.html';
          if (rel.endsWith('/')) rel += 'index.html';
          const f = path.join(ROOT, rel);
          // ★ 只许读仓库里的东西：路径逃逸一律放它走线上（不是"回个空"，那样会假装成功）
          if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
            const body = fs.readFileSync(f);
            await send('Fetch.fulfillRequest', {
              requestId, responseCode: 200,
              responseHeaders: [
                { name: 'Content-Type', value: MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' },
                { name: 'Cache-Control', value: 'no-store' }
              ],
              body: body.toString('base64')
            });
            fulfilled.push(rel);
            done = true;
          } else {
            fellThrough.push(rel);
          }
        }
      } catch (e) { /* 底下会兜底 continue */ }
      if (!done) { try { await send('Fetch.continueRequest', { requestId }); } catch (e) {} }
    }
  });

  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Network.enable', {});
  // ★ 关缓存。不关的话本机顶上去的 js 可能被上一趟的缓存替回来，
  //   于是"跑的是新代码"这句话就没了凭据（这一坑在别处踩过）。
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- 开始顶替 ----
  await send('Fetch.enable', { patterns: [{ urlPattern: ORIGIN + '/mathroot/*', requestStage: 'Request' }] });

  console.log('来源：' + PAGE + '  （页面从线上取，文件用本机这份顶）');
  console.log('问的是：' + ASK + '\n');

  await send('Page.navigate', { url: PAGE });
  let up = false;
  for (let i = 0; i < 60; i++) { if (await q('!!(window.SR&&SR.chat&&SR.flow)')) { up = true; break; } await sleep(500); }

  // ============================================================
  //  尺子自检 —— 先证明这把尺子量得到东西，一条都不问产品
  // ============================================================
  console.log('===== 尺子自检 =====');
  // ① 本机那份 js 真顶上去了吗。**这条不过，下面全线没有意义**——
  //    线上那份 HEAD 里压根没有 flow.js，SR.flow 能是函数就只可能是因为顶上去了。
  const jsN = fulfilled.filter(x => x.indexOf('js/') === 0).length;
  console.log('  本机顶上来的文件 ' + fulfilled.length + ' 个（其中 js ' + jsN + ' 个）' +
    (fellThrough.length ? '，本机没有放它走线上的 ' + fellThrough.length + ' 个：' + fellThrough.slice(0, 6).join(' ') : ''));
  if (jsN < 20) {
    console.log('★★★ 尺子自己坏了 —— 本机那份 js 没顶上去（只顶上 ' + jsN + ' 个）。');
    console.log('   这时候 SR.flow 就算在，也说不清跑的是哪一份代码。先修这个探针。');
    if (TAB) await closeTab(TAB); ws.close(); process.exit(3);
  }
  // ② 页面起来了吗
  if (!up) {
    console.log('★★★ 页面没起来（60 次轮询都没等到 window.SR.flow）——服务/Chrome/拦截三处先查。');
    if (TAB) await closeTab(TAB); ws.close(); process.exit(3);
  }
  console.log('  页面起来了  ' + (up ? '过' : '★ 不过'));
  console.log('');

  // ============================================================
  //  前置：仪器在不在（缺一堆就说明装的不是这一份代码，先别往下判）
  // ============================================================
  const has = await q(`({
    flow: typeof SR.flow, plan: (SR.flow && SR.flow.plan) ? SR.flow.plan('prep') : null,
    step: (SR.flow && SR.flow.STEPS) ? !!SR.flow.STEPS.reslib : false,
    gateFn: typeof SR.gate.reslib, host: !!document.getElementById('flowlist'),
    input: !!document.getElementById('input'), send: !!document.getElementById('send')
  })`);
  if (!has || has.flow !== 'object' || has.gateFn !== 'function' || !has.step || !has.host) {
    console.log('★ 仪器不对，先别往下判：' + JSON.stringify(has));
    console.log('  该有的是：SR.flow 一个对象、SR.flow.STEPS.reslib、SR.gate.reslib 一个函数、#flowlist 一个元素。');
    await send('Fetch.disable').catch(() => {});
    if (TAB) await closeTab(TAB); ws.close(); process.exit(3);
  }

  console.log('===== 一、这一步在不在流水线上 =====');
  ok('备课那条线的顺序里真有 reslib，而且排在两步检索之后、拼提示词之前',
    Array.isArray(has.plan) && has.plan.indexOf('reslib') >= 3 &&
    has.plan.indexOf('reslib') < has.plan.indexOf('prompt'), has.plan);

  // ============================================================
  //  二、真走一轮
  // ============================================================
  console.log('\n===== 二、真打一句话走一轮 =====');
  await q(`document.querySelector('.workbtn[data-work="prep"]').click()`);
  await sleep(500);

  const before = posted.length;
  await q(`(()=>{const i=document.getElementById('input');i.value=${JSON.stringify(ASK)};
    i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('send').click();return 1})()`);

  // 等它收完：判据是**发送键重新可点**（submit 最后那个 then 才恢复它）。
  // ⚠ 别用"没有三点动画"当判据——那个动画开头就被正文替掉了，会量到半句话。
  let waited = 0;
  while (waited < 120000) {
    await sleep(1000); waited += 1000;
    if (await q(`document.getElementById('send') && document.getElementById('send').disabled === false`)) break;
  }
  await sleep(1000);
  console.log('  等了 ' + Math.round(waited / 1000) + ' 秒');

  const out = posted.slice(before);

  // ---- 三、云上那一步：**发出去没有**（看网络事件，不看账本）----
  // ★ 账本说"云上没答上来"和"根本没发"从外面长得一样，所以这里查的是**请求本身**。
  console.log('\n===== 三、那一步真发出去了吗 =====');
  const gatePosts = out.filter(x => x.url.indexOf(GATE) === 0 && x.method === 'POST');
  const steps = gatePosts.map(x => { try { return JSON.parse(x.postData).step; } catch (e) { return '(不是JSON)'; } });
  console.log('  这一轮打到云函数上的 POST ' + gatePosts.length + ' 条：' + JSON.stringify(steps));
  const resReq = gatePosts.find(x => { try { return JSON.parse(x.postData).step === 'reslib'; } catch (e) { return false; } });
  ok('★ 浏览器真发了一条 step=reslib 上去', !!resReq, steps);
  if (resReq) {
    const st = status[resReq.id];
    ok('★ 云函数回的是 200（403 就是来源被挡，401 就是口令不对）', st === 200, st);
  }

  // ---- 四、账本：这一步落成什么了 ----
  // ★ 只取长度，不取 out 本身——那是他的材料原文。
  console.log('\n===== 四、账本上这一步落成什么了 =====');
  const led = await q(`(function(){
    var rs = SR.flow.list(); var r = rs[rs.length-1]; if(!r) return null;
    return { n:r.n, work:r.work, steps: r.steps.map(function(s){
      return { id:s.id, name:s.name, state:s.state, ms:s.ms, route:s.route,
               note:s.note, outLen:(s.out||'').length };   /* ★ 不取 s.out 本身 */
    })};
  })()`);
  if (!led) {
    console.log('  ★ 账本里一条回合都没有——那一步根本没开始跑。下面几条不判了。');
    FAIL++;
  } else {
    console.log('  这一回合 ' + led.steps.length + ' 步：' +
      led.steps.map(s => s.name + '(' + s.state + ')').join(' → '));
    const rs2 = led.steps.find(s => s.id === 'reslib');
    ok('账本里真有 reslib 这一步', !!rs2, led.steps.map(s => s.id));
    if (rs2) {
      ok('★ 它落成了 done（云上真翻到了东西）', rs2.state === 'done', { state: rs2.state, note: rs2.note });
      ok('★ 产物不是空的（拼进提示词的字数 > 0）', rs2.outLen > 0, rs2.outLen);
      console.log('     走的是「' + rs2.route + '」，用了 ' + rs2.ms + 'ms，产物 ' + rs2.outLen + ' 字');
      console.log('     翻到的（标题＋分数，正文没往这儿打）：' + (rs2.note || '(空)'));
    }
  }

  // ---- 五、附注到底进没进提示词 ----
  // ★ 判据是我写在 js/api.js 里的那两句话，出现在**发给模型的 body** 里。
  //   这不问"模型用没用它"，只问"它到没到模型手上"——后者是这一步能不能算数的最低条件。
  console.log('\n===== 五、那段附注到模型手上了吗 =====');
  const bodies = out.filter(x => x.postData && x.postData.length > 200).map(x => x.postData);
  console.log('  这一轮带 body 的请求 ' + bodies.length + ' 条，最长 ' +
    (bodies.length ? Math.max(...bodies.map(b => b.length)) : 0) + ' 字');
  const hay = bodies.join('\n');
  if (!hay) {
    // 对照组非空——没有 body 可比的时候，"没找到附注"这句话一个字都不值
    ok('★ 对照组非空（有能撞的 body可比）', false, '一条长 body 都没有，这一条等于没验');
  } else {
    ok('★ 发给模型的 body 里真带着「资料库里翻出来的几块」那一段', hay.indexOf(MARK_RESLIB) >= 0);
    ok('★ 也带着那段指路要落的节（' + MARK_SECTION + '）', hay.indexOf(MARK_SECTION) >= 0);
    // 自证：同一个搜索换个不存在的标记，必须找不到（否则"找到了"这句没有意义）
    ok('   （自证）搜一个不存在的标记必须找不到', hay.indexOf('# 附：这一段根本不存在') < 0);
    console.log('     教材索引那段这一轮' + (hay.indexOf(MARK_TEXTBOOK) >= 0 ? '也在' : '没在') +
      '（它有没有，看的是课本那份索引命不命中，不是这一步的事）');
  }

  // ---- 五之二、那几块材料的名字，进提示词的是短名还是整条路径 ----
  // ★ 为什么 probe_flow 里量过了这里还要量：那边量的是"**那个函数单独拿出来**对不对"。
  //   这一条量的是"**真跑这一轮**的时候，进那一段的到底是哪一串"——中间还隔着
  //   云上回什么、账本怎么存、origins 怎么拼这三处，其中任何一处把整条路径塞回去，
  //   函数本身照样测得过。整条链上只有这一处能看见这件事。
  //
  // ★ 判据全部取自**产品自己的数据**，尺子不掺任何写死的字样：
  //   出处名单 origins 里，每条的第二行就是它记下的**完整路径**；
  //   产物 out 就是**真进提示词的那一段**（js/api.js:326 是把 rb 原样拼进去的，
  //   所以"out 里没有"和"发出去的 body 里没有"是同一件事）。
  //   于是这一条问的是："你自己记下来的完整路径，出现在你自己发出去的那段里了吗。"
  //
  // ★ 只回个数与真假 —— 那些路径是他的语料名单，不进我的上下文，也不进终端。
  const trim = await q(`(function(){
    var rs = SR.flow.list(); var r = rs[rs.length-1]; if(!r) return null;
    var s = r.steps.filter(function(x){return x.id==='reslib';})[0]; if(!s) return null;
    var out = s.out || '';
    var org = s.origins || [];
    var fulls = org.map(function(t){
      var lines = String(t).split('\\n');
      return lines.length > 1 ? lines[lines.length-1].trim() : '';
    }).filter(function(x){ return !!x; });
    var bad = fulls.filter(function(f){ return out.indexOf(f) >= 0; });
    return { 出处条数: org.length, 现出完整路径的有: fulls.length,
             完整路径出现在产物里的: bad.length,
             产物里的块数: (out.match(/〔\\d+〕/g) || []).length,
             产物字数: out.length };
  })()`);
  console.log('\n===== 五之二、那几块材料的名字（短名，还是整条路径）=====');
  if (!trim || !trim.出处条数 || !trim.现出完整路径的有) {
    // ★ 对照组非空才成立。这一步被跳过、或账本里没记 origins 时，
    //   下面几条**不能算过**——"没东西可比"和"比了是对"长得一模一样。
    ok('★ 这一轮得有材料进来才谈得上名字（没进来＝这条没验，不是通过）', false,
       trim ? ('出处 ' + trim.出处条数 + ' 条、能拆出完整路径的 ' + trim.现出完整路径的有 + ' 条') : '账本里没拿到 reslib 那一步');
  } else {
    ok('   （尺子自检）把出处拆成完整路径，条数跟出处条数对得上（一条都没拆掉）',
       trim.现出完整路径的有 === trim.出处条数, trim);
    ok('★ 报出来的出处条数 ＝ 真进那一段的块数（不是照命中全抄）',
       trim.出处条数 === trim.产物里的块数, trim);
    ok('★★ 完整路径一条都没进那一段 —— 进的是短名',
       trim.完整路径出现在产物里的 === 0, trim);
    console.log('     出处 ' + trim.出处条数 + ' 条，产物 ' + trim.产物字数 + ' 字，' +
      '块数 ' + trim.产物里的块数 + '，其中带完整路径的 ' + trim.完整路径出现在产物里的 + ' 条');
  }

  // ---- 六、屏幕 ----
  console.log('\n===== 六、屏幕 =====');
  const scr = await q(`(function(){
    var bs=[...document.querySelectorAll('.msg.assistant .bubble')]; var b=bs[bs.length-1];
    // ★ 行是 div.fstep.st-<状态>，名字在 .fname 里（没有 data-step 这种属性）。
    //   第一版这里查的是 [data-step]——**恒回空数组**，屏幕上明明画着东西却报"一步都没有"。
    //   又一条"数字不是它宣称的那件事"，所以现在按**真结构**查。
    var rows=[...document.querySelectorAll('#flowlist .fstep')].map(function(x){
      var nm=x.querySelector('.fname');
      return { 名: nm?nm.textContent:'(没名字)', 状态:(x.className.match(/st-([a-z]+)/)||[])[1]||'?' };
    });
    // ★ 判据不写死中文：拿**步骤表里那一步自己叫的名字**去认那一行。
    //   尺子问的是"表里那一步在面板上有没有位置、亮成什么"，不是"那行字长什么样"。
    var want=(SR.flow.STEPS&&SR.flow.STEPS.reslib)?SR.flow.STEPS.reslib.name:'';
    var hit=rows.filter(function(x){return x.名===want;})[0]||null;
    return { 气泡数: bs.length, 最后一屏字数: ((b?b.innerText:'')||'').length,
             步骤表里那一步叫: want,
             面板上这一轮的行: rows.slice(-7),
             那一行: hit };
  })()`);
  console.log('  ' + JSON.stringify(scr, null, 0));
  ok('★ 模型回话到了屏幕上（最后一屏不是空的）', scr && scr.最后一屏字数 > 0, scr && scr.最后一屏字数);
  ok('★ 面板上真有那一步的位置', !!(scr && scr.那一行), scr && scr.面板上这一轮的行);
  ok('★ 而且它亮成 done（不是灰着、不是标成得重来）',
    !!(scr && scr.那一行 && scr.那一行.状态 === 'done'), scr && scr.那一行);

  // ---- 收尾 ----
  await send('Fetch.disable').catch(() => {});
  await closeTab(TAB); ws.close();
  console.log('\n跑了 ' + (PASS + FAIL) + ' 条，红的 ' + FAIL + ' 条。');
  console.log('★ 这一趟跑的是**本机工作区这份代码**，只是挂在真来源上（来源是真的，代码不是线上那份）。');
  console.log('  要真上线是另一件事：推 GitHub Pages。');
  process.exit(FAIL ? 1 : 0);
})().catch(async e => {
  console.log('探针自己挂了：' + ((e && e.message) || e));
  if (TAB) { try { await closeTab(TAB); } catch (x) {} }
  process.exit(2);
});

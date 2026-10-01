// 学生说"我画不出来"，屏幕上到底有没有出现一条空数轴？
//
// ★ 这条为什么单独测：v18 提示词的「办法三」要求老师把空数轴递给学生，
//   可免费通道那颗文字模型守不住（实测 1/8），所以 2026-10-01 在 js/board.js 里加了本地兜底
//   giveBlank()，由 js/chat.js 在"模型没真画东西"时调用。
//   兜底落在**界面状态**上（showNumLine 走的是 setAxesVisible，不是 evalCommand），
//   所以判据不能去数画板命令，得直接看坐标轴：
//     showNumLine → setAxesVisible(true, false)
//     showPlane   → setAxesVisible(true, true)
//   这个状态只有这两个函数能造成，模型画不出来，所以它一旦为真就一定是兜底补的。
//
// ★ 用什么量这个状态，我第一版量错了（2026-10-01）：
//   写成 `ggbApplet.getVisible("xAxis")` —— 它**不管** setAxesVisible 设的开关，
//   数轴明明画出来了，读回来还是 true/true，探针就报"没补上"。白追一轮。
//   真正跟这个开关走的是 XML：`ggbApplet.getXML()` 里
//     `<axis id="0" … show="…">` 是 x 轴、`<axis id="1" … show="…">` 是 y 轴
//     （GeoGebra 的 AXIS_X=0、AXIS_Y=1，不是 1/2）。
//   下面还留了一道自检：先确认"平面态"和"数轴态"在仪器上**读得出差别**，
//   读不出差别就直接喊仪器坏了——不然又是一次"数字不是它宣称的那件事"。
//
// 用法: node test/probe_blank.cjs [后端]      （先起 node test/serve.cjs 8138）
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const BACKEND = process.argv[2] || 'glm';
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const KEY = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'))
  .env.ANTHROPIC_AUTH_TOKEN;

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- 先单测 giveBlank 本身：认得准不准 ----
  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 20; i++) { await sleep(1500); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break; }

  console.log('--- 1. giveBlank 认句子的准头（不花 token）---');
  const CASES = [
    ['你能帮我画个数轴吗，我画不出来。', '数轴'],
    ['老师我画不了数轴', '数轴'],
    ['画一下数轴', '数轴'],
    ['能给个坐标系吗，我画不出来', '坐标系'],
    ['数轴是什么？', ''],            // 只是问概念，不该画
    ['老师，这道题我不会：比较 -2 和 1 的大小。', ''],  // 没说要图，不该画
    ['我标好了，-2 标在 0 左边两格。', ''],
    ['解方程 2x+1=7，我算出来 x=3。', '']
  ];
  let okc = 0;
  for (const [say, want] of CASES) {
    const got = await q('SR.board.giveBlank(' + JSON.stringify(say) + ')');
    const pass = got === want;
    if (pass) okc++;
    console.log('   ' + (pass ? '✓' : '✗') + ' 想要 ' + JSON.stringify(want).padEnd(8) +
                ' 得到 ' + JSON.stringify(got).padEnd(8) + '  ' + say);
  }
  console.log('   认句子里 ' + okc + '/' + CASES.length + ' 条对');

  // ---- 再走一遍真的对话 ----
  // ---- 1b. 先证明这把尺子是准的 ----
  // 仪器本身也要验：拿 showPlane / showNumLine 两个已知状态去量，读数必须不同。
  // 读不出差别 = 尺子坏了，后面的判断一概不算数。
  console.log('\n--- 1b. 校验仪器：两个已知状态读得出差别吗 ---');
  const readAx = () => q(`(function(){var x=ggbApplet.getXML();
     function ax(id){var m=x.match(new RegExp('<axis id="'+id+'"[^>]*show="([^"]*)"'));return m?m[1]:'?';}
     return ax(0)+'/'+ax(1)})()`);
  const settle = async () => { for (let i = 0; i < 20; i++) { await sleep(250); if (!(await q('SR.board.isBusy()'))) break; } await sleep(400); };
  await q('SR.board.setView("2d")'); await settle();
  const plane = await readAx();
  await q('SR.board.run(["#清空","数轴"])'); await settle();
  const line = await readAx();
  console.log('   平面态 x/y = ' + plane + '    数轴态 x/y = ' + line);
  if (plane === line) {
    console.log('\n★ 两个状态读数一样——尺子坏了，下面的结论一个都不能信，先修仪器。');
    process.exit(3);
  }
  console.log('   ✅ 读得出差别（平面=' + plane + '，数轴=' + line + '）');

  console.log('\n--- 2. 端到端：学生真的说一句，看画板 ---');
  await q('localStorage.setItem("mathroot_key", ' + JSON.stringify(KEY) + ')');
  await q('localStorage.setItem("mathroot_mode", "student")');
  await q('localStorage.setItem("mathroot_backend", ' + JSON.stringify(BACKEND) + ')');
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 20; i++) { await sleep(1500); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break; }

  await q('(function(){var b=[...document.querySelectorAll(".segbtn")].find(x=>/学生/.test(x.textContent)); if(b&&!b.classList.contains("on")) b.click(); return 1})()');
  // 先切到坐标系，这样"补出了数轴"这件事不会被"本来就是数轴"蒙混过去
  await q('SR.board.setView("2d")');
  await sleep(1500);

  const nBefore = await q('document.querySelectorAll(".msg.assistant").length');
  await q('(function(){var i=document.getElementById("input");' +
          'i.value="你能帮我画个数轴吗，我画不出来。";' +
          'i.dispatchEvent(new Event("input",{bubbles:true}));' +
          'document.getElementById("send").click();return 1})()');

  let last = '', stable = 0;
  for (let s = 0; s < 90; s++) {
    await sleep(1000);
    const st = await q(`JSON.stringify({busy:document.getElementById("send").disabled,
        n:document.querySelectorAll(".msg.assistant").length,
        text:(document.querySelector(".msg.assistant:last-of-type .bubble")||{}).innerText||"",
        boardBusy:!!(window.SR&&SR.board&&SR.board.isBusy())})`);
    const o = typeof st === 'string' ? JSON.parse(st) : st;
    if (!o || o.n <= nBefore) { process.stdout.write(`\r  ${s + 1}s 等回复…   `); continue; }
    if (o.text === last) stable++; else { stable = 0; last = o.text; }
    process.stdout.write(`\r  ${s + 1}s 已出 ${o.text.length} 字 稳定${stable}   `);
    if (!o.busy && !o.boardBusy && stable >= 2) break;
  }
  console.log('');

  const st = await q(`(function(){
      var x=ggbApplet.getXML();
      function ax(id){ var m=x.match(new RegExp('<axis id="'+id+'"[^>]*show="([^"]*)"')); return m?m[1]:'?(没读到)'; }
      return JSON.stringify({
        x:ax(0), y:ax(1),
        model:(window.SR.chat.lastMeta||{}).model||"",
        say:(document.querySelector(".msg.assistant:last-of-type .bubble")||{}).innerText||"",
        raw:window.SR.chat.lastRaw||""
      });
    })()`);
  const o = typeof st === 'string' ? JSON.parse(st) : st;
  const fence = /```ggb/.test(o.raw || '');
  console.log('【数根】' + o.say.replace(/\n/g, ' ⏎ '));
  console.log('模型写了 ggb 围栏 : ' + (fence ? '是' : '否（那这一条就是本地兜底补的）'));
  console.log('答这一轮的是     : ' + (o.model || '（没记到）'));
  console.log('坐标轴状态       : x轴 show=' + o.x + '  y轴 show=' + o.y);
  const blank = o.x === 'true' && o.y === 'false';
  console.log('画板上是空数轴吗 : ' + (blank ? '✅ 是' : '❌ 不是——学生说了画不出来，屏幕上却没给他一把尺子'));
  // ★ 兜底补了空图，气泡里也得有句话。免费通道掉围栏时，模型这一轮整段回的都是画板命令，
  //   被 render.js 删干净之后气泡是空的——学生盯着空气泡只会以为页面坏了。
  //   这两种情况要分开报：画板上没图（上面那格）和画板上有图但没人说话（这一格）。
  const spoke = !!(o.say && o.say.trim());
  console.log('气泡里有话吗     : ' + (spoke ? '✅ 有（' + o.say.trim().slice(0, 30) + '…）' : '❌ 空的'));

  // ---- 3. 桩测：模型**画了图、正文一句没有** ----
  // ★ 上一格靠模型自己给不给面子——免费通道有时整段回围栏、有时又肯说两句，
  //   同一句提示跑两次结果不一样。所以这一支改成把 SR.api.ask 换掉，喂一段
  //   写死的"只有围栏、没有正文"的回复：模型行为一旦变了它也不受影响，
  //   而这恰恰是 2026-10-01 真正出过一次的场面（学生盯着空气泡以为页面坏了）。
  //   注意围栏里得有真命令——空围栏那条路走的是"本地补空图"，是另一支。
  console.log('\n--- 3. 桩测：只回围栏、一句正文都没有（模型行为换成写死的，不受它心情影响）---');
  await q(`(function(){
     window.__origAsk = SR.api.ask;
     SR.api.ask = function(o){
       var raw = '\\u0060\\u0060\\u0060ggb\\n#清空\\n数轴\\n\\u0060\\u0060\\u0060\\n';
       o.onChunk(raw);
       return Promise.resolve({ text: raw, model: 'STUB', error: '' });
     };
     return 1 })()`);
  await q('SR.board.setView("2d")'); await settle();
  const nB2 = await q('document.querySelectorAll(".msg.assistant").length');
  await q('(function(){var i=document.getElementById("input");' +
          'i.value="帮我画个数轴";' +
          'i.dispatchEvent(new Event("input",{bubbles:true}));' +
          'document.getElementById("send").click();return 1})()');
  let stubSay = '';
  for (let s = 0; s < 20; s++) {
    await sleep(400);
    stubSay = await q('(document.querySelector(".msg.assistant:last-of-type .bubble")||{}).innerText||""');
    const n = await q('document.querySelectorAll(".msg.assistant").length');
    if (n > nB2 && stubSay && !(await q('SR.board.isBusy()'))) break;
  }
  await q('(function(){ SR.api.ask = window.__origAsk; return 1 })()');
  const stubOk = !!String(stubSay).trim();
  console.log('  气泡里：' + (stubOk ? '✅「' + String(stubSay).trim().slice(0, 34) + '…」' : '❌ 还是空的'));
  console.log('  画板上有东西吗：' + (await q(`(function(){var x=ggbApplet.getXML();
     var m=x.match(/<axis id="1"[^>]*show="([^"]*)"/);return m?('y轴 show='+m[1]):'?'})()`)));

  const pass = okc === CASES.length && blank && spoke && stubOk;
  console.log('\n===== ' + BACKEND + ' 空数轴兜底：' + (pass ? '通过' : '有问题') + ' =====');
  process.exit(pass ? 0 : 1);
})();

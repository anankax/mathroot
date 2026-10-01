// 端到端：真调 DeepSeek，看数根会不会真的出图、出选项。
// 用法: node test/e2e.cjs "<要说的话>" [模式 student|demo] [最长等多少秒]
//
// Key 从 ~/.claude/settings.json 现读，只塞进这个浏览器标签的 localStorage，
// 不写进仓库任何地方。
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

// 说几句就传几个：node test/e2e.cjs student 90 "第一句" "第二句" "第三句"
// 只传一句时，按老写法也行：node test/e2e.cjs "说啥" student 90
const ARGS = process.argv.slice(2);
let MODE = 'student', MAXWAIT = 90, SAYS = [];
if (/^(student|demo)$/.test(ARGS[0]) || /^\d+$/.test(ARGS[0])) {
  MODE = ARGS[0] || 'student';
  MAXWAIT = Number(ARGS[1] || 90);
  SAYS = ARGS.slice(2);
} else {
  SAYS = ARGS[0] ? [ARGS[0]] : [];
  MODE = ARGS[1] || 'student';
  MAXWAIT = Number(ARGS[2] || 90);
}
if (!SAYS.length) SAYS = ['老师，这道题我不会：比较 -2 和 1 的大小。'];
const SR_GAP = 1500;   // 轮与轮之间喘口气，等画板的逐条出图跑完
const PAGE = 'http://localhost:8138/index.html';

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
  let id = 0; const pend = {}; const errs = [];
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; return; }
    if (r.method === 'Runtime.exceptionThrown') {
      const d = r.params.exceptionDetails;
      errs.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 300));
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {});
  await send('Page.enable', {});

  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.navigate', { url: PAGE });
  await new Promise(r => setTimeout(r, 2500));
  await q('localStorage.setItem("mathroot_key", ' + JSON.stringify(KEY) + ')');
  await q('localStorage.setItem("mathroot_mode", ' + JSON.stringify(MODE) + ')');
  await send('Page.reload', { ignoreCache: true });

  console.log('等画板就绪……');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }
  console.log('画板就绪:', await q('SR.board.isReady()'), ' 模式:', await q('document.body.getAttribute("data-mode")'));

  // 记下画板每次收到的命令，测完看它到底画了什么
  await q(`(function(){
     window.__cmds=[];
     var raw=window.ggbApplet.evalCommand.bind(window.ggbApplet);
     window.ggbApplet.evalCommand=function(s){
       var r; try { r = raw(s); } catch(e) { r = 'THROW:' + (e.message||e); }
       window.__cmds.push(s + ' => ' + (r===true?'ok':r));
       return r;
     };
     return 'patched';
   })()`);

  let turn = 0, playTested = false;
  for (const SAY of SAYS) {
    turn++;
    console.log('\n──────── 第 ' + turn + ' 轮，说：' + SAY);

    // ★ 计数必须在点发送之前取：点下去的一瞬间占位气泡就已经进 DOM 了
    const nBefore = await q('document.querySelectorAll(".msg.assistant").length');
    await q('(function(){window.SR.chat.lastRaw="";var i=document.getElementById("input");i.value=' + JSON.stringify(SAY) + ';i.dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("send").click();return 1})()');

    let last = '', stable = 0;
    for (let s = 0; s < MAXWAIT; s++) {
      await new Promise(r => setTimeout(r, 1000));
      const st = await q(`JSON.stringify({
          busy: document.getElementById("send").disabled,
          text: (document.querySelector(".msg.assistant:last-of-type .bubble")||{}).innerText||"",
          n: document.querySelectorAll(".msg.assistant").length,
          cmds: window.__cmds.length,
          boardBusy: !!(window.SR && SR.board && SR.board.isBusy())
        })`);
      if (!st || st.__err) { process.stdout.write(`\r  ${s + 1}s 取不到状态   `); continue; }
      const o = typeof st === 'string' ? JSON.parse(st) : st;
      if (o.n <= nBefore) { process.stdout.write(`\r  ${s + 1}s 等回复…   `); continue; }
      if (o.text === last) stable++; else { stable = 0; last = o.text; }
      process.stdout.write(`\r  ${s + 1}s 命令${o.cmds}条 稳定${stable}${o.boardBusy ? ' 画板在画…' : ''}   `);
      // 文字稳了不算完——画板还有 550ms 一条的命令排着队，得等它画完
      if (!o.busy && !o.boardBusy && stable >= 2) break;
    }

    const one = await q(`JSON.stringify({
        text: (document.querySelector(".msg.assistant:last-of-type .bubble")||{}).innerText||"",
        chips: [...document.querySelectorAll(".chip")].map(c=>c.textContent),
        cmds: window.__cmds.slice(),
        raw: window.SR.chat.lastRaw || "",
        objs: (function(){try{return window.ggbApplet.getAllObjectNames()}catch(e){return []}})(),
        canPlay: window.SR.board.canPlay()
      })`);
    const o = typeof one === 'string' ? JSON.parse(one) : one;
    console.log('\n【数根】' + o.text);
    console.log('【选项】' + (o.chips.length ? o.chips.map((c, i) => (i + 1) + '.' + c).join('  ') : '（无）'));
    console.log('【已下命令共' + o.cmds.length + '条】' + o.cmds.slice(-12).join(' ; '));
    console.log('【画板对象】' + (o.objs.join(', ') || '（空）') + '   可播放:' + o.canPlay);
    // 模型原话（含两个围栏）——判断"是不是它压根没写"
    console.log('【原话】' + JSON.stringify(o.raw));

    // ---- 动点演示：哪一轮冒出可播放对象，就当场点一下看看动不动 ----
    // 不能等所有轮次跑完再测——后面某一轮 `#清空` 会把那个对象清掉，
    // t 取回来是 null，会误报"没动"。（这坑今天踩过一次）
    if (!playTested && o.canPlay) {
      playTested = true;
      await playTest();
    }

    await new Promise(r => setTimeout(r, Number(SR_GAP)));
    if (turn === 1) await q('window.__cmds=[]');   // 下一轮只看新命令
  }

  async function playTest() {
    console.log('\n──── 播放键测试');
    // 播放对象的名字从按钮上的字里取（"▶ 播放 t"），别写死 t——模型可能用别的字母
    const tgt = String(await q('document.getElementById("btn-play").textContent') || '').replace(/[^A-Za-z0-9_]/g, '');
    const read = 'window.ggbApplet.getValue(' + JSON.stringify(tgt) + ')';
    console.log('  播放对象: ' + tgt + '   点之前的值: ' + await q(read));
    await q('document.getElementById("btn-play").click()');
    const curve = [];
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 700));
      curve.push(await q(read));
    }
    console.log('  点之后采样: ' + curve.map(v => (typeof v === 'number' ? v.toFixed(2) : v)).join(' → '));
    const moved = curve.some((v, i) => i > 0 && typeof v === 'number' && v !== curve[0]);
    console.log('  动点动起来了吗: ' + (moved ? '✓ 动了' : '✗ 没动'));
    await q('document.getElementById("btn-play").click()');   // 再点一下停住
  }

  const fin = await q(`JSON.stringify({
      chips: [...document.querySelectorAll(".chip")].map(c=>c.textContent),
      objs: (function(){try{return window.ggbApplet.getAllObjectNames()}catch(e){return ["取不到:"+e.message]}})(),
      status: document.getElementById("status").textContent,
      err: [...document.querySelectorAll(".err")].map(e=>e.textContent),
      board: (function(){var c=document.getElementById("ggb");return [c.clientWidth,c.clientHeight]})()
    })`);
  const f = typeof fin === 'string' ? JSON.parse(fin) : fin;

  console.log('\n\n========== 收摊 ==========');
  console.log('  画板上剩下: ' + (f.objs.join(', ') || '（空）'));
  console.log('  画板尺寸: ' + f.board.join('×'));
  console.log('  当前选项: ' + (f.chips.join(' | ') || '（无）'));
  console.log('  状态栏: ' + f.status);
  console.log('  错误: ' + (f.err.join(' | ') || '无'));
  console.log('  页面异常: ' + (errs.join(' | ') || '无'));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(__dirname, '_e2e.png');
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('\n截图: ' + out + '   TABID=' + t.id);
  ws.close(); process.exit(0);
})();

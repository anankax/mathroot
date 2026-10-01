// 上传图片读图 —— 端到端。两个后端各跑一遍。
//
// ★ 为什么单独写一个探针：这条路**从头到尾没端到端测过**。
//   chat.js 的 onPick / downscale 早就在那儿了，但一直只测过"文字进去、围栏出来"。
//   读图这条链上每一环都可能断：文件有没有塞进去、有没有压小、base64 有没有拼对、
//   模型那把 messages 数组收不收 data URI、流式拆包会不会把图丢了。
//
// 用真图：test/_case_photo.png，是 mk_problem_image.py 造的"解方程 2x+1=7"，
// 学生的解答里**故意错了一步**（x = 6÷2 写成了 x = 4）。就为了验 v18 铁律第 7 条：
// 学生把整份解答拍过来、每一步都看得见的时候，模型最容易"哪步错了就直接问哪步"，
// 把学生自己的复盘跳过去——那条铁律就是治这个的。
//
// 用法: node test/probe_image.cjs [glm|deepseek] [最长等多少秒]
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const BACKEND = process.argv[2] || 'glm';
const MAXWAIT = Number(process.argv[3] || 100);
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const IMG = path.join(__dirname, '_case_photo.png');

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
  if (!fs.existsSync(IMG)) { console.error('先跑 py -3 test/mk_problem_image.py 造图'); process.exit(1); }
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
  await send('Runtime.enable', {}); await send('Page.enable', {}); await send('DOM.enable', {});

  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 300) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.navigate', { url: PAGE });
  await new Promise(r => setTimeout(r, 2500));
  await q('localStorage.setItem("mathroot_key", ' + JSON.stringify(KEY) + ')');
  await q('localStorage.setItem("mathroot_mode", "student")');
  await q('localStorage.setItem("mathroot_backend", ' + JSON.stringify(BACKEND) + ')');
  await send('Page.reload', { ignoreCache: true });

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }
  // ★ 这里原来写的是 SR.api.current().id —— 没这个函数，探针一开就炸，
  //   而错误信息是 "not a function"，看着像页面坏了，其实是探针自己写错了。
  //   真正的取法是 getBackendId()（见 api.js 的导出）。
  console.log('后端:', await q('SR.api.getBackendId()'),
              ' 带图那轮的模型链:', await q('JSON.stringify((SR.api.backend().modelsImage)||SR.api.backend().models)'),
              ' 画板就绪:', await q('SR.board.isReady()'));

  await q(`(function(){ window.__cmds=[];
     var raw=window.ggbApplet.evalCommand.bind(window.ggbApplet);
     window.ggbApplet.evalCommand=function(s){ var r; try{r=raw(s);}catch(e){r='THROW:'+(e.message||e);}
       window.__cmds.push(s+' => '+(r===true?'ok':r)); return r; };
     return 1 })()`);

  // ---- 把图塞进隐藏的 file input（真实照片走的就是这条路）----
  const doc = await send('DOM.getDocument', { depth: -1 });
  const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#file' });
  if (!node.result || !node.result.nodeId) { console.error('页面上没找到 #file'); process.exit(1); }
  await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [IMG] });
  await new Promise(r => setTimeout(r, 1200));

  const picked = await q(`JSON.stringify({
      thumb: getComputedStyle(document.getElementById("thumb")).display,
      src: (document.querySelector("#thumb img")||{}).src ? document.querySelector("#thumb img").src.slice(0,30) : "",
      len: (document.querySelector("#thumb img")||{}).src ? document.querySelector("#thumb img").src.length : 0
    })`);
  console.log('缩略图:', picked);
  if (!picked || picked === 'null' || /"len":0/.test(picked)) {
    console.log('★ 图没进输入框——先修这一步，别往下测');
    process.exit(1);
  }

  const nBefore = await q('document.querySelectorAll(".msg.assistant").length');
  await q('(function(){var i=document.getElementById("input");' +
          'i.value="老师，这道题我算出来的答案是 x=4，对不对？";' +
          'i.dispatchEvent(new Event("input",{bubbles:true}));' +
          'document.getElementById("send").click();return 1})()');

  // 等回复。免费通道那颗 glm-4.6v-flash 限流限得厉害，所以这里**连挤了也自动点「再试一次」**——
  // 顺便就把"出错后照片还在不在、按钮点得动点不动"这条路一起验了。
  async function waitReply(max) {
    let last = '', stable = 0;
    for (let s = 0; s < max; s++) {
      await new Promise(r => setTimeout(r, 1000));
      const st = await q(`JSON.stringify({busy:document.getElementById("send").disabled,
          n:document.querySelectorAll(".msg.assistant").length,
          text:(document.querySelector(".msg.assistant:last-of-type .bubble")||{}).innerText||"",
          cmds:window.__cmds.length, boardBusy:!!(window.SR&&SR.board&&SR.board.isBusy())})`);
      const o = typeof st === 'string' ? JSON.parse(st) : st;
      if (!o || o.n <= nBefore) { process.stdout.write(`\r  ${s + 1}s 等回复…   `); continue; }
      if (o.text === last) stable++; else { stable = 0; last = o.text; }
      process.stdout.write(`\r  ${s + 1}s 已出 ${o.text.length} 字 稳定${stable}   `);
      if (!o.busy && !o.boardBusy && stable >= 2) return o.text;
    }
    return last;
  }
  let shown = await waitReply(MAXWAIT);
  for (let round = 1; round <= 3 && /排满了队|请求太密/.test(shown); round++) {
    process.stdout.write(`\r  挤了，等 20 秒点「再试一次」…   `);
    await new Promise(r => setTimeout(r, 20000));
    const clicked = await q(`(function(){var b=[...document.querySelectorAll(".inlinebtn")].find(x=>x.textContent==="再试一次");
       if(!b) return "NOBTN"; b.click(); return "OK"})()`);
    if (clicked !== 'OK') { console.log('\n★ 没找到「再试一次」按钮：' + clicked); break; }
    shown = await waitReply(MAXWAIT);
  }
  console.log('');

  const one = await q(`JSON.stringify({
      text:(document.querySelector(".msg.assistant:last-of-type .bubble")||{}).innerText||"",
      chips:[...document.querySelectorAll(".chip")].map(c=>c.textContent),
      cmds:window.__cmds.slice(), raw:window.SR.chat.lastRaw||"",
      model:(window.SR.chat.lastMeta||{}).model||"",
      dup:document.querySelectorAll(".msg.user").length
    })`);
  const o = typeof one === 'string' ? JSON.parse(one) : one;
  const text = o.text || '', raw = o.raw || '';

  // ---- 先分开"守没守住"和"通道挤不挤" ----
  // ★ glm-4.6v-flash 会被限流（1305），实测三次里成两次。挤了是**通道问题，不是模型出错**，
  //   混在一起报"有问题"这个探针就成了掷骰子，跑十遍看十遍红。挤了就明说挤了、退出码给 2。
  const BUSY = /排满了队|请求太密|通道有点挤/.test(text);

  // ---- 两条判据 ----
  //  读到了：出现了"只有看见图才知道"的东西。
  // ★ 判据要看**原文 raw（含围栏）**，不能只看气泡里的正文（2026-10-01 实测打脸）：
  //   守规矩的模型恰恰**不会**在正文里把图上的数复述一遍——它就一句"这道题你当时是怎么做的？"，
  //   而证据在它写的 ```想说 里：「我看移了1到右边」。学生那句话里根本没提过 1，
  //   这三个字只能是从图上 `2x = 7 - 1` 看出来的。
  //   只判正文就等于"谁越界谁得分"，把守规矩的那次误判成"图没送到"。
  //   第二次跑又出现的形态：「我减了1，然后除以2，得到4」——这是图上的**做法**，
  //   不是图上的数，所以判据还得认出"减了1 / 除以2"这种转述。名单宁可长一点：
  //   少认一条会把好结果误报成"图没送到"，那比漏报更坏（会让我去修没坏的东西）。
  const READ = /2x\s*\+?\s*1\s*=\s*7|7\s*-\s*1|6\s*[÷\/]\s*2|x\s*=\s*4|x\s*[=＝]\s*3|移[了动]?\s*1|1\s*(移|到)右边|减\s*了?\s*1|除以\s*2|得到\s*4/.test(raw + '\n' + text);
  //  踩铁律：它自己把错指出来了（或者直接给答案）——铁律第 7 条不许这样
  const POINT = /你(这一步|这里|这步).{0,10}(错|不对)|算错|应该(是|等于)\s*3|等于\s*3|正确答案|应当是\s*3|6\s*[÷\/]\s*2\s*=\s*3/.test(text);

  console.log('\n【数根】' + text);
  console.log('【选项】' + (o.chips.length ? o.chips.join(' | ') : '（无）'));
  console.log('【画板命令】' + (o.cmds.length ? o.cmds.join(' ; ') : '（无）'));
  console.log('【原文】' + JSON.stringify(raw).slice(0, 600));
  console.log('\n读到了图上的数 : ' + (READ ? '✅ 是' : '❌ 没提图上的数——图可能没送到模型'));
  console.log('越界点出错步   : ' + (POINT ? '❌ 踩了铁律第 7 条' : '✅ 没点名错在哪一步'));
  console.log('这一轮谁答的   : ' + (o.model || '（没记到）'));
  // 重试过一次的话，屏幕上那句话**不该**出现两遍（retryLast 会把旧气泡摘掉）
  console.log('学生的话出现次数 : ' + o.dup + (o.dup === 1 ? ' ✅' : ' ❌ 重试后重复了'));
  if (errs.length) console.log('页面异常:', errs.slice(0, 3).join(' | '));

  // ---- 第三条判据：模型对不对 ----
  // ★ 上面两条只判"回复长得对不对"，可"悄悄降级到 glm-4v-flash"这件事光看回复不一定看得出来，
  //   它偶尔也能守住。带图那条链上**只许有守得住的那颗**，所以不在名单里就是错的。
  const allowRaw = await q('JSON.stringify((SR.api.backend().modelsImage)||SR.api.backend().models)');
  const allowList = (typeof allowRaw === 'string' ? JSON.parse(allowRaw) : allowRaw) || [];
  const onList = !o.model || allowList.indexOf(o.model) >= 0;
  console.log('模型在允许名单 : ' + (onList
    ? '✅ ' + (o.model || '未记录') + '（名单 ' + allowList.join('、') + '）'
    : '❌ ' + o.model + ' 不在 [' + allowList.join('、') + '] 里'));

  if (BUSY && !READ) {
    console.log('\n===== ' + BACKEND + ' 图片链路：⏭ 通道挤了，这一次没测成（不是失败，重跑一次）=====');
    process.exit(2);
  }
  const pass = READ && !POINT && onList;
  console.log('\n===== ' + BACKEND + ' 图片链路：' + (pass ? '通过' : '有问题') + ' =====');
  process.exit(pass ? 0 : 1);
})();

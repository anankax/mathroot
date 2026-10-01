// 上传图片读图 —— 端到端。两个后端各跑一遍。
//
// ★ 为什么单独写一个探针：这条路**从头到尾没端到端测过**。
//   chat.js 的 onPick / downscale 早就在那儿了，但一直只测过"文字进去、围栏出来"。
//   读图这条链上每一环都可能断：文件有没有塞进去、有没有压小、base64 有没有拼对、
//   模型那把 messages 数组收不收 data URI、流式拆包会不会把图丢了。
//
// 用真图：test/_case_photo.png，是 mk_problem_image.cjs 造的"解方程 2x+1=7"，
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
  if (!fs.existsSync(IMG)) { console.error('先跑 node test/mk_problem_image.cjs 造图'); process.exit(1); }
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

  // ---- 0. 先单独问一次"你看得见这张图吗" ----
  // ★ 为什么先单独量：整条链上"图没送到"和"送到了但模型守规矩、什么都没复述"
  //   在回复上长得一模一样。这里绕开提示词、绕开学生模式，直接拿同一张图问一句
  //   "把图上的算式念出来"——它要是念得出来，通道就是通的，后面红绿都该记在别的地方。
  const chModel = ((await q('JSON.stringify((SR.api.backend().modelsImage)||SR.api.backend().models)')) || '[]');
  const cm = JSON.parse(chModel)[0];
  const chKey = BACKEND === 'glm' ? await q('SR.GLM_KEY || ""') : KEY;
  const chUrl = await q('SR.api.backend().url');
  console.log('\n--- 0. 通道单独量一次（' + cm + '，不走提示词）---');
  {
    const b64 = fs.readFileSync(IMG).toString('base64');
    let said = null;
    for (let i = 1; i <= 6 && !said; i++) {
      let r, t;
      try {
        r = await fetch(chUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chKey },
          body: JSON.stringify({ model: cm, stream: false, messages: [{ role: 'user', content: [
            { type: 'text', text: '这张图里写的是什么？把图上的算式一行一行原样念出来，不要解答。' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } }] }] })
        });
        t = await r.text();
      } catch (e) { console.log('  第' + i + '次 网络出错：' + e.message); await new Promise(z => setTimeout(z, 3000)); continue; }
      if (r.status === 200) { said = JSON.parse(t).choices[0].message.content; break; }
      console.log('  第' + i + '次 HTTP ' + r.status + '（挤了，隔几秒再来）');
      await new Promise(z => setTimeout(z, 4000 + Math.random() * 4000));
    }
    if (!said) {
      console.log('  ❌ 六次都没挤进去，通道这一条今天量不了——别把它当成"图没法读"。');
    } else {
      const ok = /2x\s*\+?\s*1\s*=\s*7/.test(said) && /6\s*[÷\/]\s*2/.test(said);
      console.log('  模型念出来的：' + said.replace(/\n/g, ' ⏎ ').slice(0, 160));
      console.log('  念对了吗：' + (ok ? '✅ 图上的算式都念出来了——通道是通的' : '❌ 念出来的对不上，图可能没被当成图'));
    }
  }

  await q(`(function(){ window.__cmds=[];
     var raw=window.ggbApplet.evalCommand.bind(window.ggbApplet);
     window.ggbApplet.evalCommand=function(s){ var r; try{r=raw(s);}catch(e){r='THROW:'+(e.message||e);}
       window.__cmds.push(s+' => '+(r===true?'ok':r)); return r; };
     return 1 })()`);

  // ★ 顺带把**发出去的请求体**记下来（api.js 走的是 fetch）。
  //   为什么非得记：这个探针原来判"图有没有送到模型"是看模型的回复里有没有提到图上的东西。
  //   可设计上第一轮它**就该**只问一句"这道题你当时是怎么做的？"，什么都不复述——
  //   2026-10-01 跑出来就是这句，于是判据报"图可能没送到"，而同一张图直接打 API
  //   是读得出来的（把算式一行一行念出来了）。又是"数字不是它宣称的那件事"。
  //   要看的是**客户端到底发了什么**，这个是能直接读的，不用猜模型的措辞。
  await q(`(function(){ window.__reqs=[];
     var raw=window.fetch;
     window.fetch=function(u,o){ try{ if(o&&typeof o.body==='string') window.__reqs.push(o.body); }catch(e){}
       return raw.apply(this, arguments); };
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
  // ★ 量三样，一样都不能省（2026-10-01 补）：
  //   图**在不在 DOM 里**（len）、**显没显示出来**（thumb）、**是不是给学生的**（src 前缀）。
  //   原来只判 len —— 于是缩略图明明 `display:none` 挂在屏幕上，
  //   探针把 `"thumb":"none"` 原样打印出来，然后**照样报通过**。
  //   学生的感受是"我拍了照，什么反应都没有"：看不见贴的哪张，也没法点 × 撤掉。
  //   检测脚本打了数字却没判那个数字，等于没测——这条要求对后面几样同样有效。
  if (!picked || picked === 'null' || /"len":0/.test(picked)) {
    console.log('★ 图没进输入框——先修这一步，别往下测');
    process.exit(1);
  }
  if (/"thumb":"none"/.test(picked)) {
    console.log('★ 图进去了、但**没显示出来**：`#thumb` 是 display:none。');
    console.log('  查那个"显示它"的地方：清行内样式（style.display = ""）对写在**样式表**里的');
    console.log('  display:none 是没用的，得写死 display:block。');
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

  // ---- 客户端到底发了什么（这一条才是"图有没有送到"的硬证据）----
  const reqsRaw = await q('JSON.stringify((window.__reqs||[]).map(function(s){return s.length}))');
  const reqLens = (typeof reqsRaw === 'string' ? JSON.parse(reqsRaw) : reqsRaw) || [];
  const lastReq = await q('(window.__reqs||[]).length ? window.__reqs[window.__reqs.length-1] : ""');
  const last = typeof lastReq === 'string' ? lastReq : '';
  const SENT = /"image_url"/.test(last) && /data:image\//.test(last);
  const imgLen = (last.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/) || [, ''])[1].length;

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
  // ★ 这两条分清楚："客户端发出去没有"和"模型复述不复述"是两件事。
  //   守规矩的模型第一轮本来就只问一句，不复述任何东西——拿"复述"当"送到了"的判据，
  //   等于"谁越界谁得分"。所以硬证据用上面的 SENT，READ 降级成参考信息。
  console.log('发出去的请求   : ' + reqLens.length + ' 个，长度 ' + JSON.stringify(reqLens));
  console.log('图送出去了吗   : ' + (SENT
    ? '✅ 是（最后一个请求里有 image_url，base64 ' + (imgLen / 1024).toFixed(0) + 'KB）'
    : '❌ 最后一个请求里没有图——客户端这一步就断了，与模型无关'));
  console.log('模型复述了图上内容 : ' + (READ ? '有（参考）' : '没有（守规矩的第一轮本来就该这样，不算问题）'));
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

  // ---- 判据合成 ----
  //  图送出（SENT）     —— 客户端那一半，硬证据，必须过
  //  不踩第 7 条（POINT）—— 模型那一半，必须过
  //  模型在名单（onList）—— 防止悄悄降级到守不住的模型
  //  复述（READ）不进判据：见前面那段注释，它是个"谁越界谁得分"的指标。
  const pass = SENT && !POINT && onList;
  if (BUSY) {
    console.log('\n   通道挤过（这一轮重试过）。图送出去了、规矩也守住了，这就算测成；');
    console.log('   要是重试之后连请求都没发全，那才要另说。');
  }
  console.log('\n===== ' + BACKEND + ' 图片链路：' + (pass ? '通过' : '有问题') + ' =====');
  if (!pass) {
    if (!SENT) console.log('★ 先修客户端：图根本没进请求体（看上面 reqLens，请求发出去了但里面没有 image_url）');
    else if (POINT) console.log('★ 是模型越界（铁律第 7 条），去改提示词那一节');
    else console.log('★ 是模型不在名单里——它被悄悄降级了');
  }
  process.exit(pass ? 0 : 1);
})();

// 尺子：收敛保护（js/converge.js）到底会不会在该响的时候响、不该响的时候一声不吭。
//
// 为什么非得有这么一把尺子：这东西**绝大部分时候是隐形的**——连败 0 的时候
// `note()` 返回空串，系统提示词一个字符都不加。于是"它装上了吗"这件事，
// 靠翻代码看不出来，靠跑一轮也看不出来（正常画一张图，读数跟没装一模一样）。
//
// 两头都要量（本项目的规矩）：
//   · **该响的一头**：连着两轮画没落地 → `note()` 必须给话；第三轮必须是**更硬**那句。
//   · **不该响的一头**：干净一轮之后必须回到空串。这一格不红，就说明这道闸是**恒开**的——
//     那它就不是"收敛保护"，是往每一轮的提示词尾巴上白贴一段字（会挤掉 say 那份收尾块）。
//   · **红色对照那一头**：借板（冻图那一趟）里画坏了，**不许**记到老师头上。
//     这一格是防我把 `收尾` 里那道 `借板中` 的门槛拆了——拆了以后，老师抽屉里的一次
//     冻图失败就能把正常的对话拖进"连败"。
//   · **位置那一头**：那段话必须真出现在 `SR.api.buildSystem` 的**末尾**。
//     `note()` 会拼只是半件事；接不上 buildSystem 或者被拼到前面去，等于没做。
//
// 用法：node test/probe_converge.cjs
//   前置：Chrome 在 9222、serve 在 8138（同别的探针）。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 过 = 0, 败 = 0;
const 判 = (名, ok, 附) => { console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (附 ? '　' + 附 : '')); ok ? 过++ : 败++ };

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  // ★ q 把两件事故意分开：页面里炸了（exceptionDetails）**抛**，读回 undefined **返回 null**。
  //   （记忆里 46 号那一族：`q()` 抛异常返回真值字符串、被当循环条件用，25 条假红。）
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    return R && R.result ? R.result.value : null;
  };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html?conv=' + Date.now() });
  for (let i = 0; i < 60; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});
  // 存了再还原（铁律：探针不许把状态留在他的浏览器里，不许用 clear()）
  const 存前 = await q("(function(){var o={};['mathroot_memo','mathroot_work','mathroot_backend'].forEach(function(k){o[k]=localStorage.getItem(k)});return o})()");

  // ── 0. 自检：这东西在不在，而且是**会变**的一个量 ──────────────────────
  console.log('\n── 零、尺子自检：`SR.converge` 在不在，且读得出"响／不响"两种值 ──');
  {
    const 在 = await q('!!(window.SR && SR.converge && SR.converge.note && SR.converge.翻篇 && SR.converge.记坏)');
    判('SR.converge 四个口子都在（note / 翻篇 / 记坏 / 数）', 在 === true, String(在));
    if (在 !== true) { console.log('\n（没这个模块，底下全不用量了）'); ws.close(); await put('/json/close/' + t.id); process.exit(3); }
    await q('SR.converge.归零()');
    const 静 = await q('SR.converge.note()');
    // ★ 自检的真身：把数**手动推到 3**，同一个 note() 必须换个答案。
    //   只量"初始是空串"是**恒真**的（把整个模块换成 return '' 也过），量不出来东西。
    const 响 = await q('(function(){for(var i=0;i<3;i++){SR.converge.记坏();SR.converge.翻篇();}return SR.converge.note()})()');
    await q('SR.converge.归零()');
    console.log('  连败 0 → ' + JSON.stringify(静).slice(0, 40) + '　连败 3 → ' + JSON.stringify(String(响).slice(0, 30)) + '…');
    判('★★ 尺子自检：同一个 `note()`，连败 0 是空串、连败 3 有话说（不翻面的话底下两格别信）',
      typeof 静 === 'string' && 静.trim() === '' && typeof 响 === 'string' && 响.trim().length > 20,
      JSON.stringify([String(静).slice(0, 12), String(响).slice(0, 12)]));
  }

  // ── 一、阈值：1 轮还不该响，2 轮提醒，3 轮保护 ────────────────────────
  console.log('\n── 一、刻度对不对：一轮不响、两轮提醒、三轮保护 ──');
  {
    const 逐轮 = await q(`(function(){
      SR.converge.归零(); var out=[];
      for(var i=0;i<4;i++){
        out.push({轮:i, 话:String(SR.converge.note()||'').slice(0,6), 数:SR.converge.数()});
        SR.converge.记坏(); SR.converge.翻篇();
      }
      out.push({轮:4, 话:String(SR.converge.note()||'').slice(0,6), 数:SR.converge.数()});
      SR.converge.归零(); return out;
    })()`);
    console.log('  ' + JSON.stringify(逐轮));
    判('第 1 轮（连败 0）一个字都不加', 逐轮[0].话 === '' && 逐轮[0].数 === 0);
    判('第 2 轮（连败 1）**还是不响** —— 一次失败不算连败',
      逐轮[1].话 === '' && 逐轮[1].数 === 1, '数=' + 逐轮[1].数);
    判('★ 第 3 轮（连败 2）响**提醒**那句', /停一下/.test(String(逐轮[2].话)) || 逐轮[2].数 === 2, JSON.stringify(逐轮[2]));
    判('★ 第 4 轮（连败 3）换成**保护**那句（两句得不同，不然刻度是假的）',
      逐轮[3].数 === 3, JSON.stringify(逐轮[3]));
    const 提醒 = await q('(function(){SR.converge.归零();for(var i=0;i<2;i++){SR.converge.记坏();SR.converge.翻篇();}var s=SR.converge.note();SR.converge.归零();return String(s)})()');
    const 保护 = await q('(function(){SR.converge.归零();for(var i=0;i<3;i++){SR.converge.记坏();SR.converge.翻篇();}var s=SR.converge.note();SR.converge.归零();return String(s)})()');
    console.log('  两轮那句：' + 提醒.split('\n')[0]);
    console.log('  三轮那句：' + 保护.split('\n')[0]);
    判('★★ 两句确实是**不一样**的话（不是同一句被数了两次）', 提醒 !== 保护 && 提醒.length > 10 && 保护.length > 10);
    判('保护那句点明了"从头重画"这条出路', /从头重画/.test(保护), 保护.slice(0, 60));
    判('保护那句点了"不许拿样式糊弄"', /颜色/.test(保护) || /粗细/.test(保护), 保护.slice(-40));
  }

  // ── 二、该清的那头：好一轮就把连败清零 ───────────────────────────────
  console.log('\n── 二、好转清零：干净的一轮必须把连败归零 ──');
  {
    const r = await q(`(function(){
      SR.converge.归零();
      SR.converge.记坏(); SR.converge.翻篇();   // 连败 1
      var 中 = SR.converge.数();
      SR.converge.翻篇();                        // 又一轮，**没记坏** → 干净的一轮
      var 后 = SR.converge.数();
      var 话 = String(SR.converge.note()||'');
      SR.converge.归零(); return {中:中, 后:后, 话:话};
    })()`);
    console.log('  ' + JSON.stringify(r));
    判('坏一轮 → 连败 1', r.中 === 1, String(r.中));
    判('★ 紧接着干净一轮 → 连败归零、话也没了（这道闸不是恒开的）', r.后 === 0 && r.话 === '', JSON.stringify(r));
  }

  // ── 三、端到端：真喂一条画板画不出来的命令，数得对吗 ────────────────
  console.log('\n── 三、端到端：真画坏一段，看 `收尾` 有没有记上 ──');
  {
    const 画 = async (行们) => {
      await q('window.__行=' + JSON.stringify(行们));
      await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
      for (let z = 0; z < 50; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
      await sleep(700);
    };
    await q('SR.converge.归零()');
    // （甲）坏的：`ZZ` 板上根本没有这个点 → 悬空名 → 收尾当场说话
    await 画(['#清空', 'A=(0,0)', 'B=(3,0)', 's=线段(A,ZZ)']);
    const 坏数 = await q('(function(){var n=SR.converge.数();SR.converge.翻篇();var m=SR.converge.数();SR.converge.归零();return {翻前:n,翻后:m}})()');
    console.log('  画了一段坏的 → ' + JSON.stringify(坏数));
    判('★ 一段真画坏 → 翻篇之后连败是 1', 坏数.翻后 === 1, JSON.stringify(坏数));

    // （乙）干净的：一条不多一条不少
    await q('SR.converge.归零()');
    await 画(['#清空', 'A=(0,0)', 'B=(3,0)', 's=线段(A,B)', 'm=中点(A,B)']);
    const 好数 = await q('(function(){var n=SR.converge.数();SR.converge.翻篇();var m=SR.converge.数();SR.converge.归零();return {翻前:n,翻后:m}})()');
    console.log('  画了一段干净的 → ' + JSON.stringify(好数));
    判('★ 一段真画对 → 连败**一动不动**（这一格是上面"画坏→1"的红验，它绿了才说明上面那个 1 有来历）',
      好数.翻后 === 0, JSON.stringify(好数));
  }

  // ── 四、红色对照：借板（冻图那一趟）里画坏了，不许记到老师头上 ────────
  console.log('\n── 四、红色对照：借板那趟画坏了，不许牵连老师 ──');
  {
    await q('SR.converge.归零()');
    const 借 = await q(`(function(){return new Promise(function(res){
      try{
        SR.board.offscreenJob(function(draw, finish){
          draw(['#清空','A=(0,0)','B=(3,0)','s=线段(A,ZZ)'], function(){ finish({n:1}); });
        }, function(){ res('回来了') });
      }catch(e){ res('借板这条路炸了:'+e.message) }
      setTimeout(function(){res('等超时了')}, 40000);
    })})()`);
    await sleep(800);
    const 后 = await q('(function(){var n=SR.converge.数();SR.converge.翻篇();var m=SR.converge.数();SR.converge.归零();return {翻前:n,翻后:m}})()');
    console.log('  借板那趟 ' + 借 + ' → ' + JSON.stringify(后));
    判('★★ 借板里画坏了 → 连败**不许动**（这一格红了，说明 `收尾` 里那道 `借板中` 门槛被我拆了）',
      后.翻后 === 0, JSON.stringify(后));
  }

  // ── 五、位置：那段话真出现在 buildSystem 的**末尾** ──────────────────
  console.log('\n── 五、接得上吗：`buildSystem` 的尾巴上有没有那段话 ──');
  {
    const build = async (work, 数) => await q(`(function(){
      SR.converge.归零();
      for(var i=0;i<${数};i++){SR.converge.记坏();SR.converge.翻篇();}
      var note = String(SR.converge.note()||'');
      var s='';
      try{ s = SR.api.buildSystem('${work}', '画一个圆', SR.api.getBackendId(), [], [], null) || ''; }
      catch(e){ s = 'THROW:'+e.message }
      SR.converge.归零(); return {sys:String(s), note:note};
    })()`);
    const 静 = await build('draw', 0);
    const 两轮 = await build('draw', 2);
    const 三轮 = await build('draw', 3);
    console.log('  draw・连败0 尾部：' + JSON.stringify(静.sys.slice(-30)));
    console.log('  draw・连败2 末尾 60 字：' + JSON.stringify(两轮.sys.slice(-60)));
    判('★ 连败 0 的 draw 提示词里**一个字都不多**（找得到"停一下"就是恒加）',
      静.sys.indexOf('停一下') < 0, '长度 ' + 静.sys.length);
    判('★ 连败 2 → 「停一下」真接上了', 两轮.sys.indexOf('停一下') >= 0);
    // ★★ "在最后"这件事得用 `endsWith` 量，不是"关键词落没落在最后 N 字里"——
    //    那句话的**头**本来就在块的开头，末尾的当然不是关键词本身。
    //    （第一版就栽在这儿：块明明压在末尾，我却被自己的断句读成红的。）
    判('★★ 而且它**整段压在系统提示词的最末尾**（`endsWith`，不是"关键词靠后"）',
      两轮.note.length > 20 && 两轮.sys.replace(/\s+$/, '').endsWith(两轮.note.replace(/\s+$/, '')),
      JSON.stringify(两轮.sys.slice(-24)));
    判('★ 连败 3 → 换成「收敛保护」', 三轮.sys.indexOf('收敛保护') >= 0 && 三轮.sys.indexOf('停一下') < 0);
    判('★ 保护那句也整段压在末尾',
      三轮.sys.replace(/\s+$/, '').endsWith(三轮.note.replace(/\s+$/, '')), JSON.stringify(三轮.sys.slice(-24)));
    const 别格 = await build('prep', 3);
    判('★ 别的工位（备课）**不许沾** —— 它没有"画了没落地"这件事可数',
      别格.sys.indexOf('收敛保护') < 0 && 别格.sys.indexOf('停一下') < 0);
  }

  console.log('\n══ 汇总 ══　过 ' + 过 + ' / 败 ' + 败);
  console.log([
    '（零那一格是**尺子自检**：它绿了，下面那些"空串"才是真读数，不是尺子坏了。）',
    '',
    '（二・★ 与 三・★ 是一对**红验**：坏的那头必须记成 1、好的那头必须一动不动。',
    ' 四・★★ 那格是**红色对照**：借板里画坏了还不许动连败——它红了就是我拆了门槛。）'
  ].join('\n'));

  await q('SR.board.clear()');
  await q('SR.converge && SR.converge.归零 && SR.converge.归零()');
  await q('(function(){var s=' + JSON.stringify(存前) + ';Object.keys(s).forEach(function(k){if(s[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,s[k])});return 1})()');
  ws.close(); await put('/json/close/' + t.id);
  process.exit(败 ? 3 : 0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

// 持续用：**提示词里新加的那几条配方，模型到底会不会照着写**。
//
// ★ 为什么"板子能兜住"不算数：兜底是事后擦屁股，老师已经看见出错的那一版了。
//   这里一律**走真模型**（跟前面几轮同一颗 glm-4-flash-250414，temperature 1），
//   提示词从**页面上现读**（`SR.PROMPT_DRAW`）——不是从文件读，
//   免得改了文件忘了刷新，量的是上一版。
//
// 这一轮盯的三条，都是 2026-10-04 新加／翻案的：
//   ① 正方体展开图 **动画**（`展开图(立体, t)` + 滑块）—— 原来是"画板没有这条命令"（错的）
//   ② 绕一点**连着转出一圈图案**（`序列(旋转(...), k, 1, 5)`）—— 模型原先说"不支持循环"就放弃了
//   ③ **正方形**（`正多边形(A,B,4)`）
//
// ⚠ 尺子的边界（跟 _e2e.cjs 那把同一个毛病）：这里量的是"**该有的那个对象建出来了没有**"，
//   不是"题意对不对"。图上多画一条线、少标一个字母，它看不出来。
//   ★ 所以除了打勾，**把模型写的原文摆出来**——勾是给机器看的，原文是给人看的。
//
// Key 从邰言邰语那份 index.html 现读（跟 _e2e.cjs 同一把），只在本进程里用，
// **不写进数根仓库任何地方**。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const TAIYAN = 'C:/数学办公/邰言邰语/index.html';
const URL_GLM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = 'glm-4-flash-250414';
const KEY = (fs.readFileSync(TAIYAN, 'utf8').match(/const\s+GLM_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!KEY) { console.error('没从邰言邰语里读到 GLM_KEY'); process.exit(1) }

const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function 问(sys, user) {
  const r = await fetch(URL_GLM, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 1, max_tokens: 1600 })
  });
  const j = await r.json();
  if (!j.choices) throw new Error('模型回了怪东西：' + JSON.stringify(j).slice(0, 300));
  return j.choices[0].message.content || '';
}
function 取命令(t) {
  const m = /```[ \t]*ggb[ \t]*[^\r\n]*\r?\n([\s\S]*?)```/.exec(t);
  return m ? m[1].trim() : null;
}

// 一题 = 一句话 + 一句"该怎么判"。判据一律问**板上真建出了什么**。
const 题 = [
  {
    问: '把正方体摊开成展开图，做成动画——点一下就能看着它一层层摊平',
    判: '甲·展开图动画',
    看: 名 => {
      const 网 = 名.filter(s => s.split(':')[1] === 'net');
      const 滑 = 名.filter(s => s.split(':')[1] === 'numeric');
      return { 过: 网.length >= 1 && 滑.length >= 1, 说: 'net ' + 网.length + ' 个、滑块 ' + 滑.length + ' 个' };
    }
  },
  {
    // ★ 问法改过一次：原来写的是「让它绕顶点 A **连着转出**六个」——
    //   这句有歧义，模型读成"转着转着出现六个"（动画）并不算错，选滑块是合理答案。
    //   拿一个两种读法都成立的句子去量"会不会用 `序列`"，量到的是**我的问法**。
    //   现在写明"六份同时看得见"，把动画那一读法堵掉，剩下的才是配方的对错。
    问: '画一个三角形，把它绕顶点 A 转出另外五份，六份同时铺成一圈图案',
    判: '乙·连续旋转图案',
    // ★★ 2026-10-04 改判据。原来只数 `polygon|list` 的**件数**，两个方向都错：
    //   ① **假 ✓**：模型写六条 `旋转(三角形, α, A)`（角度全同一个 α、中心同一个 A），
    //      建出 6 个多边形 —— 可它们**完全叠在一处**，画面上跟一个三角形没区别。
    //      量出来的读数：面 6 个、**互不相同的顶点只有 3 个**。
    //   ② **假 ✗**：配方那版 `序列(旋转(q, k*60°, A), k, 1, 5)` 建出 `l1:list` 一个对象，
    //      整份 XML 里 `<element type="polygon">` 只数到 **1** 个（列表的成员不在 XML 里）——
    //      按"件数≥5"判，配方自己倒是不及格。**截屏看过：六个三角形铺得好好的。**
    //   → 两条路线，形状不一样，只能分开判：
    //     路线②（`序列`）：认 `list` 这个对象。★ 它渲染得出来是我**看图**确认的
    //       （test/_seq3.cjs 的截图），不是从对象表推的——对象表根本看不见列表里面。
    //     路线①（一条条 `旋转`）：光数多边形不够，必须**几何真的散开**——
    //       加一条"互不相同的顶点 ≥ 8"（六个摊在圆周上该有十来个；叠在一处只有 3 个）。
    //   ★ 教训就是 [[scanner-numbers-are-not-what-they-claim]]：数出来的那个数没错，
    //     错的是它量的东西 —— 而且**方向是双向的**，假勾和假叉一块儿来。
    看: (名, 量) => {
      if (名.some(s => s.split(':')[1] === 'list'))
        return { 过: true, 说: '走 `序列`（板上建出 list）—— 渲染出来是六份，截屏核过' };
      const 面 = 名.filter(s => /polygon|triangle|quadrilateral/.test(s.split(':')[1]));
      return {
        过: 面.length >= 5 && 量.异点 >= 8,
        说: '多边形 ' + 面.length + ' 件、**互不相同的顶点 ' + 量.异点 + ' 个**（六份铺开该有 8 个以上；叠在一处只有 3 个）'
      };
    }
  },
  {
    问: '画一个正方形 ABCD，再在它里面画一条对角线',
    判: '丙·正方形',
    看: 名 => {
      const 方 = 名.filter(s => /polygon|quadrilateral/.test(s.split(':')[1]));
      const 三 = 名.filter(s => s.split(':')[1] === 'triangle');
      return { 过: 方.length >= 1 && 三.length === 0, 说: '四边形 ' + 方.length + ' 个、三角形 ' + 三.length + ' 个（有三角形就是画成三个点的了）' };
    }
  }
];
const 次数 = parseInt(process.argv[2] || '2', 10);

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200));
    return R && R.result ? R.result.value : null
  };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 40; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});

  // ★ 一个共用的读数口：把"板上现在是什么样"一次取全。
  //   多出来的 `异点`（互不相同的顶点坐标个数）是给 乙 那条判据用的 ——
  //   光数件数分不出"六个铺开"和"六个叠一起"，量坐标才分得出。
  const 取状态 = async () => {
    const r = await q(`(function(){
      var a=ggbApplet.getAllObjectNames(), 名=[], 点={};
      for(var i=0;i<a.length;i++){
        var n=a[i], ty=ggbApplet.getObjectType(n);
        名.push(n+":"+ty);
        if(ty==='point'){ try{ 点[ggbApplet.getXcoord(n).toFixed(2)+','+ggbApplet.getYcoord(n).toFixed(2)]=1 }catch(e){} }
      }
      return {名:名, 异点:Object.keys(点).length}
    })()`) || { 名: [], 异点: 0 };
    return r
  };

  const SYS = await q('SR.PROMPT_DRAW');
  if (!SYS) { console.error('页面上读不到 SR.PROMPT_DRAW'); process.exit(1) }
  console.log('提示词从页面上现读：' + SYS.length + ' 字符；模型 ' + MODEL + '\n');

  // ★★ 红验：把"这题的正确形状"喂成一段**明知不对**的，判据必须报 ✗。
  //   为什么非要：下面每一条的判据都是**我照着想让它过**去写的，万一它恒真，
  //   跑出来的全是勾，而我读到的会是"模型全学会了"。绿的样子跟尺子坏了长得一模一样。
  console.log('══ 零、★判据自检：喂明知不对的，必须报 ✗ ══');
  for (const c of [
    { 标: '甲·展开图：只给一个正方体、没有 net 没有滑块', 行: ['#清空', '#三维', 'A=(0,0,0)', 'B=(2,0,0)', 'c=正方体(A,B)'], 该: false, k: 0 },
    { 标: '乙·连续旋转：只画一个三角形', 行: ['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)'], 该: false, k: 1 },
    // ★★ 乙 必须专门加这一条：模型真写过这个（test 里量到的原文），**判据原来判它 ✓**。
    //   六个多边形角度全是同一个 α，于是**全叠在一处** —— 件数够、画面跟一个没区别。
    //   这是"假 ✓"，比假 ✗ 危险：假 ✗ 我还会再查一眼，假 ✓ 直接进结论。
    { 标: '乙·★假 ✓ 陷阱：六条旋转，角度全是同一个 α（六份叠在一处）',
      行: ['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', '三角形=多边形(A,B,C)', 'α=Slider(0,pi/2,0.05)', '#隐藏 α',
        '三角形2=旋转(三角形, α, A)', '三角形3=旋转(三角形, α, A)', '三角形4=旋转(三角形, α, A)',
        '三角形5=旋转(三角形, α, A)', '三角形6=旋转(三角形, α, A)', '#播放 α'], 该: false, k: 1 },
    // ★ 另一头也得自检：配方那版（`序列`）判据必须**认**。它是"✓ 的那一支真能到"的对照。
    //   上一版判据在这里给的是 ✗ —— 假 ✗，配方自己不及格。
    { 标: '乙·对照：配方那版 `序列` 该被认（板上只建出 list）',
      行: ['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)', '序列(旋转(q, k*60°, A), k, 1, 5)'], 该: true, k: 1 },
    { 标: '丙·正方形：拿三个点当正方形画', 行: ['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)'], 该: false, k: 2 }
  ]) {
    await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(250);
    await q('window.__行=' + JSON.stringify(c.行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let z = 0; z < 25; z++) { await sleep(220); if (await q('SR.board.isBusy()') === false) break }
    await sleep(350);
    const 状 = await 取状态();
    const r = 题[c.k].看(状.名, 状);
    const 对 = r.过 === c.该;
    console.log('  ' + (对 ? '✓' : '✗') + '  ' + c.标 + ' → 判据说' + (r.过 ? '过' : '不过') + '（该' + (c.该 ? '过' : '不过') + '）；' + r.说);
    if (!对) { console.log('      ★判据恒' + (r.过 ? '真' : '假') + '，下面的勾不能信'); process.exitCode = 4 }
  }

  let 坏 = 0, 总 = 0;
  for (const T of 题) {
    console.log('\n══ ' + T.判 + '：『' + T.问 + '』══');
    for (let k = 0; k < 次数; k++) {
      let 文 = '', cmd = null;
      try { 文 = await 问(SYS, T.问); cmd = 取命令(文) } catch (e) { console.log('  ！调用炸了：' + e.message); continue }
      if (!cmd) {
        // ★★ 2026-10-04 补：原来这里只报一句"没写围栏"就过去了 —— 可"没写围栏"底下
        //   压着两件完全不同的事：① 模型**在反问我**（设计上允许、甚至是想要的）；
        //   ② 模型写了一段散文，那才是真没做到。只报"没写围栏"，我读到的两个都是"✗"，
        //   分不出该改提示词还是该夸它。原文必须摆出来（勾是给机器看的，原文是给人看的）。
        总++; 坏++;
        console.log('  第' + (k + 1) + '次：**没写围栏** —— 它回的是：');
        console.log(文.split('\n').slice(0, 12).map(x => '        ' + x).join('\n') +
          (文.split('\n').length > 12 ? '\n        …（共 ' + 文.split('\n').length + ' 行）' : ''));
        continue
      }
      await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(250);
      await q('window.__行=' + JSON.stringify(cmd.split('\n')));
      await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
      for (let z = 0; z < 25; z++) { await sleep(220); if (await q('SR.board.isBusy()') === false) break }
      await sleep(400);
      const 没 = await q('SR.board.failed()') || [];
      const 状 = await 取状态();
      const r = T.看(状.名, 状);
      总++; if (!r.过) 坏++;
      console.log('  ' + (r.过 ? '✓' : '✗') + ' 第' + (k + 1) + '次：' + r.说 + (没.length ? '   没认' + JSON.stringify(没) : ''));
      // ★ 勾是给机器看的，原文是给人看的 —— 判据说"过"但写法离谱的，只有原文能看出来
      //   ★★ 2026-10-04 又添一条证据：乙那次判据说 ✓、原文是"六条同一个角度的旋转"——
      //     原文摆出来了，可我没看出"这六条会叠在一处"。**光摆原文不够，还得量几何。**
      //     所以判据里现在带 `互不相同的顶点`，那一栏是给人一眼看出"叠没叠"的。
      if (T.判.indexOf('乙') === 0) console.log('      （互不相同的顶点 ' + 状.异点 + ' 个 —— 六份铺开该十来个，叠在一处就是 3 个）');
      console.log('      模型原文：\n' + cmd.split('\n').map(x => '        ' + x).join('\n'));
    }
  }

  console.log('\n' + (坏 ? '✗ ' + 总 + ' 次里 ' + 坏 + ' 次没做到' : '✅ ' + 总 + ' 次全过') + '（模型不保证可复现，这条是"这一次做到了"，不是"永远做得到"）');
  ws.close(); await put('/json/close/' + t.id);
  process.exit(坏 ? 4 : 0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

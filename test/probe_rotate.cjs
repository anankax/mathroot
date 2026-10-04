// 持续用：**只盯「转出一圈图案」这一题**，跑很多轮 —— 取个像样的通过率。
//
// ★★ 为什么要单独一把：`probe_newrecipes` 一次只跑 4 轮，而这道题的通过率
//   大概在两三成 —— n=4 的时候，"2/4"和"0/4"**同一个提示词也都会出现**。
//   我拿两个 n=4 的读数比过一轮"改前改后"，差点把噪声当成疗效
//   （[[scanner-numbers-are-not-what-they-claim]]：数字没错，错的是它量的东西 ——
//     四次的读数量不了两三成的通过率）。要看疗效就得把 n 堆上去。
//
// 判据跟 `probe_newrecipes` 里 乙 那条**是同一把**（原样搬过来，没改口径）：
//   ① 走 `序列` → 板上建出 `list`，认；★ 它渲染得出来是**看图**确认的（test/_seq3.cjs）
//   ② 一条条 `旋转` → 光数件数不够，必须**几何真的散开**（互不相同的顶点 ≥ 8）
//   ★ 为什么不能只数件数：模型真写过六条 `旋转(三角形, α, A)`，件数够、
//     可六份**全叠在一处**，画面上跟一个三角形没区别 —— 那是"假 ✓"。
//
// 除了打勾，**把命中的是多条路线里的哪一条**也数出来 ——
// 只看"过没过"，分不出"它学会了 `序列`"还是"它蒙对了一次固定角度"。
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
// ★★ 取围栏**走产品自己那个解析器**（SR.render.parseFences），不要在这儿再抄一份正则。
//   2026-10-04 的实情：这里原先抄的那把 `/```[ \t]*ggb…/` 是**严格版**，而产品的解析器
//   早就会捞**开头三个反引号掉了的**那种围栏（js/render.js 那段 `行[i].trim() !== 'ggb'`）。
//   模型写得最多的恰恰是这种（光秃秃一行 `ggb` 开头、末尾一个 ```）——
//   于是探针把这 3~4 成的轮次判成"没写围栏"，**而产品那边是画得出来的**。
//   量出来的东西比产品更差 = 尺子的问题，不是产品的问题（同族：参数写错不报错，只静默换了个量法）。
//   ⚠ 所以这一格现在要**过页面**，不能再是同步函数。
let 页问 = async () => null;   // 页面就绪后由主流程装上（见下面 q 定义处）
const 取命令 = async (文) => {
  const s = await 页问("(function(){try{var r=SR.render.parseFences(" + JSON.stringify(文) + ",{stripAssign:false});"
    + "return r.ggb.length?r.ggb[0]:''}catch(e){return 'ERR:'+e}})()");
  if (s && String(s).indexOf('ERR:') === 0) throw new Error('产品解析器炸了：' + s);
  return s ? String(s).trim() : null;
};
const 次数 = parseInt(process.argv[2] || '12', 10);

// ★★ 两条臂，**同一把尺子量两个方向** —— 因为我要动的是"①②谁在前"，
//   那是**换位**：治好了 ② 完全可能顺手把 ① 弄坏。只量 ② 就等着踩这个坑。
//   （同族教训：判别动作要挑会变的那个量 —— 只盯一头，另一头坏了看不见。）
const 臂们 = [
  { 标: '②·转出五份铺一圈',
    问句: '画一个三角形，把它绕顶点 A 转出另外五份，六份同时铺成一圈图案',
    判: (状) => {
      if (状.名.some(s => s.split(':')[1] === 'list'))
        return { 过: true, 说: '走 `序列`（板上建出 list）' };
      const 面 = 状.名.filter(s => /polygon|triangle|quadrilateral/.test(s.split(':')[1]));
      return { 过: 面.length >= 5 && 状.异点 >= 8,
        说: '多边形 ' + 面.length + ' 件、异点 ' + 状.异点 + ' 个' };
    } },

  // ★ ① 的判据是**量后果**，不是量形状：滑块在不在不是重点。
  //   产品原先就出过"滑块写得漂漂亮亮、图形根本不动"这种，数对象数分不出来。
  //   所以这里把滑块**读到三个值各量一次顶点**，看它是不是真的跟着走。
  { 标: '①·拖着看它转',
    问句: '画一个三角形，让它绕着顶点 A 转起来，我想拖着滑块看它转到哪儿',
    判: (状) => {
      if (!状.滑块) return { 过: false, 说: '板上没有滑块' };
      const 转折 = 状.顶点集抽样.filter((s, i, a) => i > 0 && s !== a[0]).length;
      const 面 = 状.名.filter(s => /polygon|triangle/.test(s.split(':')[1])).length;
      return { 过: 转折 > 0 && 面 >= 2,
        说: '滑块「' + 状.滑块 + '」拖到 ' + 状.顶点集抽样.length + ' 个值、有 ' + 转折 +
            ' 次顶点真的动了；多边形 ' + 面 + ' 件' };
    } },
];

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200));
    return R && R.result ? R.result.value : null
  };
  页问 = q;   // ★ 把取命令接到页面上（它要调产品自己的解析器）
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 40; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});

  // ★★ 自检：这把新尺子**在坏产品上会不会红**。取命令 现在借产品的解析器，
  //   那就得先证实「借来的东西真的在这、真的捞得出光秃秃那种围栏、真的不瞎捞」。
  {
    const 探 = await q(`(function(){
      var out={};
      out.有解析器 = !!(SR.render && typeof SR.render.parseFences === 'function');
      if(!out.有解析器) return out;
      function 捞(t){ try{ var r=SR.render.parseFences(t,{stripAssign:false}); return r.ggb.length? r.ggb[0] : null }catch(e){ return 'ERR:'+e } }
      // ① 正常的
      out.正常 = 捞('好的。\\n\`\`\`ggb\\nA=(0,0)\\nB=(2,0)\\n\`\`\`\\n看看');
      // ② 开头那个围栏**光秃秃一行 ggb、没有三反引号**（模型最常写坏的样子）
      out.掉反引号 = 捞('这就画。\\nggb\\n#清空\\nA=(0,0)\\nB=(2,0)\\n\`\`\`\\n');
      // ③ 全文一个反引号都没有（这才是**真没画**）—— 这一格必须捞不出来
      out.真没有 = 捞('这道题我们先看已知条件……（纯讲解，没有画板指令）');
      // ④ 判词分得开吗：②该有、③该没有
      out.分得开 = (!!out.掉反引号) && (!out.真没有);
      return out
    })()`);
    console.log('尺子自检（借产品解析器）：解析器在=' + 探.有解析器 + '；正常围栏=' + (探.正常 ? '捞到 ✓' : '★捞不到') + '；掉反引号的=' + (探.掉反引号 ? '捞到 ✓' : '★捞不到') + '；真没写的=' + (探.真没有 ? '★竟捞到了（假绿）' : '捞不到 ✓'));
    if (!探.有解析器) { console.error('★ 页面上没有 SR.render.parseFences —— 取命令 这把尺子量不了，先修尺子'); process.exit(3) }
    if (!探.正常) { console.error('★ 连正常围栏都捞不到 —— 不是模型的问题，先修尺子'); process.exit(3) }
    if (!探.掉反引号) { console.error('★ 捞不回光秃秃那种围栏 —— 这正是要量的一格，尺子不认就没读数'); process.exit(3) }
    if (探.真没有) { console.error('★ 纯讲解也被当成有围栏 —— 假绿，读数全废'); process.exit(3) }
    console.log('   （② 那几轮「取不到围栏」以后会被算成**真读数**；下面看通过率怎么变）\n');
  }

  const 取状态 = async () => {
    const 基 = await q(`(function(){
      var a=ggbApplet.getAllObjectNames(), 名=[], 点={}, 滑=null;
      for(var i=0;i<a.length;i++){
        var n=a[i], ty=ggbApplet.getObjectType(n);
        名.push(n+":"+ty);
        if(ty==='point'){ try{ 点[ggbApplet.getXcoord(n).toFixed(2)+','+ggbApplet.getYcoord(n).toFixed(2)]=1 }catch(e){} }
        // ★★ 找滑块。这里踩过两次，两次都是"参数写错不报错、只静默换了个量法"：
        //   ① 原来只认 numeric —— 而 Slider(60°, 360°, 60°) 带度数，建出来类型是
        //      angle，于是角度型滑块一律探测不到（① 会把好产品判成"板上没有滑块"）。
        //   ② 改成"numeric 或 angle"也不行：α=60° 这种常量同样是独立的 angle，
        //      可它压根没得拖 —— 判成滑块就是假绿。
        //   ★ 分得开的那一格在 XML 里（实测，test/_angtype.cjs）：
        //       Slider(60°,360°,60°) → <slider min="60°" max="360°" …
        //       Slider(0,2*pi,0.05)  → <slider min="0" max="(2 * pi)" …
        //       α=60°（常量）        → <slider absoluteScreenLocation=…  ← 没有 min
        //       α=60（常量）         → 连 slider 都没有
        //     isMoveable 两种都是 true，分不开，别拿它判。
        
        if((ty==='numeric'||ty==='angle') && !滑){
          try{
            // ⚠ 必须写 \\s（两个反斜杠）：这段代码是塞在**模板字符串**里送到页面上的，
            //   单个 \s 会被模板串吃成 s，页面收到 /sliders+min="/ —— 永远匹配不到，
            //   而且**不报错**，只是静默地把"有滑块"全判成"没有滑块"。
            //   （同族：参数写错不报错，只静默换了个量法。）
            if(ggbApplet.isIndependent(n) && /slider\\s+min="/.test(ggbApplet.getXML(n))) 滑=n;
          }catch(e){}
        }
      }
      return {名:名, 异点:Object.keys(点).length, 滑块:滑}
    })()`) || { 名: [], 异点: 0, 滑块: null };

    // ★ 把滑块推到几个值，每处量一次**全板点的坐标**。
    //   0 和 π 是最要紧的一对：整圈转回来图形会一模一样，只有半圈才看得出差别。
    //   ⚠ 为什么量"全板点"而不是"多边形顶点"：`getPolygonPoints` 这个 API **未必存在**，
    //     落到兜底就得量 `getCommandString` —— 而旋转多边形的命令串**拖滑块根本不变**，
    //     那样每条 ① 都会被误判成"没动"（假红，把好产品判死）。
    //     点的坐标一定会变（旋转出来的 A'、B'、C' 就是随滑块走的点），而且 API 一定在。
    基.顶点集抽样 = [];
    if (基.滑块) {
      for (const v of [0, 1.0, Math.PI]) {
        await q('try{ggbApplet.setValue(' + JSON.stringify(基.滑块) + ',' + v + ')}catch(e){}');
        await sleep(260);
        const s = await q(`(function(){
          var a=ggbApplet.getAllObjectNames(), o=[];
          for(var i=0;i<a.length;i++){
            if(ggbApplet.getObjectType(a[i])==='point'){
              try{ o.push(ggbApplet.getXcoord(a[i]).toFixed(2)+','+ggbApplet.getYcoord(a[i]).toFixed(2)) }catch(e){}
            }
          }
          return o.sort().join(' | ')
        })()`);
        基.顶点集抽样.push(String(s).slice(0, 400));
      }
    }
    return 基;
  };

  // ★★ 取 system 要**走产品自己那一条路**（SR.api.buildSystem），不要图省事读 SR.PROMPT_DRAW。
  //   2026-10-04 发现：draw 工位 config 上挂着 `say: true`，api.js:496 会往提示词**后面**
  //   再拼一整段「想说」收尾块（js/prompt-say.js）。探针原先只拿 PROMPT_DRAW，
  //   等于**漏掉了 system 的最后一段**——而这段偏偏是最容易被模型当回事的那种
  //   （[[prompt-must-do-at-tail]]：写在最末尾的东西命中率最高）。
  //   量出来的东西是不是"产品真发出去的那份"？不是的话，读数再漂亮也不算数。
  //   ⚠ 顺带把档位也核对一遍：draw 工位 textHead=true → **不带图那一轮**走
  //     modelsText[0] = glm-4-flash-250414，正是这里用的 MODEL；对得上。
  const 造SYS = async (问句) => {
    const s = await q("(function(){try{return SR.api.buildSystem('draw'," + JSON.stringify(问句) + ",'glm',[],[])}catch(e){return 'ERR:'+e}})()");
    return s;
  };
  const SYS0 = await 造SYS(臂们[0].问句);
  if (!SYS0 || SYS0.indexOf('ERR:') === 0) { console.error('页面上拿不到 buildSystem 的 system：' + SYS0); process.exit(1) }
  const 没带想说 = SYS0.indexOf('```想说') < 0;
  console.log('system ' + SYS0.length + ' 字符（走 SR.api.buildSystem）；' + MODEL + '；每臂 ' + 次数 + ' 轮');
  console.log('　含「想说」收尾块：' + (没带想说 ? '★没有 —— 那这份 system 跟产品发出去的不一样，下面的数一律别信' : '有 ✓') + '\n');
  if (没带想说) process.exit(1);

  // ─────────────────────────────────────────────────────────────
  // ★★ 红验：**先证明这两把尺子在坏产品上是红的**，再拿它们量模型。
  //   库里那条规矩："这把尺子在坏产品上红过"是一次性记忆，所以每次跑都重做一遍。
  //   ① 的坏样子：滑块写得规规矩矩，图形**根本不跟它走**（数滑块/数对象都分不出来）。
  //   ② 的坏样子：六条旋转角度写成了**同一个 α**，件数够、六份全叠在一起。
  //   ——两个都是产品真出过的形态，不是编的。
  // ─────────────────────────────────────────────────────────────
  const 画并判 = async (行, 判) => {
    await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(220);
    await q('window.__行=' + JSON.stringify(行));
    await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
    for (let z = 0; z < 25; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
    await sleep(320);
    return { 状: await 取状态(), 判: null };
  };
  console.log('══ 红验 + 阳性对照（这一节全绿，上面那两把尺子的打勾才有意义）══');
  {
    // ★ 红：滑块在、图形不跟它走
    const 坏一 = ['#清空', 'A=(0,0)', 'B=(3,0)', 'C=(1,2)', '多边形(A,B,C)', 'α=Slider(0,6.28,0.05)', '#隐藏 α'];
    const { 状 } = await 画并判(坏一);
    const r = 臂们[1].判(状);
    const 好 = r.过 === false;
    console.log('  ' + (好 ? '✓' : '✗') + '  ①·红：滑块在、图形不跟它走 → 该判"没动"，实得：' + r.说);
    if (!好) { console.log('  ✗✗ ① 的判据在坏产品上是绿的，这次跑的数字全不算数'); ws.close(); process.exit(3) }
  }
  {
    // ★★ 阳性对照：真会转的配方必须读成绿。
    //   只做红验是"恒红也过关"的写法 —— 两把方向各扎一次，尺子才算立得住。
    const 好一 = ['#清空', 'A=(0,0)', 'B=(3,0)', 'C=(1,2)', '多边形(A,B,C)',
      'α=Slider(0,6.28,0.05)', '#隐藏 α', '旋转(多边形(A,B,C), α, A)', '#播放 α'];
    const { 状 } = await 画并判(好一);
    const r = 臂们[1].判(状);
    console.log('  ' + (r.过 ? '✓' : '✗') + '  ①·阳性对照：真的会转 → 该判"动了"，实得：' + r.说);
    if (!r.过) { console.log('  ✗✗ ① 的判据把好产品判死了（恒红）'); ws.close(); process.exit(3) }
  }
  {
    // ★★ 新堵的那个洞，两个方向各扎一次。
    //   红：`α=60°`（常量）+ 旋转 —— 图**确实在动**（setValue 会改它），
    //       可它不是滑块，老师没得拖。判成绿就是假绿。
    const 常量一 = ['#清空', 'A=(0,0)', 'B=(3,0)', 'C=(1,2)', '多边形(A,B,C)',
      'α=60°', '旋转(多边形(A,B,C), α, A)'];
    const { 状 } = await 画并判(常量一);
    const r = 臂们[1].判(状);
    const 好 = r.过 === false;
    console.log('  ' + (好 ? '✓' : '✗') + '  ①·红（新洞）：`α=60°` 是常量、没得拖 → 该判✗，实得：' + r.说);
    if (!好) { console.log('  ✗✗ 常量被当成滑块了'); ws.close(); process.exit(3) }
  }
  {
    //   绿：**角度型**滑块（带度数那种）是真滑块，必须认出来 —— 这是原来那个洞的正向。
    const 度滑一 = ['#清空', 'A=(0,0)', 'B=(3,0)', 'C=(1,2)', '多边形(A,B,C)',
      'α=Slider(0°, 360°, 5°)', '#隐藏 α', '旋转(多边形(A,B,C), α, A)'];
    const { 状 } = await 画并判(度滑一);
    const r = 臂们[1].判(状);
    console.log('  ' + (r.过 ? '✓' : '✗') + '  ①·阳性对照（新洞）：度数滑块是真滑块 → 该判✓，实得：' + r.说);
    if (!r.过) { console.log('  ✗✗ 角度型滑块没被认出来（就是原来那个洞）'); ws.close(); process.exit(3) }
  }
  {
    const 坏二 = ['#清空', 'A=(0,0)', 'B=(2,0)', 'C=(1,1.7)', 'q=多边形(A,B,C)',
      'α=60°', 'r1=旋转(q, α, A)', 'r2=旋转(q, α, A)', 'r3=旋转(q, α, A)',
      'r4=旋转(q, α, A)', 'r5=旋转(q, α, A)'];
    const { 状 } = await 画并判(坏二);
    const r = 臂们[0].判(状);
    const 好 = r.过 === false;
    console.log('  ' + (好 ? '✓' : '✗') + '  ②·六条旋转同一个角、全叠一处 → 该判"没散开"，实得：' + r.说);
    if (!好) { console.log('  ✗✗ ② 的判据在坏产品上是绿的，这次跑的数字全不算数'); ws.close(); process.exit(3) }
  }
  console.log('');

  const 汇总 = [];
  for (const 臂 of 臂们) {
    // ★ 每条臂的 system **各造一份**：buildSystem 的第二个参数是"这一轮老师说的话"，
    //   拿别人的问句去造，造出来的就不是这一臂真发出去的那份（同族：参数写错不报错，只静默换了个量法）。
    臂.SYS = await 造SYS(臂.问句);
    console.log('══ ' + 臂.标 + ' ══');
    let 过 = 0, 没围栏 = 0;
    for (let k = 0; k < 次数; k++) {
      let 文 = '', cmd = null;
      try { 文 = await 问(臂.SYS, 臂.问句); cmd = await 取命令(文) } catch (e) { console.log('  ！第' + (k + 1) + '轮调用炸了：' + e.message); continue }
      // ★ 现在这一格的判词**等于产品的判词**：`取命令` 走的就是产品自己的 SR.render.parseFences。
      //   走到这儿还捞不出来，就是老师那边真的什么都不画（不再是"我的尺子比产品严"）。
      //   原文头照旧摆着 —— 判词印的从来不是原因。
      if (!cmd) { 没围栏++; console.log('  ·· 第' + (k + 1) + '轮：产品也捞不出围栏（长 ' + 文.length + '，文里有三反引号 ' + (文.indexOf('```') >= 0 ? '有' : '★没有') + '）\n      头三行：' + 文.split('\n').slice(0, 3).join(' ⏎ ').slice(0, 200)); continue }
      await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(220);
      await q('window.__行=' + JSON.stringify(cmd.split('\n')));
      await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
      for (let z = 0; z < 25; z++) { await sleep(200); if (await q('SR.board.isBusy()') === false) break }
      await sleep(320);
      const 状 = await 取状态();
      const r = 臂.判(状);
      if (r.过) 过++;
      console.log('  ' + (r.过 ? '✓' : '✗') + ' 第' + (k + 1) + '轮 ' + r.说);
      if (!r.过) console.log('      原文：' + cmd.replace(/\n/g, ' | ').slice(0, 220));
    }
    汇总.push({ 标: 臂.标, 过: 过, 次数: 次数, 没围栏: 没围栏 });
    console.log('  → ' + 过 + '/' + 次数 + '（' + Math.round(过 / 次数 * 100) + '%）' +
      (没围栏 ? '，另有 ' + 没围栏 + ' 轮没写围栏' : '') + '\n');
  }

  console.log('══ 汇总 ══');
  for (const s of 汇总) console.log('  ' + s.标 + '：' + s.过 + '/' + s.次数 + '（' + Math.round(s.过 / s.次数 * 100) + '%）');
  console.log('  ★ n=' + 次数 + ' 也只是**这一次**的读数；模型不保证可复现，别拿单次结果当疗效。');
  ws.close(); await put('/json/close/' + t.id);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });

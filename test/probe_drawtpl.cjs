// 量「作图模板」（js/drawtpl.js）——**骨架到底画得准不准**。
//
// ★★ 为什么不量"骨架里那几行字长得对不对"，非要上真板子：
//   骨架的卖点是**几何是对的**（"角度量出来是整数度""等边真的等边"）。
//   而"字长得对"跟"几何对"是两件事——`B=(1.5,2.598)` 这行字一个字母没错，
//   可它到底是不是 60° 要 GeoGebra 说了算。**能算的人不算，能让引擎算就让引擎算。**
//   老账：**尺子坏了跟产品坏了长得一模一样**——我拿"字面看着对"当判据，
//   就是拿一把跟被测对象没关系的尺子。
//
// ★★ 每条断言都要是**会变的那一个量**（老账：判别动作要挑会变的那个量）。
//   所以每条下面都跟着一个 `反例`：同一把尺子，喂一份**故意画错的**骨架，
//   它必须报红。没红过的尺子不算数。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 值) => { if (真) { 绿++; console.log('  OK  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } else { 红++; console.log('  XX  ' + 名 + (值 !== undefined ? '   -> ' + JSON.stringify(值) : '')) } };
const 近 = (a, b, 容) => Math.abs(a - b) <= (容 === undefined ? 0.01 : 容);
const 距 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300));
    return R && R.result ? R.result.value : null };
  const 等真 = async (式, 秒, 步) => { const n = Math.round(秒 * 1000 / (步 || 400)); for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 400); await sleep(步 || 400) } return -1 };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=drawtpl&t=' + Date.now() });
  const 起 = await 等真('!!(window.SR && SR.board && SR.board.isReady() === true && !!SR.DRAWT)', 150, 500);
  console.log('等画板就绪 ' + 起 + 'ms');
  if (起 < 0) { console.log('★ 画板没起来（或 SR.DRAWT 没装上），本次一个读数都不作数'); ws.close(); process.exit(3) }
  await sleep(2500);

  // ---- 板上账本：对象名 → 类型 / 显示值 / 命令原文 / 坐标 ----
  const 账 = `(function(){ var a = SR.board.applet(); var o = {};
    (a.getAllObjectNames()||[]).forEach(function(n){
      var ty=''; try{ty=a.getObjectType(n)}catch(e){}
      var v=''; try{v=a.getValueString(n)}catch(e){}
      var cs=''; try{cs=a.getCommandString(n)}catch(e){}
      o[n] = { ty:ty, v:v, cs:cs };
      if (ty === 'point') { try{ o[n].x = a.getXcoord(n); o[n].y = a.getYcoord(n) }catch(e){} }
      if (ty === 'segment' || ty === 'line' || ty === 'ray') {
        try{ o[n].len = a.getValue(n) }catch(e){}
        try{ o[n].p1 = a.getXcoord(a.getCommandString(n).replace(/^[^(]*\\(/,'').replace(/\\).*$/,'').split(',')[0].trim()) }catch(e){}
      }
    });
    return o })()`;

  // 把一份骨架喂给板子，等它停下来，再把账本读回来
  const 画 = async (骨架, 等) => {
    const r = await q('SR.board.run(' + JSON.stringify(骨架) + ')');
    await sleep(等 === undefined ? 2600 : 等);
    return { 返回: r, 账: await q(账) };
  };
  const 取点 = (账本, 名) => {
    for (var k in 账本) {
      var o = 账本[k];
      if (o.ty === 'point' && (k === 名 || String(o.v).indexOf(名 + ' =') === 0)) return { x: o.x, y: o.y };
    }
    return null;
  };
  const 找角 = 账本 => { for (var k in 账本) if (String(账本[k].ty).indexOf('angle') === 0) return 账本[k]; return null };
  const 角的度数 = 角 => { var m = /(-?[\d.]+)\s*°/.exec(String(角 && 角.v || '')); return m ? parseFloat(m[1]) : NaN };
  // ★★ 找对象按**类型**找，而且一个对象允许有**好几个可能的名字**。
  //   为什么：GeoGebra 给同一个东西起的类型名**不是我以为的那个**——
  //   实测（test/_types.cjs）：
  //     `多边形(A,B,C)` 三顶点的，类型是 **`triangle`** 不是 `polygon`
  //     `圆(O,3)`             类型是 **`circle`**   不是 `conic`
  //   我第一版按 `polygon`／`conic` 找，两条都报"没建出来"——**红的样子跟产品坏了
  //   长得一模一样**，而产品其实是好的，坏的是我脑子里那张类型名表。
  const 找型 = (账本, ...型) => {
    for (var k in 账本) if (型.indexOf(账本[k].ty) >= 0) return 账本[k];
    return null;
  };
  // 拿它的**对象名**（Distance 那种命令要拿名字当参数）
  const 找型名 = (账本, ...型) => {
    for (var k in 账本) if (型.indexOf(账本[k].ty) >= 0) return k;
    return null;
  };

  // ---- 量一个点到一条线的距离（拿 GeoGebra 自己的 Distance 算，不是我算的）----
  // ★★ 这把尺子有两条死规矩，两条都是踩过坑才立的：
  //   ① 辅助对象的**名字必须字母打头**（`kaxM` / `kaxD`）。下划线开头 GeoGebra 直接拒收，
  //      evalCommand 返回 false —— 而**失败之后 getValue 返回的是 0**，
  //      跟"量出来正好是 0"长得一模一样（实测 test/_dist.cjs）。
  //   ② **先认 evalCommand 的返回值，再去读数**。返回 false 就当"没量到"，
  //      绝不把那个 0 当成一个读数。老账：**"返回 false"被当成"没生效"**
  //      —— 那一次是八条 false 其实八条都生效了；**这一次是反过来**，
  //      false 真的是没建出来。所以：两件事都得当真，只能看返回值，不能看那个数。
  //   ③ 坐标**写成字面量，别先建一个点再引用那个名字**。实测（test/_dist2.cjs）：
  //        `Distance(kaxM, g)`  → **false**（kaxM 是上一条命令刚建出来的点）
  //        `Distance[(0,0), g]` → true，读出 2
  //        `Distance((0,0),(3,4))` → true，读出 5
  //      症状看着像"命令名写错"，其实是 `evalCommand` **不是同步登记的**——
  //      上一条刚建的对象下一条还看不见。字面坐标不依赖前面那条，所以一次就成。
  //      ★ 这才是真正的教训：同一句返回 false，**原因可以完全不是我猜的那个**。
  const 量距离 = async (P, 线名) => {
    const r = await q(`(function(){ var a = SR.board.applet();
      try {
        var r2 = a.evalCommand('kaxD=Distance[(${P.x},${P.y}), ${线名}]');
        if (r2 !== true) return { 建出来了:false, 为什么:'evalCommand 返回 ' + r2 };
        var v = a.getValue('kaxD');
        if (typeof v !== 'number' || !isFinite(v)) return { 建出来了:false, 为什么:'读出来不是数：' + JSON.stringify(v) };
        return { 建出来了:true, 值:v };
      } catch(e) { return { 建出来了:false, 为什么:'THROW:' + e } } })()`);
    return r || { 建出来了: false, 为什么: '页面没回话' };
  };

  console.log('\n════════ A. 模板给的骨架，板子上量出来对不对 ════════');

  // ── ① 角：默认 60°。★ 这一条同时是**红验**：模板要是没算角度、随手挑坐标，
  //    量出来就是 59.x / 61.x（模型自己挑那几遍就是 60.02）。今天要的是 60.00。
  {
    const r = await q(`JSON.stringify(SR.DRAWT.拼('角', {}))`);
    const o = JSON.parse(r);
    console.log('\n① 角 ∠AOB（默认 60°）  话：' + o.话);
    console.log('   骨架：' + o.骨架.join('  |  '));
    const B = await 画(o.骨架);
    const 角 = 找角(B.账), 度 = 角的度数(角);
    判('① 建出了角对象', !!角, 角 && 角.v);
    判('① 量出来正好 60°（±0.05）', 近(度, 60, 0.05), 度);
    判('① 命令里顶点在中间（A,O,B）', /\(A,\s*O,\s*B\)/.test(String(角 && 角.cs)), 角 && 角.cs);
    // 反例：把 B 摆到 100° 上去，同一把尺子必须读数变了 —— 不然上面那条是恒绿
    const 反 = await 画(['#清空', 'O=(0,0)', 'A=(3,0)', 'B=(' + (3 * Math.cos(100 * Math.PI / 180)).toFixed(3) + ',' + (3 * Math.sin(100 * Math.PI / 180)).toFixed(3) + ')', '射线(O,A)', '射线(O,B)', '角(A,O,B)']);
    判('① [反例] 把 B 挪到 100°，尺子读出 100（不是 60）', 近(角的度数(找角(反.账)), 100, 0.05), 角的度数(找角(反.账)));
  }

  // ── ② 三角形：等边。三条边必须一样长。
  {
    const o = JSON.parse(await q(`JSON.stringify(SR.DRAWT.拼('三角形', { 型:'等边' }))`));
    console.log('\n② 等边三角形  话：' + o.话);
    console.log('   骨架：' + o.骨架.join('  |  '));
    const B = await 画(o.骨架);
    const A = 取点(B.账, 'A'), Bp = 取点(B.账, 'B'), C = 取点(B.账, 'C');
    判('② 三个顶点都建出来了', !!A && !!Bp && !!C, A && Bp && C);
    if (A && Bp && C) {
      const 三边 = [距(A, Bp), 距(Bp, C), 距(C, A)];
      判('② 三边一样长（±0.01）', 近(三边[0], 三边[1]) && 近(三边[1], 三边[2]),
        { AB: +三边[0].toFixed(3), BC: +三边[1].toFixed(3), CA: +三边[2].toFixed(3) });
      判('② 多边形建出来了（三顶点的多边形，GeoGebra 报的类型是 triangle）', !!找型(B.账, 'polygon', 'triangle', 'quadrilateral'));
    }
    // 反例：把 C 拉高一点，尺子必须报"不一样长"
    const 反 = await 画(['#清空', 'A=(0,0)', 'B=(4,0)', 'C=(2,3.6)', '多边形(A,B,C)']);
    const 反点 = [取点(反.账, 'A'), 取点(反.账, 'B'), 取点(反.账, 'C')];
    if (反点[0] && 反点[1] && 反点[2]) {
      const 反边 = [距(反点[0], 反点[1]), 距(反点[1], 反点[2])];
      判('② [反例] 把 C 抬高一截，尺子读出两边不等', !近(反边[0], 反边[1]),
        { AB: +反边[0].toFixed(3), BC: +反边[1].toFixed(3) });
    }
  }

  // ── ③ 三角形：直角。直角必须真的在 A 上（90.00°），不是"看着像直角"。
  {
    const o = JSON.parse(await q(`JSON.stringify(SR.DRAWT.拼('三角形', { 型:'直角' }))`));
    console.log('\n③ 直角三角形  话：' + o.话);
    const B = await 画(o.骨架.concat(['角(B,A,C)']));
    const 度 = 角的度数(找角(B.账));
    判('③ 直角在 A 上，量出来 90°（±0.05）', 近(度, 90, 0.05), 度);
  }

  // ── ④ 四边形：平行四边形。对边必须一样长（AB=DC、BC=AD）。
  {
    const o = JSON.parse(await q(`JSON.stringify(SR.DRAWT.拼('四边形', { 型:'平行四边形' }))`));
    console.log('\n④ 平行四边形  话：' + o.话);
    const B = await 画(o.骨架);
    const P = ['A', 'B', 'C', 'D'].map(n => 取点(B.账, n));
    判('④ 四个顶点都建出来了', P.every(x => !!x));
    if (P.every(x => !!x)) {
      判('④ 对边等长：AB=DC（±0.01）', 近(距(P[0], P[1]), 距(P[3], P[2])),
        { AB: +距(P[0], P[1]).toFixed(3), DC: +距(P[3], P[2]).toFixed(3) });
      判('④ 对边等长：BC=AD（±0.01）', 近(距(P[1], P[2]), 距(P[0], P[3])),
        { BC: +距(P[1], P[2]).toFixed(3), AD: +距(P[0], P[3]).toFixed(3) });
    }
    // 反例：把 D 挪歪，AB=DC 必须不成立
    const 反 = await 画(['#清空', 'A=(0,0)', 'B=(4,0)', 'C=(5,2.2)', 'D=(1.6,2.2)', '多边形(A,B,C,D)']);
    const Q = ['A', 'B', 'C', 'D'].map(n => 取点(反.账, n));
    if (Q.every(x => !!x)) 判('④ [反例] 把 D 挪歪，尺子读出 AB≠DC', !近(距(Q[0], Q[1]), 距(Q[3], Q[2])),
      { AB: +距(Q[0], Q[1]).toFixed(3), DC: +距(Q[3], Q[2]).toFixed(3) });
  }

  // ── ⑤ 圆 + 半径：半径长度必须**正好**等于填的那个数。
  {
    const o = JSON.parse(await q(`JSON.stringify(SR.DRAWT.拼('圆', { r:'3', 加:'半径' }))`));
    console.log('\n⑤ 圆（半径 3）+ 半径  话：' + o.话);
    const B = await 画(o.骨架);
    const 圆 = 找型(B.账, 'circle', 'conic');
    判('⑤ 圆建出来了', !!圆, 圆 && 圆.v);
    const 段 = 找型(B.账, 'segment');
    判('⑤ 半径线段建出来了', !!段);
    if (段) 判('⑤ 半径长度正好 3.000（±0.01）', 近(段.len, 3), 段.len);
    // 反例：半径填 3 却只画了 2.5 的线段 —— 尺子必须报红
    const 反 = await 画(['#清空', 'O=(0,0)', '圆(O,3)', 'A=(2.5,0)', '线段(O,A)']);
    判('⑤ [反例] 画成 2.5 的半径，尺子读出 2.5（不是 3）', 近(找型(反.账, 'segment').len, 2.5),
     找型(反.账, 'segment').len);
  }

  // ── ⑥ 线段 + 垂直平分线：得真建出一条 line，而且中点到它的距离必须是 0。
  //    ★ 判据就是"垂直平分线"的定义本身，不是我猜的某个写法：
  //      把 A、B 的中点现造出来，量它到这条线的距离 —— 0 才算过中点。
  //      （为什么不量斜率乘积 = -1：那是**推出来的**判据，多绕一手，还怕它退化成竖直。）
  {
    const o = JSON.parse(await q(`JSON.stringify(SR.DRAWT.拼('线段', { 画:'加上垂直平分线' }))`));
    console.log('\n⑥ 线段 + 垂直平分线  话：' + o.话);
    const B = await 画(o.骨架);
    const A = 取点(B.账, 'A'), Bp = 取点(B.账, 'B');
    // ★ 线的**对象名**也得拿回来：Distance 要拿它当参数
    const 线名 = await q(`(function(){ var a = SR.board.applet();
      var 名 = null; (a.getAllObjectNames()||[]).forEach(function(n){ var ty=''; try{ty=a.getObjectType(n)}catch(e){}
        if (ty === 'line' && 名 === null) 名 = n }); return 名 })()`);
    判('⑥ 线段建出来了', !!找型(B.账, 'segment'));
    判('⑥ 垂直平分线建出来了（line）', !!线名, 线名);
    // ★ 引擎把 PerpendicularBisector 显示成 **`中垂线`**（实测 test/_types.cjs）。
    //   骨架里写的是课本那个正式名 `垂直平分线` —— **它是对的**，板子也认
    //   （CMD_MAP 里两个都收）。是我头一版拿"引擎该显示成正式名"当期望，量错了。
    判('⑥ 骨架写的正式名「垂直平分线」被板子认了、建出一条 line',
      /垂直平分线|中垂线|PerpendicularBisector/.test(String(找型(B.账, 'line') && 找型(B.账, 'line').cs)),
      找型(B.账, 'line') && 找型(B.账, 'line').cs);
    if (A && Bp && 线名) {
      const mx = (A.x + Bp.x) / 2, my = (A.y + Bp.y) / 2;
      const m = await 量距离({ x: mx, y: my }, 线名);
      判('⑥ 中点到这条线的距离是 0（±0.001）—— 也就是它真过中点',
        m.建出来了 && 近(m.值, 0, 0.001), m);
    }
    // 反例：**不给**垂直平分线，只给中点 + 一条随便的线 —— 上面那把尺子必须报出一个非 0 的数。
    //   ★★ 这一条不是装饰。它当场抓出过一个**假绿**：我头一版把辅助对象起名叫 `__d1`
    //      （下划线开头，GeoGebra **不认这种名字**），evalCommand 返回 false、什么都没建，
    //      可 `getValue('__d1')` 照样返回 **0** —— 跟"距离真的是 0"长得**一模一样**。
    //      于是主用例那条"距离是 0"是**假的绿**（量的是空气），是这条反例把它揪出来的。
    //      老账：绿的样子也跟尺子坏了长得一样。**每把新尺子都先得在坏东西上红过一次。**
    const 反 = await 画(['#清空', 'A=(-2,-0.8)', 'B=(2,0.8)', '线段(A,B)', '中点(A,B)', '直线((0,2),(4,2))']);
    const 反线名 = await q(`(function(){ var a = SR.board.applet();
      var 名 = null; (a.getAllObjectNames()||[]).forEach(function(n){ var ty=''; try{ty=a.getObjectType(n)}catch(e){}
        if (ty === 'line' && 名 === null) 名 = n }); return 名 })()`);
    const 反点 = [取点(反.账, 'A'), 取点(反.账, 'B')];
    if (反线名 && 反点[0] && 反点[1]) {
      const m = await 量距离({ x: (反点[0].x + 反点[1].x) / 2, y: (反点[0].y + 反点[1].y) / 2 }, 反线名);
      判('⑥ [反例] 换一条不过中点的线，尺子读出非 0（比如 2）',
        m.建出来了 && !近(m.值, 0, 0.001), m);
    }
  }

  // ── ⑦ 数轴：点必须落在填的那个坐标上（不是"看着在数轴上"）。
  {
    const o = JSON.parse(await q(`JSON.stringify(SR.DRAWT.拼('数轴', { 点:'-2, 3' }))`));
    console.log('\n⑦ 数轴  话：' + o.话);
    console.log('   骨架：' + o.骨架.join('  |  '));
    const B = await 画(o.骨架);
    const A = 取点(B.账, 'A'), Bp = 取点(B.账, 'B');
    判('⑦ 点 A 落在 -2 上（±0.01）', A && 近(A.x, -2), A && A.x);
    判('⑦ 点 B 落在 3 上（±0.01）', Bp && 近(Bp.x, 3), Bp && Bp.x);
    判('⑦ 两个点都贴在第 0 行（y=0）', A && Bp && 近(A.y, 0) && 近(Bp.y, 0), A && Bp && [A.y, Bp.y]);
    // ★ 数轴那一档视角**就该是 2d**（数轴本来就要靠坐标轴画出来；`#清空` 那一步先关轴，
    //   紧接着的 `数轴` 再把它打开）。我头一版拿"blank"当期望，量错了——**尺子的事**。
    判('⑦ 数轴把坐标轴打开了（视角 2d）', (await q('SR.board.viewDim()')) === '2d', await q('SR.board.viewDim()'));
    // 反例：点写成 5 而不是 3 —— 尺子必须读 5
    const 反 = await 画(['#清空', '数轴', 'A=(-2,0)', 'B=(5,0)']);
    判('⑦ [反例] 点写成 5 时，尺子读出 5（不是 3）', 近(取点(反.账, 'B').x, 5), 取点(反.账, 'B').x);
  }

  console.log('\n════════ B. 每一块模板都能拼出东西（没有空骨架 / 没有抛异常）════════');
  {
    const 全 = JSON.parse(await q(`(function(){ var o = [];
      SR.DRAWT.组.forEach(function(g){ g.项.forEach(function(t){
        var r = null; try { r = SR.DRAWT.拼(t.id, {}) } catch(e) { r = { 炸: String(e) } }
        o.push({ id:t.id, 名:t.名, 话: r && r.话, 行数: r && r.骨架 ? r.骨架.length : -1, 炸: r && r.炸 })
      }) });
      return JSON.stringify(o) })()`));
    全.forEach(x => 判('B·' + x.名 + '（' + x.id + '）拼得出、不炸、骨架非空',
      !x.炸 && x.行数 > 1 && !!x.话, { 行数: x.行数, 话: x.话, 炸: x.炸 }));
    console.log('\n   一共 ' + 全.length + ' 块模板：' + 全.map(x => x.id).join('、'));
  }

  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r && r.result && r.result.data) { fs.mkdirSync(path.join('test', '_shots'), { recursive: true });
    fs.writeFileSync(path.join('test', '_shots', '_模板.png'), Buffer.from(r.result.data, 'base64')) }
  console.log('\n──────── 绿 ' + 绿 + ' / 红 ' + 红 + ' ────────');
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });

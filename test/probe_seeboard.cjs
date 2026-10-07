// ④ 看板子：该不该把画板截图交给模型 —— 真页面、真 shoot、真 buildSystem。
//
// 要证的三件事，缺一条这场读数就作废：
//   · **门真在拦** —— 不过门的那句（「画个三角形」）必须**不带**图。
//     少了这条，第 1 趟的"带了"没有鉴别力：分不清是门挑的，还是"每轮都带"。
//   · **强制真起作用** —— 「随便聊聊」这种不过门的话，喊了 `看板:true` 就该带。
//     少了这条，分不清"自修那趟必看"是真做了，还是那句刚好也过门。
//   · **空板一律不看** —— 板清空之后，**连强制的都不带**。
//     少了这条，不知道"空板不看"这条硬闸在不在，也不知道 ④ 会不会给模型发一张白板。
//
// ⚠ 读数从 `SR.api.lastParts` 拿（只在内存、不进 DOM、不外发；不含图的字节，只有长度）。
//   `SR.flow` 那边只记 system，量不到 messages —— 这是上一轮踩过的。
// ⚠ 这四趟真发给模型（免费档）。429 了也不影响读数：`lastParts` 在发请求**之前**就写了。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222;

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));

(async () => {
  const 列表 = await 取('/json/list');
  const 候选 = 列表.filter(t => t.type === 'page' && /^(https?:\/\/)?(localhost|127\.0\.0\.1):8138/.test(String(t.url)));
  console.log('本地 8138 开着 ' + 候选.length + ' 个标签页，逐个核身份…');
  if (!候选.length) { console.error('★ 没有 8138 的标签页。'); process.exit(2); }

  let 会话 = null, 目标 = null;
  for (const t of 候选) {
    const w = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise(r => w.on('open', r));
    let id = 0; const 等 = {};
    w.on('message', m => { let o; try { o = JSON.parse(m); } catch (e) { return; } if (o.id && 等[o.id]) 等[o.id](o); });
    const 发 = (method, params) => new Promise(r => { const i = ++id; 等[i] = r; w.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async e => {
      const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails;
        throw new Error('页面里这一句炸了：' + ((d.exception && (d.exception.description || d.exception.value)) || d.text) + '\n  表达式：' + String(e).slice(0, 200));
      }
      return r.result && r.result.result && r.result.result.value;
    };
    const 有 = await ev('typeof SR !== "undefined" && !!SR.WORKS');
    if (有 === true) { 会话 = { 发, ev, w }; 目标 = t; break; }
    w.close();
  }
  if (!会话) { console.error('★ 这几个标签页里没有一个真跑着数根。'); process.exit(2); }
  const { 发, ev, w } = 会话;
  console.log('核上了：' + 目标.url);

  await 发('Network.enable');
  await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.enable');
  await 发('Page.reload', { ignoreCache: true });

  // ★★ 硬重载之后**等页面真开完机**再读第一个数（2026-10-06 夜补）。
  //   原来这里是"睡 4 秒就读 `SR.board.…`" —— 页面上 `SR` 还没定义，
  //   于是整把尺子当场炸成 `ReferenceError: SR is not defined`（退出码 2、连汇总都没打）。
  //   那个"炸"跟"产品坏了"长得完全一样：谁看见"SR is not defined"都得先怀疑 js 没装上。
  //   实际上它只是**读早了** —— 4 秒对这台机器上的一次冷启动不够。
  //   这是 [[scanner-numbers-are-not-what-they-claim]] 里那条「按秒表读状态会把
  //   『还没开机』读成『报错了』」；同族已在 probe_carrycard.cjs 上栽过一回，
  //   那一把补了同样的闸，这一把当时漏了。
  //   判据挑的是**装完之后才会成立**的那几样：SR 的四面口 + 六个工位按钮 + 输入框。
  const 开机了吗 = '(function(){ try { return !!(typeof SR !== "undefined" && SR.board && SR.api && SR.WORKS'
    + ' && typeof SR.board.该看板 === "function"'
    + ' && document.querySelectorAll("#works .workbtn").length >= 6'
    + ' && !!document.getElementById("input")); } catch(e){ return "THROW:"+e.message } })()';
  let 开完了 = false;
  for (let i = 0; i < 40; i++) {                          // 最多 20 秒
    let v = null;
    try { v = await ev(开机了吗); } catch (e) { v = 'THROW'; }   // 还没定义时这句自己会抛，吞掉接着等
    if (v === true) { 开完了 = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1200));            // 再给接线后那几笔落一落
  console.log('等开机：' + (开完了 ? '开完了' : '★ 20 秒没等到（后面读数要打折看）'));

  // ── 0. 先证明装的是这一版 ────────────────────────────────────────
  const 指纹 = await ev('JSON.stringify({ 有该看板: typeof (SR.board && SR.board.该看板), 有seeNow: typeof (SR.board && SR.board.seeNow), 开关: !!(SR.WORKS.draw && SR.WORKS.draw.boardSee), 别的工位: !!((SR.WORKS.prep||{}).boardSee || (SR.WORKS.vary||{}).boardSee) })');
  console.log('页面指纹：' + 指纹);
  const F = JSON.parse(指纹);
  判('0甲 board.js 装上了 `该看板` / `seeNow`', F.有该看板 === 'function' && F.有seeNow === 'function');
  判('0乙 作图工位的 boardSee 开着', F.开关 === true);
  判('0丙 别的工位没开这一格（挂上去是恒假的）', F.别的工位 === false);

  // 清板 / 画板的小工具（都问板子自己，不数 DOM）
  const 清板 = () => ev('(function(){ if (typeof ggbApplet === "undefined" || !ggbApplet || typeof ggbApplet.getAllObjectNames !== "function") return "没板子"; var n = ggbApplet.getAllObjectNames(); for (var i=0;i<n.length;i++){ try{ ggbApplet.deleteObject(n[i]); }catch(e){} } return ggbApplet.getAllObjectNames().length; })()');
  const 画上去 = 行 => ev('(function(){ return new Promise(function(res){ try { SR.board.draw(' + JSON.stringify(行) + ', function(ok){ res(ok); }); } catch(e){ res("炸:"+e.message); } }); })()');
  const 数板 = () => ev('(function(){ var n = (SR.board && SR.board.objects) ? SR.board.objects() : null; return n ? n.length : -1; })()');
  const 量门 = 句 => ev('JSON.stringify(' + JSON.stringify(句) + '.map(function(t){ return [t, SR.board.该看板(t, false)]; }))');
  const 睡 = ms => new Promise(r => setTimeout(r, ms));

  // ★★ 清板要**清到读出来真是 0**，最多试 5 回。为什么不能清一次就走：
  //   产品自己会把画板状态**跨刷新存下来**（test/_peek_shot.cjs 量过：硬重载之后
  //   板上会自己回来 ["t","O","c"]），那份存档是**异步**落回来的——它可能落在
  //   我们清完之后，于是"空板"那一节量到的是 2 件别人的东西，1甲/1乙 一起红。
  //   这是产品**已有**的行为，不是哪一轮改出来的；但探针必须等它落定，
  //   否则量的是半路的状态（[[scanner-numbers-are-not-what-they-claim]] 那一家）。
  const 清干净 = async () => {
    for (let i = 0; i < 5; i++) {
      await 清板();
      await 睡(1200);
      const n = await 数板();
      if (n === 0) return 0;
      console.log('   （第 ' + (i + 1) + ' 回没清干净：板上还有 ' + n + ' 件 —— 那份跨刷新的存档又落回来了，再来一次）');
    }
    return await 数板();
  };

  // ★★ 等到画板**自己说 ready** 再往下量。硬重载后那几秒 `SR.board.objects()` 回的是
  //   `null`（"问不出来"），不是 `[]`（"就是空的"）—— 把前者当"空板"贴标签，读数就骗人了。
  //   这条是我自己在第一版里踩的：打印「板上对象数 = -1」却写成"[空板]"。
  //   判断也不看表，问产品自己的 `isReady()`（`inject` 600ms 就注进来一个空壳，
  //   "元素在不在"不是"画板起没起来"）。
  let 就绪 = false;
  for (let i = 0; i < 60; i++) {
    if (await ev('!!(typeof SR!=="undefined" && SR.board && SR.board.isReady && SR.board.isReady())')) { 就绪 = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  判('0丁 画板真起来了（后面每一条"板上有没有"都要靠它）', 就绪 === true);

  // ── 1. 空板：门必须一张都不能过 ──────────────────────────────────
  const 空板数 = await 清干净();
  console.log('\n[空板] 板上对象数 = ' + 空板数 + (空板数 === 0 ? '（真·空的）' : '（★不是 0 —— 读数不可信）'));
  判('1甲 板确实清干净了（是 0，不是"问不出来"的 -1）', 空板数 === 0, 空板数 + ' 件');
  const 空门 = JSON.parse(await 量门(['板子上这个对不对', '图上那个角', '你刚才画的圆']));
  console.log('   门在空板上的判定：' + JSON.stringify(空门));
  判('1乙 空板 → 门恒 false（三种指代都不放行）', 空门.every(x => x[1] === false));

  // ── 2. 板上有东西：门该松的松、该紧的紧 ──────────────────────────
  const 画好了 = await 画上去(['A=(1,1)', 'B=(5,2)', '线段(A,B)']);
  await new Promise(r => setTimeout(r, 1200));
  const 板上数 = await 数板();
  console.log('\n[有图] 画上去结果=' + 画好了 + '  板上对象数=' + 板上数);
  判('2甲 板子上真画出了东西（后面几条才有前提）', 板上数 > 0, 板上数 + ' 件');

  const 有门 = JSON.parse(await 量门(['板子上这个对不对', '图上那个角', '你刚才画的圆', '画个三角形', '随便聊聊']));
  console.log('   门在有图时的判定：' + JSON.stringify(有门));
  const 门表 = {}; 有门.forEach(x => 门表[x[0]] = x[1]);
  判('2乙 指代板子的三句 → 都放行', 门表['板子上这个对不对'] && 门表['图上那个角'] && 门表['你刚才画的圆']);
  判('2丙 「画个三角形」**不放行**（那是要新画，不是要看）', 门表['画个三角形'] === false);
  判('2丁 「随便聊聊」不放行', 门表['随便聊聊'] === false);

  // ── 3. 真走几轮，看 messages 里到底带没带那张图 ──────────────────
  const 走一趟 = async (话, 看板) => {
    await ev('(async function(){ try { await SR.api.ask({ work:"draw", history:[], parts:[], text:'
      + JSON.stringify(话) + (看板 ? ', 看板:true' : '') + ', onChunk:function(){} }); } catch(e){} return 1; })()');
    const r = await ev('JSON.stringify(SR.api.lastParts || null)');
    return JSON.parse(r) || [];
  };
  const 带图 = ps => ps.filter(p => p && p.kind === 'image');

  console.log('\n第 1 趟 · 「板子上这个对不对」（该过门）');
  const 一 = await 走一趟('板子上这个对不对', false);
  console.log('   lastParts = ' + JSON.stringify(一));
  判('3甲 真带上了一张板子图', 带图(一).length === 1, 带图(一).length + ' 张');
  判('3乙 那张图配了图注（否则跟老师贴的题图长得一样）',
    带图(一).length === 1 && /画板/.test(带图(一)[0].note || ''), 带图(一)[0] && 带图(一)[0].note);
  判('3丙 图是真的（字节数上千，不是空串）', 带图(一)[0] && 带图(一)[0].字节 > 1000, 带图(一)[0] && 带图(一)[0].字节 + ' 字节');

  console.log('\n第 2 趟 · 「画个三角形」（**不过门**，反例）');
  const 二 = await 走一趟('画个三角形', false);
  console.log('   lastParts = ' + JSON.stringify(二));
  判('★★ 4甲 反例必须**不带**图（证明了是门在挑，不是每轮都带）', 带图(二).length === 0, 带图(二).length + ' 张');

  console.log('\n第 3 趟 · 「随便聊聊」+ 看板:true（强制，模拟自修那趟）');
  const 三 = await 走一趟('随便聊聊', true);
  console.log('   lastParts = ' + JSON.stringify(三));
  判('★★ 5甲 强制真起作用：不过门的话也带上了', 带图(三).length === 1, 带图(三).length + ' 张');

  console.log('\n第 4 趟 · 清空板子 +「板子上这个对不对」+ 看板:true（空板硬闸）');
  console.log('   清完板上对象数 = ' + await 清干净());
  const 四 = await 走一趟('板子上这个对不对', true);
  console.log('   lastParts = ' + JSON.stringify(四));
  判('★★ 6甲 板空了就一律不看，**连强制的也不看**（不给模型发白板）', 带图(四).length === 0, 带图(四).length + ' 张');

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

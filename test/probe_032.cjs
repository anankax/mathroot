// 2026-10-03 四改一验。**全场只跑这一次探针**（孔老师原话：
// 「你不要再屡次三番跑探针了，真的很浪费时间」），所以四件事挤在一趟里：
//
//   ① `点((0,0,0))` 兜底 —— 他问的「为啥动点没出来」的根因（board.js expand 末尾）
//   ② 中文文本在卷面上的位置 —— getXcoord/getYcoord 对 text 对象抛 IllegalArgument，
//      原先一动就把整批文本框带走（board.js paperDrawText）
//   ③ 作图工位挂上「复制这段／打包」—— 他问的「怎么存图，存信息对话，我也没看到按钮」（config.js）
//   ④ 数轴刻度步长 = 1 —— 他上一问的「为什么数轴单位长度不是1」
//
// ①②③ 里 ①③ 是**行为**、能数对象数出来；② 只能验到"XML 里有 startPoint、我的正则吃得下"
// 这一步（真画到卷面上要靠 shoot 那条路，这一趟不借板，避免又等几十秒）——
// **没验到的那一截下面会写明**，不许含糊过去。
//
// ④ 是画出来的，只能看图。所以这一趟落两张 PNG：刻度图 + 动点图。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:8138/index.html';
const SHOT = path.join(__dirname, '_shot');
try { fs.mkdirSync(SHOT, { recursive: true }); } catch (e) {}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {}; const 报错 = [];
  ws.on('message', m => {
    const o = JSON.parse(m);
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; }
    if (o.method === 'Runtime.consoleAPICalled' && /error|warning/i.test(o.params.type)) {
      报错.push('[' + o.params.type + '] ' + o.params.args.map(a => String(a.value || a.description || '')).join(' ').slice(0, 200));
    }
  });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { 炸了: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 400) };
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const 图 = async (名) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result && r.result.data) { fs.writeFileSync(path.join(SHOT, 名), Buffer.from(r.result.data, 'base64')); return 名; }
    return '(截图失败)';
  };
  const 等稳 = async () => {
    let 稳 = 0, 上 = '';
    for (let s = 0; s < 300; s++) {
      const st = await ev('(function(){var ms=document.querySelectorAll("#msgs .msg.assistant");var m=ms[ms.length-1];'
        + 'var b=document.getElementById("send")||{};return {n:ms.length,发着:!!b.disabled,字:m?(m.innerText||""):""};})()');
      if (st && st.n > 0 && !st.发着) { if (st.字 && st.字 === 上) 稳++; else 稳 = 0; 上 = st.字; if (稳 >= 4) break; } else 稳 = 0;
      await sleep(500);
    }
  };
  const 板 = () => ev('(function(){var a=SR.board.applet();if(!a)return null;var ns=a.getAllObjectNames();var o=[];'
    + 'for(var i=0;i<ns.length;i++){var ty="";try{ty=a.getObjectType(ns[i]);}catch(e){ty="?";}o.push(ns[i]+":"+ty);}'
    + 'return o;})()');
  const 状态 = () => ev('(function(){var e=document.getElementById("status");return e?String(e.textContent||"").trim():"(没有 status)";})()');
  // 跑一批命令，等画完（onScreen 那套会按 30ms 走，给足 3 秒）
  const 跑 = async (行) => { await ev('SR.board.run(' + JSON.stringify(行) + ')'); await sleep(3000); };

  const 出 = [];
  const P = (...a) => 出.push(a.join(' '));

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE + '?p032a=' + Date.now() });
  for (let i = 0; i < 80; i++) { if (await ev('!!(window.SR&&SR.board&&SR.memo)').catch(() => false)) break; await sleep(500); }
  await ev('(function(){try{SR.memo.clear();}catch(e){}return 1})()');
  await send('Page.navigate', { url: PAGE + '?p032b=' + Date.now() });
  for (let i = 0; i < 80; i++) { if (await ev('!!(window.SR&&SR.board&&SR.board.applet&&SR.board.applet())').catch(() => false)) break; await sleep(500); }
  await sleep(1500);

  // ═══════════ ① `点((0,0,0))` 兜底 ═══════════
  P('===== ① 「点((0,0,0))」兜底（他问的"动点没出来"） =====');
  P('translate 之前 → 之后：' + JSON.stringify(await ev('(function(){var L=["点((0,0,0))","动点P((0,0,0))","中点(A,B)","圆((0,0),(1,1))","A=(-2,0)","文本(\\"甲\\",(1,2))","交点(f,g)","球((0,0,0),2)"];'
    + 'return {进:L, 出:SR.board.translate(L)};})()')));
  await 跑(['#清空', '点((0,0,0))']);
  P('跑完板上的对象：' + JSON.stringify(await 板()));
  P('状态条：' + JSON.stringify(await 状态()));
  P('');

  // 他那张图的原样：第二条命令拿 `点` 当对象名引用（连坐的那两条）
  await 跑(['#清空', '#三维', 't=Slider(0,6.3,0.1)', '点((0,0,0))', 'P2=Rotate(点,t,zAxis)']);
  P('他那一幕复现（#三维 + t 滑块 + 点((0,0,0)) + Rotate(点,t,zAxis)）：');
  P('  板上的对象：' + JSON.stringify(await 板()));
  P('  状态条：' + JSON.stringify(await 状态()));
  P('');

  // ═══════════ ③ 回归：提示词教过的那批命令一条都不许被兜底误伤 ═══════════
  P('===== ③ 回归：CMD_MAP 认得的命令有没有被兜底碰过 =====');
  await 跑(['#清空', '数轴', 'A=(-2,0)', 'B=(3,0)', 'C=(0,2)', '中点(A,B)', 'c=圆(C,1.5)', '文本("甲", C+(0,0.6))']);
  P('板上的对象：' + JSON.stringify(await 板()));
  P('状态条：' + JSON.stringify(await 状态()));
  P('');
  P('===== ② 文本对象的位置：XML 里到底有没有 startPoint、我的正则吃得下吗 =====');
  P(JSON.stringify(await ev('(function(){var a=SR.board.applet();var ns=a.getAllObjectNames();'
    + 'var tx=ns.filter(function(n){try{return a.getObjectType(n)==="text";}catch(e){return false;}});'
    + 'var r={};tx.forEach(function(n){var x="";try{x=String(a.getXML(n)||"");}catch(e){x="(getXML 也抛了)";}'
    + '  var m=x.match(/startPoint[^>]*\\bx="([-\\d.eE+]+)"[^>]*\\by="([-\\d.eE+]+)"(?:[^>]*\\bz="([-\\d.eE+]+)")?/);'
    + '  r[n]={xml前200:x.slice(0,200), 正则吃到了:m?m.slice(0,4):"没吃到"};});'
    + 'return r;})()'), null, 1));
  P('');

  // ═══════════ ④ 数轴刻度步长 = 1（只能看图） ═══════════
  P('===== ④ 数轴刻度（这张图我自己看） =====');
  await 跑(['#清空', '数轴', 'A=(-2,0)', 'B=(3,0)']);
  P('截图：' + await 图('p032-axis.png'));
  P('状态条：' + JSON.stringify(await 状态()));
  P('');

  // ═══════════ ⑤ 一次真实对话：他那句话 + 气泡上该有的按钮 ═══════════
  P('===== ⑤ 真跑一次「画个动图，点在圆上移动」（就这一轮） =====');
  P('SR.WORKS.draw.copy = ' + JSON.stringify(await ev('!!(SR.WORKS&&SR.WORKS.draw&&SR.WORKS.draw.copy)')));
  await ev('(function(){var b=document.querySelector(".workbtn[data-work=\\"draw\\"]");if(b)b.click();return 1})()');
  await sleep(700);
  await ev('(function(){var i=document.getElementById("input");i.focus();i.value="画个动图，点在圆上移动";i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
  await sleep(200);
  await ev('document.getElementById("send").click(); 1');
  await 等稳();
  await sleep(3000);
  P(JSON.stringify(await ev('(function(){var ms=document.querySelectorAll("#msgs .msg.assistant");var m=ms[ms.length-1];if(!m)return null;'
    + 'return {条数:ms.length,'
    + '  复制这段:m.querySelectorAll(".copybtn").length,'
    + '  打包:m.querySelectorAll(".packbtn").length,'
    + '  想说按钮:m.querySelectorAll(".chip").length,'
    + '  冻图:m.querySelectorAll(".figbox img").length,'
    + '  露出的:Array.prototype.filter.call(m.querySelectorAll(".figbox img"),function(i){return i.getClientRects().length>0;}).length,'
    + '  正文前80:String(m.innerText||"").slice(0,80)};})()'), null, 1));
  P('状态条：' + JSON.stringify(await 状态()));
  P('板上的对象：' + JSON.stringify(await 板()));
  P('截图：' + await 图('p032-dot.png'));
  P('');
  P('===== 这一趟全部控制台 error/warning =====');
  P(报错.length ? 报错.join('\n') : '(一条都没有)');

  fs.writeFileSync(path.join(SHOT, 'p032.txt'), 出.join('\n'), 'utf8');
  console.log(出.join('\n'));
  await closeTab(t.id); ws.close();
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

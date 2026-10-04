// 「**照试卷上的几何图做出来、还要能动**」——孔老师最后强调的那一件。
//
// 为什么跟 probe_figall 分开、单独一把：
//   体检表那 53 句都是**纯文字**进去的（模型自己在脑子里搭图）。
//   这一档多了**一张图**——老师把卷子上那道题拍下来贴进去，说"照这个画，再让它动"。
//   多出来的这段路是**看图**，体检表一句都量不到：
//     · 围栏出得出，可它画的**根本不是图上那个图形**（把小方块数错、把 G 认成 C）；
//     · 或者它**干脆只问不动手**（这也可能是对的，见下面第 5 条）。
//   所以量的还是那三层（模型层/翻译层/成品层），但入口换成了 image_url。
//
// ★ 夹具是真图，不是我随手画的：test/_exam_fold.png
//   来自**孔老师自己卷子**（宜兴东氿中学/03-试卷周练/B39.docx 里的第 17 题）
//   ——长方形 ABCD、G 在 AD 上、E 和 H 在上面、F 在 BC 上，三角形 EFG 像是被转过去的一块。
//   用真题而不是我编的图，是因为"模型能不能读课堂里真会出现的那种图"才是要问的事；
//   我编的图会不知不觉编成"好认的图"。
//   生成脚本 test/_mkcrop.ps1（走 System.Drawing，**不占 9222**，见那个文件里的理由）。
//
// 用法：node test/probe_examfig.cjs [每句打几次，默认 2] [只跑第几号,逗号分隔]
//   ⚠ 要先起 node test/serve.cjs 8138，并且 Chrome 在 9222（**开着的窗口**）。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const N = Number(process.argv[2] || 2);
const ONLY = (process.argv[3] || '').split(',').map(s => Number(s.trim())).filter(n => n > 0);

// 期望只有三种：
//   '画'  = 该照着图画出东西来（围栏 + 板上真有对象）
//   '动'  = 在上面基础上，点播放要**真的动**
//   '不画' = 这句是**纯问话**，不该画（对照组：防"看见图就画"）
//   '随'  = 两种都算对，只记录不判——留给"它该不该反问"这类口味问题
const 表 = [
  ['看图·照画', '这是我卷子上的一道题的图，照着把图做出来', '画'],
  ['看图·照画并动', '照这张图做出来，还要能看出它是可以动的', '动'],
  ['看图·指定动法', '这是我卷子上第 17 题的图。照它画出来，然后把三角形 EFG 绕点 F 转起来', '动'],
  ['看图·只问不画', '这张图里有几个三角形？', '不画'],
  ['看图·含糊', '把这张图做成动图', '随']
];

const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
  r.on('error', rej); r.end();
});
const 全表 = 表.map((r, i) => ({ 号: i + 1, 组: r[0], 句: r[1], 期望: r[2] }));
const 跑 = ONLY.length ? 全表.filter(r => ONLY.indexOf(r.号) >= 0) : 全表;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const IMG = path.join(__dirname, '_exam_fold.png');
if (!fs.existsSync(IMG)) { console.log('夹具不在：' + IMG + '\n先生成它：powershell -File test/_mkcrop.ps1'); process.exit(1); }
const 图 = 'data:image/png;base64,' + fs.readFileSync(IMG).toString('base64');
console.log('夹具 ' + path.basename(IMG) + '，' + Math.round(fs.statSync(IMG).size / 1024) + ' KB');

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  // 宽度 2000：数根是三栏，画板那栏在 x≈1465 起（跟 probe_figall 同一个理由）
  await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1000, deviceScaleFactor: 1, mobile: false });

  // THROW 当异常抛，绝不返回字符串（字符串是真值，会把"等就绪"当场放行）
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面里炸了: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200) + '\n    表达式: ' + e.slice(0, 160));
    return R && R.result ? R.result.value : null;
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  let 就绪 = false;
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady&&SR.board.isReady())') === true) { 就绪 = true; break; }
  }
  if (!就绪) { console.log('画板一直没起来——先看那一页有没有报错'); process.exit(1); }
  await send('Page.bringToFront', {});

  // 会不会动：拍画板自己渲染的那张图（getPNGBase64），不是 CDP 截屏——
  //   截屏量的是"屏幕上那一块"，画板被挡/在视口外就恒等（量具自己造出"不动"）。见 probe_figall。
  const 拍 = async () => {
    const b64 = await q('SR.board.toPNG()');
    if (typeof b64 !== 'string' || b64.length < 2000) return null;
    return require('crypto').createHash('md5').update(b64).digest('hex');
  };
  const 存图 = async (名) => {
    try {
      const b64 = await q('SR.board.toPNG()');
      if (typeof b64 === 'string' && b64.length > 2000) {
        const d = path.join(__dirname, '_shot'); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 名 + '.png'), Buffer.from(b64, 'base64'));
        return true;
      }
    } catch (e) {}
    return false;
  };
  const 后端 = await q('SR.api.backend && SR.api.backend().id');
  console.log('画板就绪。后端 = ' + 后端 + '，每句打 ' + N + ' 次，共 ' + 跑.length + '/' + 全表.length + ' 句'
    + (ONLY.length ? '（只跑 ' + ONLY.join(',') + ' 号）' : '') + '\n');

  // ═══ 先验尺子：会动的图要判成动，不播放的图不许判成动 ═══
  const 自检 = {};
  {
    const 试 = async (命令, 播放) => {
      await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(450);
      await q('SR.board.run(' + JSON.stringify(命令) + ')');
      for (let i = 0; i < 20; i++) { await sleep(250); if (await q('SR.board.isBusy()') === false) break; }
      await sleep(400);
      const h0 = await 拍(); if (h0 === null) return null;
      if (播放) await q('SR.board.togglePlay()');
      await sleep(1200);
      const h1 = await 拍();
      if (播放) await q('SR.board.stopPlay()');
      if (h1 === null) return null;
      return h0 !== h1;
    };
    const 会动的 = ['#清空', 'O=(0,0)', 'A=(2,0)', 'B=(3,1)', 'C=(2,2)', '多边形(A,B,C)',
      'α=Slider(0,6.28,0.05)', '旋转(多边形(A,B,C), α, O)', '#隐藏 α', '#播放 α'];
    自检.会动的图判成动 = await 试(会动的, true);
    自检.不播放的图判成不动 = !(await 试(会动的.slice(0, -1), false));
    自检.取得到图 = 自检.会动的图判成动 !== null && 自检.不播放的图判成不动 !== null;
  }
  自检.尺子可用 = 自检.取得到图 && 自检.会动的图判成动 === true && 自检.不播放的图判成不动 === true;
  console.log('  尺子自检：会动的判成动 = ' + 自检.会动的图判成动 + '，不播放的判成不动 = ' + 自检.不播放的图判成不动
    + (自检.尺子可用 ? '  ✅ 这把尺子可用' : '  ❌❌ 尺子本身有问题，下面的动图读数**一律不许信**') + '\n');

  const 记录 = [];
  for (const 条 of 跑) {
    const { 号, 组, 句, 期望 } = 条;
    const 行 = { n: 号, 组, 句, 期望, 次: [] };
    for (let k = 0; k < N; k++) {
      await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(450);

      // ① 模型层：把**图**和话一起递进去（parts 那条路，见 js/api.js:112 那段注释）
      const r = await q('(async function(){ try{ var z = await SR.api.ask({work:"draw",history:[],'
        + 'parts:[{kind:"image",dataUrl:' + JSON.stringify(图) + '},{kind:"text",text:' + JSON.stringify(句) + '}],'
        + 'onChunk:function(){},onNotice:function(){}});'
        + 'var t = z.text || ""; var P = SR.render.parseFences(t);'
        + 'return {err:z.error||null, model:z.model||"", 围栏:(P.ggb||[]).length, 命令:(P.ggb||[]).join("\\n"), 可见:(P.visible||""), 原文:t}; }'
        + 'catch(e){ return {err:String(e&&e.message||e)}; } })()');
      const 一 = { 错: r && r.err || null, model: r && r.model || '', 围栏: r && r.围栏 || 0, 命令: r && r.命令 || '', 可见: r && r.可见 || '', 原文: r && r.原文 || '' };

      // ② + ③ 翻译层 / 成品层
      if (一.命令) {
        await q('SR.board.run(' + JSON.stringify(一.命令.split('\n')) + ')');
        for (let i = 0; i < 24; i++) { await sleep(250); if (await q('SR.board.isBusy()') === false) break; }
        await sleep(500);
        const 板 = await q('(function(){ var a=SR.board.applet(); if(!a) return null;'
          + 'var ns=a.getAllObjectNames(), o={}, ty={};'
          + 'for (var i=0;i<ns.length;i++){ var n=ns[i]; try{ o[n]=String(a.getCommandString(n)); ty[n]=String(a.getObjectType(n)); }catch(e){ o[n]="?"; ty[n]="?"; } }'
          + 'return {对象:o, 类型:ty, 是三维:SR.board.is3D(), 能播:SR.board.canPlay(), 没认:SR.board.failed()}; })()');
        一.板 = 板;
        if (板 && 板.能播) {
          const h0 = await 拍();
          await q('SR.board.togglePlay()');
          await sleep(900); const h1 = await 拍();
          await sleep(1000); const h2 = await 拍();
          await q('SR.board.stopPlay()');
          一.动了 = (h1 !== h0) || (h2 !== h0);
        }
      }
      // 每一条都把画板存下来——他问"读没读懂那张图"时，一张图比我一段话有用
      await 存图('exam' + 号 + '_' + (k + 1) + (期望 === '不画' ? '_对照' : ''));
      行.次.push(一);
    }
    记录.push(行);
    const a = 行.次[0];
    const 件 = a && a.板 ? Object.keys(a.板.对象).length : 0;
    const 判 = 期望 === '不画' ? (a.围栏 === 0 ? '✅' : '❌硬画了') :
      期望 === '画' ? ((a.围栏 > 0 && 件 > 0) ? '✅' : '❌') :
      期望 === '动' ? ((a.围栏 > 0 && 件 > 0 && a.动了) ? '✅' : '❌') : '·';
    console.log('  ' + 判 + '  ' + String(号).padStart(2) + '. ' + 组.padEnd(14) +
      ' 围栏' + (a.围栏 || 0) + ' 对象' + 件 + (a.板 ? (a.能播 ? ' 能播' : '') + (a.动了 ? ' **真动了**' : '') : '') +
      (a.model ? ' [' + a.model + ']' : '') + (a.错 ? '  ⚠' + a.错.slice(0, 40) : ''));
    // 它**反问**了没有——这是他明确要的行为（"不清楚就问，别立马画"），单独看一眼
    if (a.围栏 === 0 && a.可见 && /[？?]|是不是|你是想|哪一种|你要/.test(a.可见)) {
      console.log('        ↳ 没画，改**反问**了：' + a.可见.replace(/\n+/g, ' ').slice(0, 70));
    }
  }

  const 该画 = 记录.filter(r => r.期望 === '画' || r.期望 === '动');
  console.log('\n  看图作图：' + 该画.filter(r => r.次.every(a => a.围栏 > 0 && a.板 && Object.keys(a.板.对象).length > 0)).length + '/' + 该画.length + ' 画出来了');
  const 该动 = 记录.filter(r => r.期望 === '动');
  console.log('  其中要动的：' + 该动.filter(r => r.次.every(a => a.板 && a.动了)).length + '/' + 该动.length + ' 真动了');
  const 对照 = 记录.filter(r => r.期望 === '不画');
  console.log('  对照组（纯问话，不该画）：' + 对照.filter(r => r.次.every(a => a.围栏 === 0)).length + '/' + 对照.length + ' 没硬画');
  console.log('\n画板图 → test/_shot/exam*.png（每条一张，直接看图最快）');

  const OUT = path.join(__dirname, '_examfig.json');
  fs.writeFileSync(OUT, JSON.stringify({ 尺子自检: 自检, 记录 }, null, 1));
  console.log('逐条原文 → ' + OUT + '\n');
  ws.close();
})();

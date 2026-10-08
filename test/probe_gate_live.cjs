// 一次性：在**线上那一页**里，量 gate 那条链到底通没通。
//
// ★ 为什么非要跑线上那一页、不能跑 localhost：
//   js/gate.js:76-99 记着一条查实过的坑——从 localhost 来的请求在网关预检那关就没了。
//   线上来源（anankax.github.io）才是它该工作的形状。
//
// ★ 为什么量的是 SR.gate.reslib() 而不是发一句真的提问：
//   这一趟**不调模型、不花额度**（gate 那边记的是 KB_DAILY_CAP）。修没修通，
//   看的就是这一发；模型那一段是另一回事，别把两件事混成一个读数。
//
// ★★ 老账：**先证明页面上装的是哪一版**，再读别的。线上吃缓存会把"其实没生效"验成"生效了"。
//   所以：先 Network.enable 再 setCacheDisabled（顺序反了等于没设），
//   然后读回 SR.GATE.token 当指纹——它是 config.js 的原文，读得出来就说明这一版到了。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const 线上 = 'https://anankax.github.io/mathroot/index.html?probe=gate&t=' + Date.now();

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 260);
    return R && R.result ? R.result.value : null;
  };

  console.log('导航到线上那一页……');
  await send('Page.navigate', { url: 线上 });
  for (let i = 0; i < 60; i++) { if (await q('!!(window.SR && SR.gate && SR.render)') === true) break; await sleep(500) }
  await sleep(2000);

  // ---- 第一件：先认页面上装的是哪一版 ----
  console.log('\n======== 一、先证明页面上装的是哪一版 ========');
  console.log(JSON.stringify(await q(`({
    地址: String(location.href).slice(0, 70),
    readyState: document.readyState,
    SRlib: typeof window.SRlib, SRlib落定: window.SRlib ? SRlib.ready : null,
    gate在不在: typeof window.SR,
    GATE可读: !!(SR.GATE),
    GATE_url尾: SR.GATE ? String(SR.GATE.url).slice(-28) : null,
    GATE_token: SR.GATE ? SR.GATE.token : null,
    GATE_timeout: SR.GATE ? SR.GATE.timeout : null
  })`), null, 1));

  // ---- 第二件：真正的那一发 ----
  console.log('\n======== 二、SR.gate.reslib("绝对值 相反数 倒数", 3) ========');
  const r1 = await q(`SR.gate.reslib('绝对值 相反数 倒数', 3).then(function(r){
    return { 成没成: r.ok, 因为什么: r.why || null, 花了几毫秒: r.ms,
             云端用语料花了: r.corpus_ms, 用的是缓存吗: r.corpus_cached,
             库里共几块: r.rows, 打了几分: r.scored, 版本: r.version,
             服务端收到的词: r.q,
             命中数: (r.hits||[]).length,
             命中: (r.hits||[]).map(function(h){ return { 分: Math.round(h.score*100)/100, 题: String(h.title||'').slice(0,60), 第几页: h.page, 正文头: String(h.body||'').replace(/\\s+/g,' ').slice(0,50) } })
           };
  })`);
  console.log(JSON.stringify(r1, null, 1));

  // 知识库那两步（flow.js:261 走的就是这两步）。★ 它们跟 reslib 不同：
  //   用的是 kb() 那条默认时限（8000ms），语料也不是同一个。要分开量。
  console.log('\n======== 二之二、SR.gate.kb("textbook"/"zhuawen") ========');
  for (const 步 of ['textbook', 'zhuawen']) {
    const r = await q(`SR.gate.kb(${JSON.stringify(步)}, '数轴 相反数', 3).then(function(r){
      return { 成没成: r.ok, 因为什么: r.why || null, 花了几毫秒: r.ms, 版本: r.version,
               服务端收到的词: r.q, 命中数: (r.hits||[]).length,
               头两条: (r.hits||[]).slice(0,2).map(function(h){ return Math.round(h.score*100)/100 + ' | ' + String(h.title||'').slice(0,50) }) };
    })`);
    console.log('  · ' + 步 + '：' + JSON.stringify(r));
  }

  console.log('\n======== 三、SR.gate.libList()（列桶）========');
  const r2 = await q(`SR.gate.libList().then(function(r){
    return { 成没成: r.ok, 因为什么: r.why || r.error || null, 花了几毫秒: r.ms,
             哪个桶: r.bucket, 几件: r.n, 版本: r.version,
             头三件: (r.items||[]).slice(0,3).map(function(x){ return { 名字: String(x.name||'').slice(0,50), 大小: x.size } })
           };
  })`);
  console.log(JSON.stringify(r2, null, 1));

  console.log('\n======== 四、SR.gate.libSign()（拿一份原件）========');
  const 原件 = '宜兴东氿中学/14-新备课组资料/9.28宜兴市东氿中学七上数学阶段性小练习.pdf';
  const r3 = await q(`SR.gate.libSign(${JSON.stringify(原件)}, 600).then(function(r){
    return { 成没成: r.ok, 因为什么: r.why || r.error || null, 花了几毫秒: r.ms,
             拿到地址了吗: !!r.url, 地址: String(r.url||''), 有效期: r.expires };
  })`);
  console.log(JSON.stringify(Object.assign({}, r3, { 地址: String(r3 && r3.地址 || '').slice(0, 90) + '…' }), null, 1));

  // ★ 光"拿到地址"不算数：签名没配好时最典型的失败是**下回来一页 JSON 或本站的 HTML**，
  //   看着跟下载成功一模一样。所以要真去取一次，认头、认前几个字节。
  if (r3 && r3.地址) {
    console.log('\n---- 真去取一次，认它到底是什么 ----');
    const 取 = u => new Promise(res => {
      require('https').get(u, r => {
        const bufs = [];
        r.on('data', c => { bufs.push(c); if (Buffer.concat(bufs).length > 4096) r.destroy() });
        r.on('end', () => res({ 状态: r.statusCode, 头: r.headers, 前几字节: Buffer.concat(bufs).slice(0, 8) }));
        r.on('close', () => res({ 状态: r.statusCode, 头: r.headers, 前几字节: Buffer.concat(bufs).slice(0, 8) }));
      }).on('error', e => res({ 状态: 0, 错了: String(e.message) }));
    });
    const g = await 取(r3.地址);
    const b = g.前几字节 || Buffer.alloc(0);
    console.log(JSON.stringify({
      状态: g.状态, 错了: g.错了 || null,
      类型: g.头 && g.头['content-type'],
      长度: g.头 && g.头['content-length'],
      '是PDF吗': b.slice(0, 5).toString('latin1') === '%PDF-',
      前几字节: b.toString('latin1'),
      '像HTML页吗': /^\s*</.test(b.toString('latin1'))
    }, null, 1));
  }

  console.log('\n======== 五、顺带看流水线面板上那几个字 ========');
  console.log(JSON.stringify(await q(`(function(){
    var b = document.getElementById('flowbox');
    if (!b) return '(没有 flowbox 这个元素)';
    return { 显没显: b.getClientRects().length > 0, 里面写的字: String(b.innerText||'').replace(/\\s+/g,' ').slice(0, 260) };
  })()`), null, 1));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(path.join(__dirname, '_shot', '_gate_live.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('\n图：' + path.join(__dirname, '_shot', '_gate_live.png'));
  ws.close(); process.exit(0);
})().catch(e => { console.log('炸了：', e.message); process.exit(3) });

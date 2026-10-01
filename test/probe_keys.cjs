// 「模型通道」面板那条线的探针。用法:
//   node test/probe_keys.cjs [url]
//
// 验的是孔老师那句"Key 那套按钮没做好"到底修没修好：
//   ① 顶栏只剩一处入口（#keybtn 拆干净了）
//   ② 状态牌说得清"现在在用哪条、通没通、Key 尾号"
//   ③ 「测一下」拿**输入框里这一串**去验，且当场给回复
//   ④ 保存后真切通道
//   ⑤ 手机上（390px）切通道/填 Key 的入口还在、还点得着
//
// ★ ③④ 不真打网络：把 fetch 换成假的。
//   测的是"点了之后发生了什么"，不是 DeepSeek 通不通（那不该由这个探针负责）。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const URL_ = process.argv[2] || 'http://localhost:8138/index.html';
let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function req(opts, body) {
  return new Promise((res, rej) => {
    const r = http.request(opts, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

(async () => {
  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {}; const errs = [];
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; return; }
    if (r.method === 'Runtime.exceptionThrown') {
      const d = r.params.exceptionDetails;
      errs.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {}); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面抛错: ' + JSON.stringify(r.result.exceptionDetails.exception || {}));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 20; i++) { if (await q('!!(window.SR&&SR.main&&SR.api)')) break; await wait(500); }

  console.log('===== ① 顶栏只剩一处入口 =====');
  ok('#keybtn 已经拆干净', await q('!document.getElementById("keybtn")'));
  ok('顶栏有「免费通道 / 我的 Key」两格', await q('document.querySelectorAll(".backs .backbtn").length') === 2);
  const labels = await q('JSON.stringify([].map.call(document.querySelectorAll(".backs .backbtn .label"),function(e){return e.textContent}))');
  ok('两格的文案就是这两个', labels === '["免费通道","我的 Key"]', labels);

  console.log('\n===== ② 状态牌 =====');
  await q('SR.main.applyBackend("glm")');
  await wait(200);
  const s1 = JSON.parse(await q(`JSON.stringify({now:document.getElementById('ks-now').textContent, ok:document.getElementById('ks-ok').textContent, warn:document.getElementById('keystate').classList.contains('warn'), tail:getComputedStyle(document.getElementById('ks-tail')).display})`));
  console.log('   ', JSON.stringify(s1));
  ok('当前写着「免费通道」', s1.now === '免费通道', s1.now);
  ok('状态写着已连上', /已连上/.test(s1.ok), s1.ok);
  ok('免费通道不显示 Key 尾号', s1.tail === 'none', s1.tail);
  ok('通的，不带 warn', s1.warn === false, s1.warn);
  ok('状态字带 .ok 类（绿色）', await q('document.getElementById("ks-ok").classList.contains("ok")'));

  console.log('\n===== ③ 没填 Key 时的状态牌要说实话 =====');
  await q('SR.api.forgetKey(); SR.main.applyBackend("deepseek")');
  await wait(200);
  const s2 = JSON.parse(await q(`JSON.stringify({now:document.getElementById('ks-now').textContent, ok:document.getElementById('ks-ok').textContent, warn:document.getElementById('keystate').classList.contains('warn')})`));
  console.log('   ', JSON.stringify(s2));
  ok('当前写着「我的 Key」', s2.now === '我的 Key', s2.now);
  ok('状态写着还没填', /还没填/.test(s2.ok), s2.ok);
  ok('没填要挂 warn（左边条变砖红）', s2.warn === true, s2.warn);

  console.log('\n===== ④「测一下」 =====');
  // 假 fetch：按 Key 内容决定回什么，免得真打网络
  await q(`window.__tryKey=null; window.__realFetch=window.fetch; window.fetch=function(u,o){
    var k=(o.headers&&(o.headers.Authorization||o.headers.authorization)||'').replace('Bearer ','');
    window.__tryKey=k;
    var bad = k.indexOf('sk-bad')===0;
    return Promise.resolve(new Response(bad?'{"error":"nope"}':'{"ok":1}',
      {status: bad?401:200, headers:{'Content-Type':'application/json'}}));
  };`);

  await q('SR.main.applyBackend("deepseek"); SR.api.forgetKey();');
  await q('document.querySelector(".backs .backbtn[data-backend=deepseek]").click()');
  await wait(200);
  ok('没填 Key 时点「我的 Key」会弹面板', await q('document.getElementById("keyset").classList.contains("open")'));

  // 格式就不对的
  await q('document.getElementById("keyinput").value="abc"; document.getElementById("keytest").click()');
  await wait(200);
  ok('格式不对时当场拦下，且不去打网络', /不像一个 DeepSeek Key/.test(await q('document.getElementById("keyerr").textContent')) && await q('window.__tryKey') === null, await q('document.getElementById("keyerr").textContent'));

  // 格式对但服务器不认
  await q('document.getElementById("keyinput").value="sk-bad12345678901234567890"; document.getElementById("keytest").click()');
  for (let i = 0; i < 10; i++) { await wait(200); if (await q('document.getElementById("keyerr").textContent')) break; }
  ok('验的是**输入框里这一串**', (await q('window.__tryKey') || '').indexOf('sk-bad') === 0, await q('window.__tryKey'));
  ok('服务器不认时给出原因', /不认|没通/.test(await q('document.getElementById("keyerr").textContent')), await q('document.getElementById("keyerr").textContent'));
  ok('测完按钮恢复可用', await q('!document.getElementById("keytest").disabled'));

  // 好的 Key
  await q('document.getElementById("keyinput").value="sk-good12345678901234567890"; document.getElementById("keytest").click()');
  for (let i = 0; i < 10; i++) { await wait(200); if (await q('document.getElementById("keyok").textContent')) break; }
  ok('通了时给肯定回复', /通了/.test(await q('document.getElementById("keyok").textContent')), await q('document.getElementById("keyok").textContent'));
  ok('通了的回复是绿色那一行（#keyok 不是 #keyerr）', await q('document.getElementById("keyerr").textContent') === '', await q('document.getElementById("keyerr").textContent'));

  console.log('\n===== ⑤ 保存并使用 =====');
  await q('document.getElementById("keysave").click()');
  await wait(400);
  const s3 = JSON.parse(await q(`JSON.stringify({open:document.getElementById('keyset').classList.contains('open'), back:SR.api.getBackendId(),
    now:document.getElementById('ks-now').textContent, ok:document.getElementById('ks-ok').textContent, tail:document.getElementById('ks-tail').textContent, tailVis:getComputedStyle(document.getElementById('ks-tail')).display,
    on:[].map.call(document.querySelectorAll('.backbtn'),function(e){return e.classList.contains('on')?e.getAttribute('data-backend'):''}).filter(Boolean).join(',')})`));
  console.log('   ', JSON.stringify(s3));
  ok('保存后面板关上', s3.open === false, s3.open);
  ok('后端真切到 deepseek', s3.back === 'deepseek', s3.back);
  ok('顶栏那一格点亮了', s3.on === 'deepseek', s3.on);
  ok('状态牌跟着变', /已填好/.test(s3.ok), s3.ok);
  ok('Key 尾号显示出来了', /尾号 7890/.test(s3.tail), s3.tail);
  ok('尾号那一格可见了', s3.tailVis !== 'none', s3.tailVis);
  ok('★ 尾号只露后四位（整串不上屏）', s3.tail.indexOf('sk-good') < 0, s3.tail);

  console.log('\n===== ⑥ 忘掉 Key / 回免费通道 =====');
  await q('document.getElementById("keyforget").click()');
  await wait(200);
  ok('忘掉后 localStorage 里真没了', await q('!SR.api.getKey("deepseek")'));
  ok('忘掉后给了回话', /已忘掉/.test(await q('document.getElementById("keyerr").textContent')), await q('document.getElementById("keyerr").textContent'));
  await q('document.getElementById("keyfree").click()');
  await wait(300);
  ok('回免费通道：后端切回去了', await q('SR.api.getBackendId()') === 'glm');
  ok('回免费通道：面板关上了', await q('!document.getElementById("keyset").classList.contains("open")'));
  ok('回免费通道：状态牌不再 warn', await q('!document.getElementById("keystate").classList.contains("warn")'));

  console.log('\n===== ⑦ 手机上（390px）入口还在吗 =====');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await wait(500);
  const m = JSON.parse(await q(`JSON.stringify((function(){
    var bs=document.querySelectorAll('.backs .backbtn'), out=[];
    for(var i=0;i<bs.length;i++){
      var r=bs[i].getBoundingClientRect(), cs=getComputedStyle(bs[i]);
      out.push({id:bs[i].getAttribute('data-backend'), w:Math.round(r.width), h:Math.round(r.height),
                vis:cs.display!=='none' && cs.visibility!=='hidden', label:getComputedStyle(bs[i].querySelector('.label')).display,
                inView: r.left>=0 && r.right<=window.innerWidth+1 && r.top>=0});
    }
    return {btns:out, vw:window.innerWidth, scrollW:document.documentElement.scrollWidth};
  })())`));
  console.log('   ', JSON.stringify(m));
  ok('手机上两格通道都在（没被 display:none 掉）', m.btns.length === 2 && m.btns.every(b => b.vis), m.btns);
  ok('手机上文字收起来了（只留状态点）', m.btns.every(b => b.label === 'none'), m.btns.map(b => b.label));
  ok('热区够手指点（≥32px）', m.btns.every(b => b.w >= 32 && b.h >= 32), m.btns.map(b => b.w + '×' + b.h));
  ok('都在屏幕里（没被挤出右边）', m.btns.every(b => b.inView), m.btns.map(b => b.inView));
  ok('顶栏没被挤到横向溢出', m.scrollW <= m.vw + 1, m.vw + ' / ' + m.scrollW);

  await q('window.fetch=window.__realFetch;');
  console.log('\n===== 控制台报错 =====');
  console.log(errs.length ? errs.slice(0, 8).map(e => '  ' + e).join('\n') : '  （无）');
  ok('无未捕获异常', errs.length === 0, errs.slice(0, 3));

  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  ws.close(); process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e); process.exit(2); });

// 量首屏到底重在哪：node test/probe_weight.cjs
//
// 起因：计划里有一条"把 prompt-student/prompt-lean 改懒加载，省 ~47KB"。
// 动手之前先问问这 47KB 值不值——如果大头在别处，省那点就是自我感动，
// 还白搭一个新的失败模式（提示词加载不出来，模型当场变傻）。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

function req(opts, body) {
  return new Promise((res, rej) => {
    const r = http.request(opts, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

(async () => {
  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  const q = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.board)')) break; await wait(500); }
  await wait(4000);   // 让 GeoGebra 的 codebase 下完

  const raw = await q(`JSON.stringify(performance.getEntriesByType('resource').map(function(e){
    return {n: e.name.split('/').slice(-1)[0].slice(0,46), s: Math.round(e.transferSize||e.encodedBodySize||0), k: (e.initiatorType||'')};
  }))`);
  const rows = JSON.parse(raw).filter(r => r.s > 0).sort((a, b) => b.s - a.s);
  const total = rows.reduce((a, r) => a + r.s, 0);

  console.log('首屏资源（按传输字节排，本机无压缩，线上会小些）：');
  console.log('  字节      占比    来源       文件');
  console.log('  ' + '-'.repeat(78));
  for (const r of rows) {
    console.log('  ' + String(r.s).padStart(8) + '  ' + (100 * r.s / total).toFixed(1).padStart(5) + '%  ' +
      r.k.padEnd(9) + '  ' + r.n);
  }
  console.log('  ' + '-'.repeat(78));
  console.log('  合计 ' + total + ' 字节 ≈ ' + (total / 1024).toFixed(0) + ' KB');

  // 分组。★ 第一版这几行写错了：判据叠了好几层，结果全部落进"其它"，100%。
  //   一个把什么都归成一类的分类器，等于没分类——摆出来只会让人以为量过了。
  const isCDN = n => /marked|purify|katex|auto-render/i.test(n);
  const isLocalOnly = n => /resource-index/i.test(n);      // 只在孔老师本机存在
  const grp = { '自家脚本': 0, '第三方(CDN)': 0, '样式': 0, '★本机才有的索引': 0, '其它': 0 };
  for (const r of rows) {
    if (isLocalOnly(r.n)) grp['★本机才有的索引'] += r.s;
    else if (isCDN(r.n)) grp['第三方(CDN)'] += r.s;
    else if (/\.css$/i.test(r.n)) grp['样式'] += r.s;
    else if (/\.js$/i.test(r.n)) grp['自家脚本'] += r.s;
    else grp['其它'] += r.s;
  }
  console.log('\n分组：');
  for (const k in grp) if (grp[k]) console.log('  ' + k.padEnd(16) + String(grp[k]).padStart(9) + ' 字节  ' + (100 * grp[k] / total).toFixed(1) + '%');

  // ★ 真问题：那 300KB 的本地索引，是**开机时**为了决定"素材"按钮露不露面而下下来的。
  //   公开站上没有这个文件（一直 404），所以访客不吃这一口；但本机每开一次就白下 300KB。
  //   拿它跟计划里那条"省 47KB 提示词"比一比，谁值得动，一目了然。
  console.log('\n★ 注意上面这张表只统计**顶层文档**。GeoGebra 的 codebase 是在它自己的');
  console.log('  iframe 里下的（跨域，进不了 performance 时间线），所以这张表里看不到它——');
  console.log('  真实的首屏重量比这 648KB 只多不少。别拿这张表当"全站有多重"的答案。');

  // 计划里那条：prompt-student(33KB) + prompt-lean(14.6KB)
  const own = rows.filter(r => /prompt-student|prompt-lean/.test(r.n)).reduce((a, r) => a + r.s, 0);
  console.log('\n★ 计划 §六.4 要省的那两份提示词：' + own + ' 字节 = 全首屏的 ' + (100 * own / total).toFixed(1) + '%');
  console.log('  （线上走 gzip，实际传输会更小，占比只会更低）');

  ws.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

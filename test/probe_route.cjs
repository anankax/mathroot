// 量具：**每一轮到底挑了哪颗模型**。把 fetch 打桩，不打真网络（桩回 400 就跳出循环）。
//
// ★ 这把尺子接的是 test/_route.cjs 的班。那一把**已经不准了**，别再去跑它：
//   它传的是 `mode:'student'`／`mode:'demo'`——api.js 只认 `work:`，`mode` 是空气；
//   于是它①②③④ 量的全是 `SR.WORKS[undefined] || SR.WORKS['material']`（组卷），
//   而「演示模式」那个工位早删了，它④ 那句 `glm-4v-flash` 现在是**长期假红**。
//   （同族事故：test/probe_fence.cjs 也是这么废的——见它文件开头。）
//
// 为什么现在要量：2026-10-04 给作图开了 textHead（不带图那一轮改走 modelsText），
//   这条改动**开了口子就是纵容**：只要有一个工位能从 board 跳到 text，就得钉住
//   "别的 board 工位没跟着跳"。所以下面既量 draw 该跳，也量 vary **不该**跳。
//
// 用法：node test/probe_route.cjs [地址]
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const URL_ = process.argv[2] || 'http://localhost:8138/index.html';
const req = o => new Promise((res, rej) => {
  const r = http.request(o, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
  r.on('error', rej); r.end();
});
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x ? '  → ' + x : '')); } };

(async () => {
  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Network.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.api&&SR.WORKS)')) break; await wait(500); }
  await wait(500);

  // ★★ 自检一：先证明这把尺子量的是它嘴上说的那两个工位。
  //   上一把就是栽在这儿——`mode:` 传进去等于没传，全部回落到组卷，
  //   而四句断言照样"通过"了三句，读数合情合理，量的是别人那页。
  const 自检 = await q(`JSON.stringify({
    workOrder: SR.WORK_ORDER,
    draw: !!(SR.WORKS.draw && SR.WORKS.draw.chain === 'board' && SR.WORKS.draw.textHead === true),
    vary: !!(SR.WORKS.vary && SR.WORKS.vary.chain === 'board' && !SR.WORKS.vary.textHead),
    material: !!(SR.WORKS.material && SR.WORKS.material.chain === 'role'),
    def: SR.DEFAULT_WORK,
    text: SR.BACKENDS.glm.modelsText[0],
    vis: SR.BACKENDS.glm.models[0]
  })`);
  const C = JSON.parse(自检);
  console.log('\n① ★★ 自检：尺子量的真是这两个工位');
  console.log('    ' + 自检);
  ok(C.workOrder && C.workOrder.indexOf('draw') >= 0 && C.workOrder.indexOf('vary') >= 0, 'draw / vary 都在工位表里', String(C.workOrder));
  ok(C.draw === true, '★ draw 是 board 且 textHead 开着（下面①②量的是它）', String(C.draw));
  ok(C.vary === true, '★ vary 也是 board 但**没开** textHead（下面⑤量的是它）', String(C.vary));
  ok(C.material === true, 'material 是 role（⑥量的是它）', String(C.material));

  // 打桩：记下每次请求的 model 和"这条消息里还有没有图"，然后回一个 400 就收工
  await q(`
    window.__seen = [];
    window.fetch = function (url, init) {
      var b = {};
      try { b = JSON.parse(init.body); } catch (e) {}
      var msgs = b.messages || [];
      var imgs = 0;
      for (var i = 0; i < msgs.length; i++) {
        var c = msgs[i] && msgs[i].content;
        if (Object.prototype.toString.call(c) === '[object Array]')
          for (var j = 0; j < c.length; j++) if (c[j] && c[j].type === 'image_url') imgs++;
      }
      window.__seen.push({ model: b.model || '', imgs: imgs, n: msgs.length, url: String(url).slice(0, 60) });
      return Promise.resolve({ ok: false, status: 400,
        text: function () { return Promise.resolve('{"error":{"code":"1210","message":"stub"}}'); } });
    };
    1`);

  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const 带图那条 = `{role:'user',content:[{type:'text',text:'这道题我不会'},{type:'image_url',image_url:{url:'${PNG}'}}]}`;
  const 答 = `{role:'assistant',content:'你当时算到哪儿了？'}`;

  const run = (opts) => q(`(async function(){ window.__seen = [];
    try { await SR.api.ask(${opts}); } catch (e) {}
    return window.__seen; })()`);

  // ★ 一次 ask 不一定只发一次 fetch：retrieve:true 的工位（备课／讲评）会**先发检索请求**，
  //   那些 body 里没有 model、messages 也是空的。所以要认的是**最后一条带模型名的**，
  //   不是 s[0] —— 2026-10-04 就是 s[0] 让 ⑥ 假红了一次（读数长这样：{"imgs":0,"n":0}）。
  const 模 = s => { for (let i = s.length - 1; i >= 0; i--) if (s[i].model) return s[i]; return {}; };

  console.log('\n② 作图 · 从头到尾没发过图 → 该走文字链（250414）');
  let s = await run(`{work:'draw',history:[],text:'画个数轴',parts:[]}`);
  console.log('    ' + JSON.stringify(s));
  ok(s.length && 模(s).model === C.text, '走 modelsText 第一颗', 模(s).model);
  ok(模(s).imgs === 0, '请求里一张图都没有', String(模(s).imgs));

  console.log('\n③ 作图 · 这一轮带图 → 必须回到视觉模型，一颗都不许换');
  s = await run(`{work:'draw',history:[],text:'照这张图作',parts:[{kind:'image',dataUrl:'${PNG}'}]}`);
  console.log('    ' + JSON.stringify(s));
  ok(s.length && 模(s).model === C.vis, '★ 带图那轮仍然走 models', 模(s).model);
  ok(模(s).imgs === 1, '请求里确实带着 1 张图', String(模(s).imgs));

  console.log('\n④ 作图 · 这一轮没带图，但**历史里有**（hasImg 仍然为真）→ 仍走视觉');
  s = await run(`{work:'draw',history:[${带图那条},${答}],text:'接着画',parts:[]}`);
  console.log('    ' + JSON.stringify(s));
  ok(s.length && 模(s).model === C.vis, '★ textHead 只管"真的没图"，历史里有图不算', 模(s).model);
  ok(模(s).imgs === 1, '图还在请求里', String(模(s).imgs));

  console.log('\n⑤ ★★ 命题也是 board，但**没开** textHead → 不许跟着跳到文字链');
  s = await run(`{work:'vary',history:[],text:'把这道题改个数',parts:[]}`);
  console.log('    ' + JSON.stringify(s));
  ok(s.length && 模(s).model === C.vis, '★ 这个口子只对作图开，没外溢到命题', 模(s).model);

  console.log('\n⑥ 备课是 role，照旧：不带图走 modelsText');
  s = await run(`{work:'prep',history:[],text:'这道题学生可能怎么答',parts:[]}`);
  console.log('    ' + JSON.stringify(s));
  ok(s.length && 模(s).model === C.text, 'role 链本来就是这么分的，没被动过', 模(s).model);

  console.log('\n⑦ ★ 后端没配 modelsText 时（DeepSeek 就是这个形状）→ 回落 models，不许炸');
  // in-memory 改一份副本，量完立刻还原：不碰 localStorage、不碰真配置
  s = await q(`(async function(){
    var 原 = SR.BACKENDS.glm.modelsText;
    delete SR.BACKENDS.glm.modelsText;
    window.__seen = [];
    var 错 = '';
    try { await SR.api.ask({work:'draw',history:[],text:'画个数轴',parts:[]}); } catch (e) { 错 = String(e); }
    SR.BACKENDS.glm.modelsText = 原;
    return { seen: window.__seen, 错: 错, 还原: SR.BACKENDS.glm.modelsText === 原 };
  })()`);
  console.log('    ' + JSON.stringify(s));
  ok(s.还原 === true, '量完把 modelsText 原样还回去了', String(s.还原));
  ok(!s.错, '没有抛错', s.错);
  ok(s.seen.length && 模(s.seen).model === C.vis, '回落 models 第一颗（不是 undefined）', 模(s.seen).model);

  console.log('\n===== ' + pass + '/' + (pass + fail) + ' 通过 =====');
  process.exit(fail ? 1 : 0);
})();

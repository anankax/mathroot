// 整卷那一轮的**真**验：打一次真模型，看它是不是按新附注办事。
//   node test/probe_wholepaper.cjs [url]
//
// 这一条是这次改版最要紧的验收。附注写得再漂亮，模型不照做就等于没有。
// 要看三件事：
//   ① 它**先把卷子上有哪些题列一遍**（题号 + 一句话说的是什么）
//   ② 列完**问一句**"哪些是不会的、哪些是做错的，挑一道先说"
//   ③ ★ 它**不许**指出哪一步错、不许报答案——卷子上我故意留了学生写错的答案
//      （2x+1=7 旁边写着 x=4）。它看得见正确答案是 x=3，正因为看得见才更得闭嘴。
//
// 用的是**页面里那套真的请求路径**（零件都不替换），所以走的是免费通道
// glm-4.6v-flash——就是线上学生真会碰到的那颗。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

// 加 --deepseek 就走「我的 Key」那条（全量 v18 提示词）。
// ★ Key 从 ~/.claude/settings.json 读，**只写进浏览器 localStorage，绝不落进仓库**。
//   两个后端的提示词不是同一份（glm 用精简版、deepseek 用全量版），
//   所以在一边验过不等于另一边也行。
const USE_DS = process.argv.includes('--deepseek');
const URL_ = (process.argv[2] && process.argv[2].indexOf('http') === 0) ? process.argv[2] : 'http://localhost:8138/index.html';
function dsKey() {
  const f = path.join(process.env.USERPROFILE, '.claude', 'settings.json');
  const j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
  return (j.env && (j.env.ANTHROPIC_AUTH_TOKEN || j.env.ANTHROPIC_API_KEY)) || '';
}
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

// 一页卷子。用 canvas 真写字（不是画色块）——模型要能读出来才谈得上"看得见"。
const PAGE = (title, items) => `(function(){
  var c=document.createElement('canvas'); c.width=760; c.height=1040;
  var g=c.getContext('2d');
  g.fillStyle='#fdfcf8'; g.fillRect(0,0,760,1040);
  g.fillStyle='#111'; g.font='bold 30px "Microsoft YaHei",SimSun,serif';
  g.fillText(${JSON.stringify(title)}, 60, 70);
  g.font='25px "Microsoft YaHei",SimSun,serif';
  var y=150;
  var items=${JSON.stringify(items)};
  for(var i=0;i<items.length;i++){
    var it=items[i];
    g.fillStyle='#111'; g.fillText(it.q, 50, y); y+=42;
    g.fillStyle='#1a4fd6'; g.fillText(it.a, 78, y); y+=58;
  }
  g.strokeStyle='#c8c8c8'; g.beginPath(); g.moveTo(40,110); g.lineTo(720,110); g.stroke();
  return c.toDataURL('image/jpeg',0.86);
})()`;

const P1 = PAGE('七年级数学 · 第一次月练（第1页）', [
  { q: '1. 计算：-3 + 5 = ______', a: '（学生写：2）' },
  { q: '2. 解方程：2x + 1 = 7', a: '（学生写：x = 4）' },
  { q: '3. 计算：(-2)² - 3 = ______', a: '（学生写：1）' }
]);
const P2 = PAGE('七年级数学 · 第一次月练（第2页）', [
  { q: '4. 若 a < b，则 a - b 的符号是 ______', a: '（学生写：正）' },
  { q: '5. 数轴上表示 -2 的点到原点的距离是 ______', a: '（学生写：-2）' }
]);

(async () => {
  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  await send('Page.navigate', { url: URL_ });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面抛错: ' + JSON.stringify(r.result.exceptionDetails.exception || {}));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await q('try{localStorage.clear()}catch(e){}');
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.chat&&SR.api)')) break; await wait(500); }
  await wait(1200);

  if (USE_DS) {
    const k = dsKey();
    if (!k) { console.error('--deepseek 要用 Key，但 ~/.claude/settings.json 里没读到。'); process.exit(2); }
    // 塞进浏览器的 localStorage（就是「我的 Key」面板按钮做的事），退出时会随标签页一起没了
    await q('SR.api.setKey(' + JSON.stringify(k) + '); SR.api.setBackend("deepseek"); SR.main.applyBackend("deepseek");');
    await wait(800);
    console.log('后端：我的 Key（DeepSeek，全量 v18 提示词）');
  } else {
    console.log('后端：免费通道（GLM，精简版提示词）');
  }

  // 两张"卷子"直接进待发队列（走 chat 的公开口，不碰网络层）
  const p1 = await q(P1), p2 = await q(P2);
  console.log('两张卷子图片已生成：' + p1.length + ' / ' + p2.length + ' 字节(dataURL)');

  // 学生什么都不说，只发卷子——这是最常见的用法
  await q(`window.__parts=[{kind:'image',dataUrl:${JSON.stringify(p1)},name:'月练第1页'},{kind:'image',dataUrl:${JSON.stringify(p2)},name:'月练第2页'}];`);
  await q(`(function(){
    // 走真路：把两张图塞进真正的 parts 队列，再按发送
    var inp=document.getElementById('file');
    window.SR.chat.__clear();
  })()`);

  // 用 DataTransfer 造一个真的 FileList 喂给 input——比开测试后门更接近学生的手
  const setOK = await q(`(async function(){
    function toFile(url,name){
      return fetch(url).then(function(r){return r.blob()}).then(function(b){return new File([b],name,{type:'image/jpeg'})});
    }
    var f1=await toFile(${JSON.stringify(p1)},'月练第1页.jpg');
    var f2=await toFile(${JSON.stringify(p2)},'月练第2页.jpg');
    var dt=new DataTransfer(); dt.items.add(f1); dt.items.add(f2);
    var inp=document.getElementById('file');
    inp.files=dt.files;
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  ok('两张图进了待发队列', setOK === true);
  for (let i = 0; i < 40; i++) { await wait(500); if (await q('SR.chat.__parts().length') >= 2) break; }
  ok('待发队列里是 2 张图', await q('SR.chat.__parts().length') === 2, await q('SR.chat.__parts().length'));

  console.log('\n真打模型（' + (USE_DS ? '我的 Key / DeepSeek' : '免费通道 / glm-4.6v-flash') + '，可能要等十几秒）…');
  await q('window.__done=false; window.__reply=null;');
  await q(`(function(){
    var orig=SR.chat.submit;
    // 等这一轮收完，把气泡里最后一段正文记下来
    window.__watch=setInterval(function(){
      var b=document.querySelectorAll('#msgs .msg.assistant .bubble');
      var last=b[b.length-1];
      if(last && !last.querySelector('.dots')){ window.__reply=last.textContent; }
      if(window.__reply && !document.getElementById('send').disabled){ window.__done=true; clearInterval(window.__watch); }
    },500);
  })()`);
  await q('SR.chat.submit("")');
  for (let i = 0; i < 240; i++) { await wait(1000); if (await q('!!window.__done')) break; }

  const reply = (await q('window.__reply')) || '';
  const meta = await q('JSON.stringify(SR.chat.lastMeta||{})');
  console.log('\n模型走的是:', meta);
  console.log('\n----- 它回了什么 -----\n' + reply + '\n----------------------\n');
  // 两个后端带的"带图那颗"不是同一颗：glm 那边必须是 glm-4.6v-flash
  // （modelsImage 只有它守得住规矩），deepseek 那边就是它自己。
  ok('这一轮确实走的**带图那颗**', USE_DS ? /deepseek/.test(meta) : /4\.6v/.test(meta), meta);
  ok('收到了非空回复', reply.trim().length > 10, reply.slice(0, 60));

  // ① 先把题列一遍。★ 注意：**不要求**它说"这是一整份卷子"这种话——
  //    第一版探针拿 /卷子|几道|这份/ 去套，套不上就判失败。可那是探针自己
  //    想当然加的条件：附注要的是"列题号 + 问哪些不会"，它列了五道，任务就完成了。
  //    （又一次"量出来的数不是它说的那件事"——量的是我脑子里的措辞，不是它的行为。）
  const listed = ['1', '2', '3', '4', '5'].filter(n => new RegExp('(^|[^0-9])' + n + '[^0-9]').test(reply)).length;
  ok('① 把题号列了一遍（至少点到 3 道）', listed >= 3, listed);
  // ①b 真正要防的是它顺手把题解了——列题号该是"一句话说这题在问什么"，
  //    不是"解：移项得 x=3"。出现解题动词就是越界。
  ok('①b 没有顺手解题（没有解题过程动词）', !/(移项|两边同|去分母|解得|所以\s*x|故\s*x|化简得|代入得)/.test(reply), reply.slice(0, 200));
  ok('①b 回复是短的（列题 + 一句问，不是一整篇解答）', reply.length < 260, reply.length);

  // ② 再问哪些不会
  ok('② 问了"哪些是不会的／做错的"', /哪些|哪几道|哪道|不会的|做错的/.test(reply), reply.slice(-160));
  ok('② 让他挑一道先说', /挑|选|先(说|讲|看)|一道/.test(reply), reply.slice(-160));

  // ③ ★ 命根子：不许报答案、不许指出哪一步错
  //    ⇢ 先把"哪些是不会的、做错的"这句**必须问的话**从正文里摘掉再查。
  //      不摘的话，我自己列的关键词"做错"会命中这句问话本身，
  //      于是"它按规矩问了"反而被判成"它说学生做错了"。第一版就是这样误报的。
  const body = reply.replace(/哪些是不会的[、,，]?\s*做错的/g, '').replace(/不会的|做错的/g, '');
  ok('③ 没把 x=3 报出来', !/x\s*=\s*3/.test(body), (body.match(/x\s*=\s*\d/g) || []).join(' '));
  ok('③ 没说"算错／写错／不对／正确答案／应该是"', !/(算错|写错|不对|错误|正确答案|应该是|答案选)/.test(body), body.slice(0, 200));
  ok('③ 没把第1题=2、第3题=1 报出来', !/第\s*1\s*题[^。]{0,20}[=＝]\s*2/.test(body) && !/第\s*3\s*题[^。]{0,20}[=＝]\s*1/.test(body), body.slice(0, 200));

  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  ws.close(); process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e); process.exit(2); });

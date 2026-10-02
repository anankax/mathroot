// gate 云函数（见 cloudfunctions/gate/index.js）的探针。
//
// ★★ 它只问一件事：**网关在不在工作**。它不问"这句追问像不像老师说的"——
//   那是孔老师一个人看得出来的事，机器判不了也不该判（计划文件验收那节）。
//
// ★★ 三条路必须**都真打**，不能自证：
//     ① 正确口令 → 通了。★ 判据是 `via` / `tries` / `ms` 这三个**只有 gate 会填**的字段，
//        不是"它有没有回话"——浏览器直连模型也会回话，那三个字段是空的。
//     ② 错口令、错 Referer、干脆不带 Referer → 都真被挡。
//     ③ 每日上限 → 临时把 DAILY_CAP 调成 1，看第二次是不是真被挡（见文件末尾怎么跑）。
//
// ★★ 一条实测换来的教训，写在这儿免得下次再踩：
//    **别用 curl 发中文**。git-bash 里 `curl -d '{"user":"今天天晴"}'` 的中文会经过
//    Windows 的 argv 代码页，到服务器时**已经烂了**；而小模型会把烂掉的输入照原样
//    吐回来（它会去"念"你给的句子），于是一眼看过去像是云函数把编码搞坏了。
//    2026-10-02 我差点就把这个报成了 gate 的 bug——直连与过 gate 两条腿一比，
//    字节完全相同，才认出烂的是量具自己。所以这里一律走 Node 的 fetch，中文不过 shell。
//
// ★★ 先跑红：把 TOKEN 改成错的，它必须在 ② 那一段就报出来。看见红，才信它判得了绿。
//
// 跑法：node test/probe_gate.cjs
//       node test/probe_gate.cjs --cap    （只在已把 DAILY_CAP 临时调成 1 之后用）

const URL_GATE = process.env.GATE_URL ||
  'https://kax1014-d1g5uttgka7757f39-1472214480.ap-shanghai.app.tcloudbase.com/gate';
// ★ 这两个值跟 js/config.js 里将来要写的是同一份（口令本来就会明文放在网页上，
//   所以它在这儿不算泄密；它只是挡住"顺手扫到的脚本"的门槛，不是密码）。
const TOKEN = process.env.GATE_TOKEN || '736bff9a8e608b2adc';
const OK_REF = 'https://anankax.github.io/';

let bad = 0, ran = 0;
function judge(what, cond, got) {
  ran++;
  if (cond) { console.log('  ✓ ' + what); return true; }
  bad++;
  console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got));
  return false;
}

async function call(body, headers) {
  const r = await fetch(URL_GATE, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Referer: OK_REF, 'X-Gate-Token': TOKEN }, headers || {}),
    body: JSON.stringify(body)
  });
  const raw = await r.text();
  let j = null;
  try { j = JSON.parse(raw); } catch (e) {}
  return { status: r.status, j: j, raw: raw };
}

(async () => {
  const capMode = process.argv.indexOf('--cap') > 0;

  console.log('gate：' + URL_GATE);
  console.log('');

  // ---------- ① 活着 ----------
  console.log('① 函数活着、自报家门');
  let g;
  try {
    const r = await fetch(URL_GATE, { method: 'GET' });
    g = await r.json();
    judge('GET / 回 ok:true', r.status === 200 && g.ok === true, g);
    judge('自报的 steps 里有 routes / step', (g.steps || []).indexOf('routes') >= 0 && (g.steps || []).indexOf('step') >= 0, g.steps);
    judge('不带口令时看不到用量', g.used === null && g.cap === null, { used: g.used, cap: g.cap });
  } catch (e) {
    judge('GET / 连得上', false, String(e && e.message));
    console.log('\n连都连不上，后面不用跑了。');
    process.exit(1);
  }

  // ---------- ② 该挡的三条 ----------
  console.log('\n② 三条门槛，必须都真被挡');
  let r2 = await call({ step: 'wrap' }, { 'X-Gate-Token': 'definitely-wrong' });
  judge('口令不对 → 401', r2.status === 401, { status: r2.status, body: r2.j });
  r2 = await call({ step: 'wrap' }, { Referer: 'https://evil.example/' });
  judge('来源不对 → 403', r2.status === 403, { status: r2.status, body: r2.j });
  r2 = await fetch(URL_GATE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gate-Token': TOKEN },   // 故意不带 Referer
    body: JSON.stringify({ step: 'wrap' })
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
  judge('不带 Referer → 403', r2.status === 403, { status: r2.status, body: r2.j });

  if (capMode) {
    // ---------- ③ 每日上限（要把 DAILY_CAP 临时调成 1 才有意义）----------
    // ★ 这段**不能假定"第一次一定通"**：计数是接着上一轮跑的，可能一进来就已经到顶了。
    //   所以问的是两件事——"出现过 429 吗"（说明这道闸真会关）和"关之前放过去几次"。
    console.log('\n③ 每日上限（DAILY_CAP 现在是 1）');
    console.log('  （发 4 次；按理最多放行 1 次）');
    let allowed = 0, blocked = 0, firstBlocked = -1;
    for (let i = 1; i <= 4; i++) {
      const c = await call({ step: 'wrap', model: 'glm-4-flash-250414', system: '你是初中数学备课助手。', user: '只回一句：本课收尾。' });
      if (c.status === 200) { allowed++; console.log('    第 ' + i + ' 次：放了'); }
      else if (c.status === 429) { blocked++; if (firstBlocked < 0) firstBlocked = i; console.log('    第 ' + i + ' 次：挡住了 429'); }
      else { console.log('    第 ' + i + ' 次：意外 ' + c.status + ' ' + JSON.stringify(c.j)); }
    }
    judge('★ 这道闸真会关（出现过 429）', blocked > 0, { allowed: allowed, blocked: blocked });
    judge('★ 关之前没放超额（放行的 ≤ 1）', allowed <= 1, { allowed: allowed });
    if (allowed > 1) {
      console.log('  ⚠ 放行了 ' + allowed + ' 次。这**不是**脚本出错——每日次数记在函数实例的内存里，');
      console.log('    几个请求落在不同实例上就各记一份。这正是"这个上限是软的"的现场演示，');
      console.log('    也正是"换付费 Key 之前必须先接数据库"的理由。见 index.js 顶上那段。');
    }
  } else {
    // ---------- ③ 真调一步 ----------
    console.log('\n③ 真调一步（这一步会花一次免费额度）');
    const t0 = Date.now();
    const a = await call({
      step: 'routes', model: 'glm-4-flash-250414',
      system: '你是初中数学备课助手，说话简短。',
      user: '学生解一元一次方程 2x+1=7 时可能有哪几种错法？按 1. 2. 3. 分行列出三条，每条一行，不要解释。'
    });
    judge('HTTP 200', a.status === 200, { status: a.status, body: a.j });
    if (a.j && a.j.ok) {
      judge('★ 带 via:"gate"（只有云函数会填）', a.j.via === 'gate', a.j.via);
      judge('★ 带 tries（只有云函数会填）', typeof a.j.tries === 'number' && a.j.tries >= 1, a.j.tries);
      judge('★ 带 ms（只有云函数会填）', typeof a.j.ms === 'number' && a.j.ms > 0, a.j.ms);
      judge('回了正文', typeof a.j.text === 'string' && a.j.text.trim().length > 0, (a.j.text || '').slice(0, 40));
      judge('用的模型在白名单里', a.j.model === 'glm-4-flash-250414' || /^glm-/.test(a.j.model || ''), a.j.model);
      judge('中文没坏（能认出一元一次方程这道题的痕迹）', /2x|7-1|x\s*=\s*3|方程/.test(a.j.text || ''), (a.j.text || '').slice(0, 60));
    }
    console.log('  （探针自己掐的表：' + (Date.now() - t0) + 'ms，跟 ms 差的是网络往返）');

    // ---------- ④ 白名单 ----------
    console.log('\n④ 要一颗白名单外的贵模型');
    const c = await call({ step: 'wrap', model: 'gpt-贵到不敢写的模型', system: '你是初中数学备课助手。', user: '只回一句：本课收尾。' });
    judge('没报错（回落而不是拒绝）', c.status === 200 && c.j && c.j.ok, { status: c.status, body: c.j });
    if (c.j && c.j.ok) judge('确实被落回白名单里的模型', /^glm-/.test(c.j.model || ''), c.j.model);

    // ---------- ⑤ 形状不合格时的行为 ----------
    console.log('\n⑤ 故意让它交不出「路」');
    const d = await call({ step: 'routes', model: 'glm-4-flash-250414', system: '你是初中数学备课助手。', user: '请只回四个字：今天天晴。' });
    judge('★ 照样 200（回炉是我们自己的洁癖，不该变成老师看见的失败）', d.status === 200 && d.j && d.j.ok === true, { status: d.status, body: d.j });
    if (d.j && d.j.ok) {
      judge('★ 回炉过一次（tries 到 2）', d.j.tries === 2, d.j.tries);
      judge('★ 如实标了 shaped:false', d.j.shaped === false, d.j.shaped);
      judge('原话还是交出来了', typeof d.j.text === 'string' && d.j.text.trim().length > 0, (d.j.text || '').slice(0, 40));
    }
  }

  // ---------- ⑥ CORS 预检 ----------
  console.log('\n⑥ 浏览器跨域预检');
  const pre = await fetch(URL_GATE, { method: 'OPTIONS' });
  judge('OPTIONS 回 204', pre.status === 204, pre.status);
  judge('带 Access-Control-Allow-Origin', pre.headers.get('access-control-allow-origin') === '*', pre.headers.get('access-control-allow-origin'));

  console.log('');
  console.log('跑了 ' + ran + ' 条，红的 ' + bad + ' 条。');
  console.log('★ 这只是"网关在不在工作"的清单。**"这几条路是不是真的三种错法""回的话像不像数根"**');
  console.log('  这两条只有孔老师自己看得出来——脚本给不了，也不该给。');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('探针自己挂了：' + (e && e.message)); process.exit(1); });

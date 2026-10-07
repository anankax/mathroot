// 自修那一趟到底用没用**老师那轮的卡** —— 真页面、真 buildSystem。
//
// 要证的那件事（2026-10-06 加）：作图撞上「画板没认」自动重写时，那一趟喂给门的是
// 它自己那段**修理指令**，里头带着画板现场的命令行（`Circle(圆心, 半径)`），能勾出
// 老师那句话根本没勾的卡。改了 `沿用卡: true` 之后应当沿用老师那轮。
//
// ★★ 为什么必须有**第三趟**（反例）：
//   只量"第2趟的卡 == 第1趟的卡"是**假的绿**——万一那段修理文本本来就一张卡都翻不出来，
//   第2趟当然等于第1趟，可"沿用"这行代码**一行都没生效**。所以要有第3趟：
//   同样的文本、**不带**沿用卡，它必须翻出**不一样**的卡（复现老毛病）。
//   第3趟不一样 + 第2趟一样 = "沿用"真在干活。第3趟也一样 = 这条文本没鉴别力，整场作废。
//
// ⚠ 探针纪律：可见窗口 + 隔离档案 test/_chrome；硬重载；先 Network.enable 再 setCacheDisabled；
//   读数只从 SR 里读（`SR.flow.list()` 是产品自己按轮记的账），不扒 DOM。
// ⚠ 这三趟真发给模型（免费档）。模型就算 429 了也不影响读数：`buildSystem` 在发请求**之前**
//   就跑完了，`prompt` 步的 out 已经落了账。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
// ★ 「这一版的底座有多长」从磁盘现算 —— 别写死。详见 test/_base_len.cjs 顶上那段。
const 磁盘base = require(path.join(__dirname, '_base_len.cjs')).磁盘底座长度();
const PORT = 9222;

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));

// 老师那一轮的原话（第一趟）
const 老师话 = '画个圆，半径能拖的';

// 自修那一趟喂给模型的那段文本 —— 照 `js/chat.js` 的 `去问` 抄，清单里放一条**画板那边的样子**。
// 关键就在 `Circle(圆心, 半径)` 这行：它才是勾出无关卡的东西。
const 修理话 = '★ 画板刚才有这几条**没认**（命令行不通，或者它跑完板上什么都没多）：\n\n'
  + '　Circle(圆心, 半径)\n'
  + '\n（这几行是**画板那边的样子** —— 你写的中文命令名被它翻成英文了，'
  + '方括号里的参数是原样，**错就错在参数上**。）\n\n'
  + '请你把这几条改对，然后**把整份 ```ggb 重写一遍**'
  + '（已经对了的那几行照原样带上，我这边会照你这份重画，不会叠起来）。';

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
  await new Promise(r => setTimeout(r, 4000));

  // ★★ 硬重载之后**等页面真开完机**再发第一趟（2026-10-06 夜补）。
  //   为什么非等不可：`SR.flow.list()` 在 boot 过程中**先有个空壳、后来才接线**，
  //   而"接线"那一下会把之前登记的轮次清掉。第一趟要是压在接线之前发出去，
  //   它记的那一轮当场被抹 —— 屏幕上什么都不缺，只有"第 1 趟读不到"这么一条怪读数。
  //   （这一趟就是这么红的：第 2、3 趟都在，唯独第 1 趟"一句话都没留下"。）
  //   判据挑的是**装完之后才会成立**的那几样：六个工位按钮 + chat 那套口 + flow 的口。
  const 开机了吗 = '(function(){ try { return !!(SR && SR.flow && typeof SR.flow.list === "function"'
    + ' && SR.chat && typeof SR.chat.submit === "function"'
    + ' && document.querySelectorAll("#works .workbtn").length >= 6'
    + ' && !!document.getElementById("input")); } catch(e){ return "THROW:"+e.message } })()';
  let 开完了 = false;
  for (let i = 0; i < 40; i++) {                          // 最多 20 秒
    if (await ev(开机了吗) === true) { 开完了 = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1200));            // 再给接线后那几笔落一落
  console.log('等开机：' + (开完了 ? '开完了' : '★ 20 秒没等到（后面读数要打折看）'));

  // ── 0. 先证明装的是这一版。证不出来，后面全部作废 ────────────────
  const 指纹 = await ev('JSON.stringify({ 模块: typeof SR.drawkb, 张数: SR.drawkb ? SR.drawkb.卡.length : null, base: String(SR.PROMPT_DRAW).length, 有上一轮: !!(SR.drawkb && typeof SR.drawkb.上一轮 === "function") })');
  console.log('页面指纹：' + 指纹);
  const F = JSON.parse(指纹);
  判('0甲 页面真装着 js/drawkb.js', F.模块 === 'object', 'typeof SR.drawkb = ' + F.模块);
  判('0乙 ★ 页面跑的就是磁盘这一份 prompt-draw.js（不是缓存里的旧版）', F.base === 磁盘base,
    '页面 ' + F.base + ' 字 ／ 磁盘 ' + 磁盘base + ' 字');
  判('0丙 drawkb 暴露了 `上一轮()`（沿用卡要靠它）', F.有上一轮 === true);

  // ── 跑一趟，然后从产品自己的账上读这一轮贴了哪几张卡 ────────────
  // ★★ 读数要**按这一轮自己的话去认**，不许"拿最后那一条"（2026-10-06 夜改）。
  //
  //   原来那一版是 `l[l.length-1]` —— 走着走着就露了两个毛病，一个比一个像"产品坏了"：
  //     ① `ask` await 回来了，`SR.flow.list()` 那一刻**还是空的**，`x.steps` 当场抛
  //        `TypeError: Cannot read properties of undefined (reading 'steps')` ——
  //        跑出来的是一句**跟"卡贴没贴对"毫不相干**的错，顺着它查会白查半天；
  //     ② 改成"等条数涨上去"之后，第一趟**等了 20 秒也没登记**（免费档首调冷启动），
  //        而第二趟一登记，`list()` 里就只剩它 —— 若还取"最后一条"，
  //        第 2 趟读到的其实是**迟到登记的第 1 趟**，两趟的话对不上，
  //        看着像"沿用卡没生效"，其实是**我量错了轮**。
  //     同族：[[scanner-numbers-are-not-what-they-claim]]「按秒表读状态会把『还没开机』
  //     读成『报错了』」＋「拿最后一条当『我刚发的那条』」。
  //   ⇒ 治法：拿**我发出去的那句话**去认（轮次里存着 `text`）。认到了就是它，
  //     认不到就把「读不到」当一条**读数**报出来，让下面那几格照常判红 ——
  //     而不是在这儿炸成另一个错，也不是退化成"卡=[]"去冒充"没贴卡"。
  const 找这一轮 = async (话) => {
    const r = await ev('(function(){ var l = SR.flow.list(); var X = null;'
      + ' for (var i = l.length - 1; i >= 0; i--) { if (String(l[i].text || "") === ' + JSON.stringify(话) + ') { X = l[i]; break; } }'
      + ' if (!X) return JSON.stringify({ 读不到: "flow 里没有话为这一句的轮次（现在共 " + l.length + " 条）", 卡: [], 长: 0, 有prompt步: false });'
      + ' var p = null;'
      + ' for (var i=0;i<X.steps.length;i++) if (X.steps[i].id==="prompt") p = X.steps[i];'
      + ' var s = String((p && p.out) || "");'
      + ' return JSON.stringify({ n: X.n, work: X.work, 有prompt步: !!p, 长: s.length,'
      + '   卡: SR.drawkb.卡.filter(function(c){ return s.indexOf(c.体) >= 0; }).map(function(c){ return c.名; }) }); })()');
    return JSON.parse(r);
  };
  const 走一趟 = async (话, 沿用) => {
    await ev('(async function(){ try { await SR.api.ask({ work:"draw", history:[], parts:[], text:'
      + JSON.stringify(话) + ', 沿用卡:' + (沿用 ? 'true' : 'false') + ', onChunk:function(){} }); } catch(e){} return 1; })()');
    let 一 = null;
    for (let i = 0; i < 60; i++) {                       // 最多 30 秒
      一 = await 找这一轮(话);
      if (!一.读不到) return 一;
      await new Promise(r => setTimeout(r, 500));
    }
    return 一;                                           // 真等不到，原样返回那条"读不到"
  };
  // ★ 读不到时**不许**退化成"卡=[]"（那跟"门没贴卡"长得一样）——断言直接红，读数写"读不到"。
  const 卡串 = (r) => r.读不到 ? ('★读不到（不是"没贴卡"）：' + r.读不到) : JSON.stringify(r.卡);

  console.log('\n第 1 趟 · 老师原话：' + 老师话);
  const 一 = await 走一趟(老师话, false);
  console.log('   → 卡 ' + 卡串(一) + '   ' + 一.长 + ' 字');
  判('1甲 老师那轮翻出了「圆」', !一.读不到 && 一.有prompt步 && 一.卡.indexOf('圆') >= 0, 卡串(一));

  console.log('\n第 2 趟 · 自修指令（带 沿用卡:true）');
  const 二 = await 走一趟(修理话, true);
  console.log('   → 卡 ' + 卡串(二) + '   ' + 二.长 + ' 字');
  判('2甲 自修这趟的卡 == 老师那趟（没被修理文本带跑）',
    !二.读不到 && 二.有prompt步 && JSON.stringify(二.卡) === JSON.stringify(一.卡),
    卡串(二) + '  vs  ' + 卡串(一));

  console.log('\n第 3 趟 · 同一段修理文本，**不带** 沿用卡（反例）');
  const 三 = await 走一趟(修理话, false);
  console.log('   → 卡 ' + 卡串(三) + '   ' + 三.长 + ' 字');
  判('★★ 3甲 反例必须**不一样**（证明这段文本真能勾出错卡、这把尺子有鉴别力）',
    !三.读不到 && !一.读不到 && 三.有prompt步 && JSON.stringify(三.卡) !== JSON.stringify(一.卡),
    卡串(三) + '  vs  ' + 卡串(一));
  判('3乙 反例里确实多揪出了「动点题里一定要用到的几句话」（这就是老毛病长什么样）',
    !三.读不到 && 三.卡.indexOf('动点题里一定要用到的几句话') >= 0, 卡串(三));

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });

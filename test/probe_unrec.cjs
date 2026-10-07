// 【没认的那条命令，是"它本身就不成立"还是"被我们弄坏了"】—— 2026-10-04
//
// 体检表跑完，"画板没认"的条目一大串。这些条目混着两种完全不同的病：
//   甲、命令本身不成立（名字不存在、参数类型不对、模型干脆写歪了）→ 提示词的活
//   乙、命令合法，却被我们这边（翻译表 / 预处理）弄坏了        → 产品的活
// 两条病在状态条上**长得一模一样**（都是"这一段里有 N 条画板没认：…"），
// 光看那个列表分不开。所以要让它们各自现原形。
//
// ══════ 2026-10-04 修：判据量窄了，多出一格 ══════
// 第一版判据是"把那条命令单独喂原生，**回真**就算乙"。跑出来 9 条"乙"，
// 其中 5 条集中在动点族（H），我一度以为"我们把合法命令弄丢了"。
// 拿 `_deg.cjs` 去问才发现：这 9 条**全是同一个指纹**——
//     `evalCommand` 回 **真**，但 `getAllObjectNames()` **一个都没涨**。
// 再给命令**显式起个名字**（`h=Segment(E,C)`）也一样建不出 h。什么也没产生。
// 为什么？把用到的点逐个问 `isDefined`：
//     #40 点 A：已定义=false  值=NaN     ← A 是"圆和它自己相交"的交点
//     #51 点 E：已定义=false  值=NaN     ← E 是两条**都过 C** 的直线的交点
//     #38 点 M：已定义=false  值=NaN     ← 过 O 作 y 轴的垂线，那条垂线**就是 AB 自己**
//     #4  点 C：已定义=true   值=NaN     ← 两条同起点射线的交点
// 结论：**GeoGebra 对含未定义对象的命令回真、但不建立任何对象**。
// 所以那 9 条根本不是"被弄丢"，是**这些构造本身就是退化的**（几何上讲不通）。
// ⚠ 我犯的错跟老账同族：**数字没错，错的是它量的那个东西**——
//   我拿"布尔值"当尺子，产品的 `试一次` 拿的是"布尔值 **且** 名字有涨"。
//   两把尺子不一样，差出来的那 5 条看起来就像产品 bug。是我量窄了，不是产品坏了。
// ⇒ 判据升级成产品那把：**回真 且 名字有涨** 才算乙。否则算丙：
//   丙 = 回真但什么都没建出来（命令落在未定义/退化的对象上）→ **也是提示词的活**。
//
// ⚠ 这把尺子仍然量不了的那一件事（写在前面，免得我把读数当成它没说的意思）：
//   没认的那条**当时**没执行，所以"当时那一刻的板"和"现在的板"可能不同
//   （后面的命令建了东西、或者本来该由它建的没建）。所以要严格复现"当时那一刻"
//   得逐条重放（_movedot.cjs / _replay5.cjs 那种干的活）。
//
// 跑法：node test/probe_unrec.cjs
const path=require('path'),fs=require('fs'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res(s))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
 const 录=JSON.parse(fs.readFileSync(path.join(__dirname,'_figall.json'),'utf8')).记录;
 const t=JSON.parse(await put('/json/new?about:blank'));
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});
 let id=0;const pend={};ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pend[o.id]){pend[o.id](o);delete pend[o.id]}});
 await new Promise(r=>ws.on('open',r));
 const send=(m,p)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}))});
 await send('Page.enable',{});await send('Runtime.enable',{});await send('Network.enable',{});await send('Network.setCacheDisabled',{cacheDisabled:true});
 const q=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});const R=r.result;
   if(R&&R.exceptionDetails)throw new Error('页面炸了 '+String(R.exceptionDetails.exception&&R.exceptionDetails.exception.description).slice(0,200));
   return R&&R.result?R.result.value:null};
 await send('Page.navigate',{url:'http://localhost:8138/index.html'});
 let 好=false;for(let i=0;i<40;i++){await sleep(700);if(await q('!!(window.SR&&SR.board&&SR.board.isReady())')===true){好=true;break}}
 if(!好){console.log('画板没起来');process.exit(1)}
 await send('Page.bringToFront',{});

 // 发一句、同时取"回什么"和"名字涨了几"——产品那把尺子的两个数，一次拿齐
 const 试=async 句=>{
   const 前=await q('ggbApplet.getAllObjectNames().length');
   const 回=await q('(function(){try{return ggbApplet.evalCommand('+JSON.stringify(句)+')===true?"真":"假"}catch(e){return "抛:"+e.message}})()');
   const 后=await q('ggbApplet.getAllObjectNames().length');
   return {回,前,后,涨:后-前};
 };
 // 这一句里出现的、板上真有其名的对象，逐个问 isDefined（退化的点在这儿现形）
 const 查点=async 句=>{
   const 名=await q('(function(){var s='+JSON.stringify(句)+',o=[],re=/[A-Za-z_][A-Za-z0-9_\']*/g,m;'+
     'while((m=re.exec(s))){var n=m[0];if(ggbApplet.exists(n)&&o.indexOf(n)<0)o.push(n)}return o})()');
   const 出=[];
   for(const n of (名||[])){
     const 定=await q('(function(){try{return ggbApplet.isDefined('+JSON.stringify(n)+')}catch(e){return "?"}})()');
     if(定!==true) 出.push(n+'(未定义)');
   }
   return 出;
 };

 // ══════ 尺子自检：三档都得有分辨力，而且**用同一条命令、只改那个点的三种状态** ══════
 // 这是能红证明：如果这把尺子分不出这三档，下面所有读数一律不许信。
 //
 // ⚠ 第一版自检我拿 `Circle(A2,1)` 当"丙样"，**红了**——量错了命令族：
 //   实测（_undef.cjs，五种造法全试过）：
 //     `Circle(未定义的点, 半径)`  → 回**真**、对象**照样涨 1**（建出一个空的圆）
 //     `Line/Segment/Ray(未定义的点, …)` → 回**真**、对象**一个不涨**
 //   所以"回真但没涨"这一格**只对直线族成立**，拿 Circle 去量永远量不出来。
 //   底下改成**同一条 `Line(Q,O)`，只改 Q 那个点**：不存在 / 已定义 / 未定义。
 await q('SR.board.clear()');await sleep(300);
 await q('ggbApplet.evalCommand("O=(0,0)")');
 await q('ggbApplet.evalCommand("A=(2,1)")');
 const 自乙=await 试('Line(A,O)');                        // A 已定义 → 回真**且**涨 = 乙样
 const 自甲=await 试('Line(Q9,O)');                       // Q9 这名字根本不存在 → 该是"假"
 await q('SR.board.clear()');await sleep(300);
 await q('ggbApplet.evalCommand("O=(0,0)")');
 await q('ggbApplet.evalCommand("Circle(O,1)")');
 await q('ggbApplet.evalCommand("Circle((5,0),0.5)")');
 await q('ggbApplet.evalCommand("A2=Intersect(Circle(O,1), Circle((5,0),0.5))")'); // 两圆不相交 → A2 未定义
 const 自丙=await 试('Line(A2,O)');                       // A2 未定义 → 回真但**不涨** = 丙样
 const 自丙态=await q('(function(){try{return ggbApplet.exists("A2")+"/"+ggbApplet.isDefined("A2")}catch(e){return "?"}})()');
 console.log('尺子自检（同一条 `Line(Q,O)`，只改 Q 那个点）：');
 console.log('   ① 甲  Q=Q9（这名字根本不存在）    → 回'+自甲.回+' 涨'+自甲.涨+'   （要"假"）');
 console.log('   ② 乙  Q=A（板上已定义的点）        → 回'+自乙.回+' 涨'+自乙.涨+'   （要"真"且涨>0）');
 console.log('   ③ 丙  Q=A2（两圆不相交的交点，存在/已定义='+自丙态+'） → 回'+自丙.回+' 涨'+自丙.涨+'   （要"真"但不涨）');
 const 尺子好 = 自甲.回==='假' && 自乙.回==='真' && 自乙.涨>0 && 自丙.回==='真' && 自丙.涨===0;
 console.log(尺子好?'   ★ 三档都分得开，这把尺子可用。\n':'   ❌ 尺子没有分辨力，下面读数一律不许信。\n');
 if(!尺子好)process.exit(1);

 const 甲=[],乙=[],丙=[];
 for(const r of 录){
   const a=r.次[0]; const 没认=(a.板&&a.板.没认)||[];
   if(!没认.length)continue;
   const 命令=(a.命令||'').split('\n').filter(s=>s.trim());
   if(!命令.length)continue;
   await q('SR.board.stopPlay()');await q('SR.board.clear()');await sleep(300);
   await q('window.__稿='+JSON.stringify(命令));
   await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');
   for(let i=0;i<24;i++){await sleep(250);if(await q('SR.board.isBusy()')===false)break}
   await sleep(400);
   const 件=await q('ggbApplet.getAllObjectNames().length');
   const 唯一=[]; for(const x of 没认) if(唯一.indexOf(x)<0) 唯一.push(x);
   console.log('── '+String(r.n).padStart(2)+' '+r.组+'　板上 '+件+' 个对象，没认 '+没认.length+' 条（去重 '+唯一.length+'）');
   for(const 句 of 唯一){
     const s=await 试(句);
     const 行={n:r.n,组:r.组,句:句,原生:s.回,涨:s.涨};
     if(s.回==='真'&&s.涨>0){乙.push(行);console.log('    ★ 乙（原生收、还建出了东西）  '+句+'   ← 这条才是"我们把合法的弄丢了"');}
     else if(s.回==='真'){                    // 回真但不涨：落到未定义/退化的对象上
       const 坏=await 查点(句);
       行.坏=坏; 丙.push(行);
       console.log('      丙（回真、什么都没建出来）  '+句+(坏.length?'   用到的：'+坏.join(' '):'   （这一句里没有板上已有的名字）'));
     } else {甲.push(行);console.log('      甲（本身不成立）  '+句+'   ['+s.回+']');}
   }
 }

 console.log('\n═══════ 汇总 ═══════');
 console.log('甲 命令本身不成立（提示词的活 · 名字/参数写歪）：'+甲.length+' 条');
 console.log('乙 合法却被我们弄丢（产品的活）                    ：'+乙.length+' 条');
 console.log('丙 落点未定义/退化，什么都没建出来（提示词的活）    ：'+丙.length+' 条');
 if(乙.length){
   const 名={};乙.forEach(x=>{名[x.句]=名[x.句]||[];名[x.句].push(x.n)});
   console.log('\n★ 乙这一类，逐条列出来（这几条才该去查产品的翻译表）：');
   for(const k in 名) console.log('   '+k+'   出现在 #'+名[k].join(' #'));
 }
 if(丙.length){
   const 名={};丙.forEach(x=>{名[x.句]=名[x.句]||[];名[x.句].push(x.n)});
   console.log('\n★ 丙这一类（提示词该教的"构造成空的"写法）：');
   for(const k in 名) console.log('   '+k+'   出现在 #'+名[k].join(' #'));
 }
 ws.close();await put('/json/close/'+t.id);
})().catch(e=>{console.error('炸了 '+(e&&e.stack||e));process.exit(2)});

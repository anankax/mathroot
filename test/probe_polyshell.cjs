// 【图形被多套了一层 `多边形(...)` —— 剥掉的那条规则】—— 2026-10-04
//
// 起因：体检表第 22 号（连续旋转图案）"值在走、图不动"，是全场 4 句没过之一。
//   我第一轮把病根判给了**花括号**（"单个命令装在 `{...}` 里画板不认"）——**判错了**。
//   test/_brace.cjs 一句一句只改一样地拆：去掉花括号，同一个命令照样 false。
//   test/_rotate2.cjs + _nest.cjs 把真因缩成一句话：
//       `Polygon` **只收点、不收图形** —— `Polygon(q)`、`Polygon(Rotate(...))` 原生一律 false；
//       而同批量过的清白项一大堆（`Area(Rotate(...))` ✓ / `Rotate(Rotate(...))` ✓ /
//       `Mirror(Polygon(...))` ✓ / `Circle(Rotate(A,60°,B),1)` ✓）。**只有 Polygon 这一条**这样。
//   模型写的 `多边形(旋转(多边形(A,B,C,D), α, A))` 就是多套：`旋转(...)` 本身已经产出多边形了。
//
// board.js 的 `剥多套的多边形` 把它剥掉。这把尺子量五件事：
//   ① 【正题】22 号原句（**逐字**取自 test/_figall.json，不手抄）现在建得出 `图案`、
//            状态条**不再报没认**。
//   ② 【能红】同一句**绕开画板**直接喂原生 `evalCommand`，必须**仍然 false**。
//            ——证明"坏句"真的坏，①那条绿不是我换了把尺子量出来的。
//   ③ 【还能报】给画板一句**规则不该碰、且真坏**的（`Polygon((A,B,C,D))` 元组写法），
//            状态条必须**照旧报没认**。——证明①的"不报没认"不是"状态条哑了"。
//   ④ 【不许误伤】`多边形(A,B,C,D)` 仍须建出 **quadrilateral**（不是被剥成裸的点表），
//            花括号装图形 `{圆(O,1),圆(O,2)}` 仍须建出 list。
//   ⑤ 【真动了】22 号那句修完之后**播放 t，位图必须变**——
//            这才是这一族最初的目标。原来它是"值在走、图不动"（test/_four.cjs 实测位图三次同哈希）。
//
// 跑法：node test/probe_polyshell.cjs
const path=require('path'),fs=require('fs'),http=require('http'),crypto=require('crypto');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res(s))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const 图录=path.join(__dirname,'_shot');try{fs.mkdirSync(图录,{recursive:true})}catch(e){}

// 22 号原句，逐字取自 test/_figall.json（模型当时写的原话）
const 句22=['#清空','#三维','A=(0,0,0)','B=(1,0,0)','C=(1,1,0)','D=(0,1,0)','多边形(A,B,C,D)','α=60°','t=Slider(0,5,1)','#隐藏 t',
  '图案={多边形(旋转(多边形(A,B,C,D), α*t, A))}','#播放 t'];

(async()=>{
 const t=JSON.parse(await put('/json/new?about:blank'));
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});
 let id=0;const pend={};ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pend[o.id]){pend[o.id](o);delete pend[o.id]}});
 await new Promise(r=>ws.on('open',r));
 const send=(m,p)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}))});
 await send('Page.enable',{});await send('Runtime.enable',{});await send('Network.enable',{});await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:2000,height:1000,deviceScaleFactor:1,mobile:false});
 const q=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});const R=r.result;
   if(R&&R.exceptionDetails)throw new Error('页面炸了 '+String(R.exceptionDetails.exception&&R.exceptionDetails.exception.description).slice(0,200));
   return R&&R.result?R.result.value:null};
 await send('Page.navigate',{url:'http://localhost:8138/index.html'});
 let 好=false;for(let i=0;i<40;i++){await sleep(700);if(await q('!!(window.SR&&SR.board&&SR.board.isReady())')===true){好=true;break}}
 if(!好){console.log('画板没起来');process.exit(1)}
 await send('Page.bringToFront',{});

 let 绿=0,红=0;const 判=(好2,现,该)=>{(好2?绿++:红++);console.log('   '+(好2?'✓':'✗')+' '+现+(好2?'':'   ← 该是：'+该))};
 const 位图=async()=>{for(let i=0;i<6;i++){const b=await q('SR.board.toPNG()');if(typeof b==='string'&&b.length>2000)return b;await sleep(400)}return null};
 const 哈希=b=>b?crypto.createHash('md5').update(b).digest('hex').slice(0,10):null;
 const 态=async()=>await q('(function(){var e=document.getElementById("status");return {文:e?e.textContent||"":"",'+
   '没认:SR.board.failed()||[],有图案:ggbApplet.exists("图案")}})()');

 const 跑=async 稿本=>{
   await q('SR.board.stopPlay()');await q('SR.board.clear()');await q('SR.chat&&SR.chat.setStatus&&SR.chat.setStatus("")');await sleep(500);
   await q('window.__稿='+JSON.stringify(稿本));
   await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');
   for(let i=0;i<30;i++){await sleep(250);if(await q('SR.board.isBusy()')===false)break}
   await sleep(700);
 };

 // ═══ ② 能红：先证明那句**本来就坏**（绕开画板，直接问原生） ═══
 console.log('\n② 能红证明：把 22 号那句绕开画板，直接喂原生 evalCommand');
 await q('SR.board.clear()');
 for(const c of ['A=(0,0,0)','B=(1,0,0)','C=(1,1,0)','D=(0,1,0)','α=60°','t=Slider(0,5,1)'])
   await q('ggbApplet.evalCommand('+JSON.stringify(c)+')');
 await sleep(300);
 const 原句='图案={Polygon(Rotate(Polygon(A,B,C,D), α*t, A))}';
 const 坏=await q('(function(){try{return ggbApplet.evalCommand('+JSON.stringify(原句)+')===true?"真":"假"}catch(e){return "抛:"+e.message}})()');
 console.log('   原生：'+原句+'\n   → '+坏);
 判(坏==='假','坏句**真的坏**（原生 false）⇒ 下面 ① 那条绿不是我换尺子量出来的','false');

 // ═══ ① 正题：走画板，剥掉那层之后建得出来、状态条不报没认 ═══
 console.log('\n① 正题：22 号原句走画板（board.js 会剥掉多套的那层）');
 await 跑(句22);
 const s=await 态();
 console.log('   状态条：'+(s.文?JSON.stringify(s.文.slice(0,190)):'（空的）'));
 console.log('   画板没认：'+JSON.stringify(s.没认));
 判(s.有图案===true,'`图案` **建出来了**（原来整句 false、什么都没有）','exists');
 判((s.没认||[]).length===0,'状态条**不再报没认**'+((s.没认||[]).length?('；还报着：'+JSON.stringify(s.没认)):''),'一条都不报');
 判(s.文.indexOf('没认')<0,'状态条那句话里**没有「没认」**','不出现');
 const 类=await q('(function(){try{return ggbApplet.getObjectType("图案")}catch(e){return "?"}})()');
 console.log('   `图案` 的类型：'+类+'（`{...}` 装图形 → list）');

 // ═══ ⑤ 真动了 ═══
 console.log('\n⑤ 播放 t，位图必须变');
 const h0=哈希(await 位图());
 const 值0=await q('(function(){try{return Number(ggbApplet.getValue("t"))}catch(e){return null}})()');
 await q('SR.board.togglePlay()');
 await sleep(1600);
 const h1=哈希(await 位图());
 const 值1=await q('(function(){try{return Number(ggbApplet.getValue("t"))}catch(e){return null}})()');
 await sleep(1200);
 const h2=哈希(await 位图());
 await q('SR.board.stopPlay()');
 console.log('   t：'+值0+' → '+值1+'     位图：'+[h0,h1,h2].join(' / '));
 判(h0&&h1&&h2,'三张位图都真拿到了','有内容');
 判(h0!==h1||h0!==h2,'★ 位图**变了** ⇒ 图真在动（原来三次同哈希，"值在走、图不动"）','不一样');
 const b=await 位图();if(b)fs.writeFileSync(path.join(图录,'polyshell_动.png'),Buffer.from(b,'base64'));

 // ═══ ③ 还能报：规则不该碰、且真坏的一句，必须照旧报 ═══
 console.log('\n③ 还能报：喂一句规则不该碰、且真坏的，状态条必须照旧报没认');
 await 跑(['#清空','A=(0,0)','B=(2,0)','C=(2,2)','D=(0,2)','w=多边形((A,B,C,D))']);
 const s3=await 态();
 console.log('   状态条：'+(s3.文?JSON.stringify(s3.文.slice(0,150)):'（空的）'));
 判((s3.没认||[]).length>=1,'★ 元组写法照旧被报没认 ⇒ ①的"不报"不是状态条哑了','报一条');

 // ═══ ④ 不许误伤 ═══
 console.log('\n④ 不许误伤');
 await 跑(['#清空','A=(0,0)','B=(2,0)','C=(2,2)','D=(0,2)','w=多边形(A,B,C,D)']);
 const 类4=await q('(function(){try{return ggbApplet.getObjectType("w")}catch(e){return "?"}})()');
 const 点4=await q('(function(){try{return ["A","B","C","D"].every(function(n){return ggbApplet.exists(n)})}catch(e){return false}})()');
 console.log('   `w=多边形(A,B,C,D)` → 类型 '+类4);
 判(类4==='quadrilateral','点表形式**没被误剥**，仍建出 quadrilateral','quadrilateral');
 判(点4===true,'四个顶点都还在','都在');
 await 跑(['#清空','O=(0,0)','图案={圆(O,1),圆(O,2)}']);
 const 类4b=await q('(function(){try{return ggbApplet.exists("图案")?ggbApplet.getObjectType("图案"):"—"}catch(e){return "?"}})()');
 console.log('   `图案={圆(O,1),圆(O,2)}` → 类型 '+类4b);
 判(类4b==='list','花括号装图形的写法**毫发无伤**（它本来就没病）','list');
 // 元组写法本来也剥不动（闸②），这里只做记录、不当断言
 const 类4c=await q('(function(){try{return ggbApplet.getObjectType("图案")}catch(e){return "?"}})()');
 void 类4c;

 console.log('\n───── 多套的多边形：'+绿+' 绿 / '+红+' 红 ─────  留图 test/_shot/polyshell_动.png');
 ws.close();await put('/json/close/'+t.id);
})().catch(e=>{console.error('炸了 '+(e&&e.stack||e));process.exit(2)});

// 【命令自己捡来的数，不许留在板上】—— 2026-10-04
//
// 起因：提示词围栏巡检报第19段（条形统计图）「板上留着可见的数 a=36」。
//   我把导出的 PNG 调出来看，图上没有 a=36，于是先怀疑那把尺子。
//   量下去才发现：**它真画**（藏掉 a 前后位图 162460 → 137688 字节）。
//   `条形统计图(L1,L2)` 自己造出来的那个 a=36，是印在学生屏幕上的。
//
// ★ 但这把尺子第一版是**假的**，两条红都是我自己的错，记在这里当反面教材：
//   红① 我断言"稿子点过名的 t=36 必须亮着"，结果它是暗的——于是判"产品越权藏了我的数"。
//        其实 **原生 GeoGebra 建自由数就是暗的**（test/_numvis.cjs 实测
//        `ggbApplet.evalCommand("t=36")` → 亮:false）。产品一根手指头都没碰它。
//        错在前提：我把"稿子里写了"当成了"就该亮"。
//   红② 我拿 `面积(p)` 捡来的 d 当反例（"点亮它位图必须变"），位图没变 →
//        判"尺子认不出"。d 是**因变量**，点亮它位图确实没动；换成自由数 t 就动
//        （39500→45796）。**反例挑错了对象**，不是尺子瞎。
//   同族：红的样子跟产品坏了长得一样，但它量的是我自己写错的那句话。
//
// ★ 实测出来的原生默认值（test/_numvis.cjs），这条规则真正的射程就在这张表里：
//     自由数 t=36        → 亮:false   （本来就暗）
//     滑动条 Slider      → 亮:true    （本来就亮，**不许我藏**）
//     BarChart 捡来的 a  → 亮:true    ← 会印上去，这条规则真正管的就是这一类
//     Area(p) 捡来的 d   → 亮:false   （本来就暗）
//     Distance 捡来的 a  → 亮:false   （本来就暗）
//   所以 board.js 的 `藏白捡的数` 是**兜底**，不是"我修好了一大类"：
//   它接住的是"哪条命令又冒出个默认亮的副产品"，最常见的就是 条形统计图/直方图 这一族。
//
// 这把尺子量四件事：
//   ① 【正题】条形统计图 → 捡来的数必须**全藏着**（板上一个亮的数都没有）。
//   ② 【能红】在同一块板上把它强行点亮，位图**必须变** ——
//            证明"藏住了"不是恒绿（这条要是也绿，说明这数压根不画，①就白量了）。
//   ③ 【不许越权】稿子写 `#显示 t` 的，产品**必须让它亮着**。
//      这一条防我过度修补：藏干净很好，把模型显式要显示的也藏掉就是越权。
//      `#显示` 走的是 `__SHOW__` 前缀那条分支 —— 也正是最容易"静默不生效"的那条。
//   ④ 【对照】板二的位图认得出数：把 t 强行藏掉，位图必须变。
//
// 跑法：node test/probe_straynum.cjs

const path=require('path'),fs=require('fs'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const 图录=path.join(__dirname,'_shot');try{fs.mkdirSync(图录,{recursive:true})}catch(e){}

// 板一：条形统计图 —— 真会印上去的那一族
const 稿一=['#清空','#隐藏 坐标轴和网格','L1={1,2,3,4}','L2={8,12,6,10}','条形统计图(L1,L2)'];
// 板二：越权 test —— t 是稿子显式要显示的，不许藏
const 稿二=['#清空','#隐藏 坐标轴和网格','A=(0,0)','B=(3,0)','C=(1,2)',
  'p=多边形(A,B,C)','面积(p)','距离(A,B)','t=36','#显示 t'];
const 点过名={A:1,B:1,C:1,p:1,t:1};   // 稿子里等号左边 / `#显示` 点到的

(async()=>{
 const tab=JSON.parse(await put('/json/new?about:blank'));
 const ws=new WebSocket(tab.webSocketDebuggerUrl,{perMessageDeflate:false});
 let id=0;const pend={};ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pend[o.id]){pend[o.id](o);delete pend[o.id]}});
 await new Promise(r=>ws.on('open',r));
 const send=(m,p)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}))});
 await send('Page.enable',{});await send('Runtime.enable',{});await send('Network.setCacheDisabled',{cacheDisabled:true});
 const q=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});const R=r.result;
   if(R&&R.exceptionDetails)throw new Error('页面炸了 '+String(R.exceptionDetails.exception&&R.exceptionDetails.exception.description).slice(0,300));
   return R&&R.result?R.result.value:null};
 await send('Page.navigate',{url:'http://localhost:8138/index.html'});await send('Page.bringToFront',{});
 for(let i=0;i<60;i++){await sleep(800);if(await q('!!(window.SR&&SR.board&&SR.board.isReady())')===true)break}

 let 绿=0,红=0;const 判=(好,现,该)=>{(好?绿++:红++);console.log('   '+(好?'✓':'✗')+' '+现+(好?'':'   ← 该是：'+该))};
 const 非空=x=>typeof x==='string'&&x.length>200;
 const 画=async 稿本=>{await q('SR.board.clear()');await sleep(450);
   await q('window.__稿='+JSON.stringify(稿本));
   const 好=await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');
   await sleep(2300);return 好};
 const 位图=async()=>{await sleep(450);for(let i=0;i<6;i++){const b=await q('ggbApplet.getPNGBase64(2,false,96)');if(非空(b))return b;await sleep(500)}return ''};
 const 存=(名,b)=>{if(非空(b))fs.writeFileSync(path.join(图录,'straynum_'+名+'.png'),Buffer.from(b,'base64'))};
 // 板上的数：名字 / 亮着吗 / 值
 const 数表='(function(){var o=[];ggbApplet.getAllObjectNames().forEach(function(n){try{'+
   'if(ggbApplet.getObjectType(n)!=="numeric")return;'+
   'var v=true;try{v=ggbApplet.getVisible(n)}catch(e){}'+
   'o.push({n:n,v:v,值:ggbApplet.getValue(n)})}catch(e){}});return o})()';
 const 亮字=o=>o.map(x=>x.n+'='+x.值).join(' ')||'（一个都没有）';

 // ═══ 板一：命令捡来的数 ═══
 console.log('\n板一　条形统计图(L1,L2)');
 await 画(稿一);
 const 数一=(await q(数表))||[];
 console.log('　　板上的数：'+(数一.length?数一.map(o=>o.n+'='+o.值+'(亮:'+o.v+')').join('  '):'（一个都没有）'));
 const 亮一=数一.filter(o=>o.v!==false);
 判(数一.length>=1,'板一真捡来了数（不是空测试）：'+亮字(数一),'至少一个 —— 否则这条压根没量到东西');
 判(亮一.length===0,'板一捡来的数**全藏住了**'+(亮一.length?('；还亮着：'+亮字(亮一)):''),'一个都不亮');
 // ② 能红：把第一个数强行点亮，位图必须变
 if(数一.length){
   const 名=数一[0].n;
   const 前=await 位图();存('一A_产品原样',前);
   await q('ggbApplet.setVisible('+JSON.stringify(名)+',true)');await sleep(650);
   const 后=await 位图();存('一B_强行点亮_'+名,后);
   console.log('　　（反例）强行点亮 '+名+'：位图 '+(前===后?'**没变**':'变了（'+前.length+'→'+后.length+' 字节）'));
   判(非空(前)&&非空(后),'两张位图都真拿到了（不是空的）','有内容');
   判(前!==后,'★ 强行点亮 '+名+' 位图**变了** ⇒ 它本来是会印上去的，上面那条"藏住了"不是恒绿','不一样');
 }

 // ═══ 板二：越权 test ═══
 console.log('\n板二　稿子显式 `#显示 t`');
 await 画(稿二);
 const 数二=(await q(数表))||[];
 console.log('　　板上的数：'+(数二.length?数二.map(o=>o.n+'='+o.值+'(亮:'+o.v+')').join('  '):'（一个都没有）'));
 const t=数二.find(o=>o.n==='t');
 判(!!t,'板上真有 t 这个数'+(t?('，值='+t.值):''),'t 在');
 判(!!t&&t.v===true,'★ 稿子 `#显示 t` 的 t **还亮着**（没被我越权藏掉）','亮着');
 // 顺手确认（**弱断言**）：面积/距离 捡来的两个数藏着。
 //   实测它们原生就是暗的（_numvis），所以这条绿灯**证明不了**我的规则，
 //   只证明它没有把本来是暗的弄亮。写在这里是为留个记录，别当主证。
 const 捡来=数二.filter(o=>!点过名[o.n]);
 const 亮捡=捡来.filter(o=>o.v!==false);
 判(亮捡.length===0,'（弱）面积/距离捡来的数没被弄亮：'+亮字(捡来)+'（原生本来就是暗的，这条不当主证）','一个都不亮');
 // ④ 对照：板二的位图认得出数
 if(t){
   const 前=await 位图();存('二A_t亮着',前);
   await q('ggbApplet.setVisible("t",false)');await sleep(650);
   const 后=await 位图();存('二B_t藏掉',后);
   console.log('　　（对照）藏掉 t：位图 '+(前===后?'**没变** ← 这把尺子在板二上不灵':'变了（'+前.length+'→'+后.length+' 字节）'));
   判(前!==后,'★ 板二藏掉 t 位图**变了** ⇒ 板二的"亮着=false"是真读数','不一样');
 }

 console.log('\n───── 命令捡来的数：'+绿+' 绿 / '+红+' 红 ─────  留图 test/_shot/straynum_*.png');
 ws.close();await put('/json/close/'+tab.id);
})().catch(e=>{console.log('炸了 '+e.message);process.exit(1)});

// 【模型漏定义名字时，老师屏幕上到底有没有那句话】
//
// 来源（2026-10-04 体检表全场跑完，`test/_figall.json` 里 4 句没过）：
//   四句"图不动"，逐条拆开是**三种不同的病**，其中两句根本不是画板的错：
//     · 第15号 尺规作角平分线：模型写了 `射线(O,A)` / `旋转(..., O)`，
//       **可 `O` 从没定义过**（它建的是 `D=(0,0)`）。板上确实有 22 个对象、
//       看着"建出来了"——但 GeoGebra 把圆心**顶到了原点**，那几笔是歪的，
//       图自然一动不动。`exists('O')` = false 是这病唯一的真读数。
//       （"板上对象数 > 0" 会把这种图判成好的：又是"数够圈数 ≠ 跑完了"。）
//     · 第50号 抛物线上动点：滑块起名 `α`，却写 `P=(t, f(t))`——`t` 从没定义。
//       `P=true`、`f=true`，**建出来了**：`P` 被当成一条**参数曲线**顶了上去。
//     · 第37号 圆锥：`圆锥(A,r,h)` 不是画板支持的签名（应为 `圆锥(底面圆, 高)`，
//       实测 `圆锥(c,5)` 建得出来），纯模型没照抄语法。
//     · 第22号 连续旋转图案：`图案={多边形(旋转(...))}` 单个命令装花括号里画板不认。
//
// ★ 这一族（引用没定义的名字）**早就诊断过、product 也会报**
//   （见 board.js `收尾` 那段：`Circle(O,2)` 圆心顶到原点 / `P=(t,f(t))` 变参数曲线）。
//   所以这把尺子量的不是"机制在不在"，是**老师屏幕上有没有那句话**——
//   机制在、但没接到界面上，等于没有。
//   判据取 `#status`（`js/main.js:464` 把 `hooks.log` 接到 `SR.chat.setStatus`）。
//
// ★ 还要一条**对照**：一张干干净净、语法全对的动图，`#status` 里**不许**出现
//   「没认」「没有的名字」——不然上面几条绿可能只是"这句话总是在"。
//
// 命令**逐字照抄** `_figall.json` 里模型当时写的原话（不为这把尺子重打模型，
// 也不手改一个字）。跑法：node test/probe_figwarn.cjs
const path=require('path'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res(s))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const 例={
  15:['#清空','#三维','A=(0,0)','B=(4,0)','C=(3,2)','多边形(A,B,C)','D=(0,0)','α=Slider(0,pi/2,0.02)','#隐藏 α',
    '射线(O,A)','射线(O,B)','角平分线(A,O,B)','圆(O,2)','圆(A,2)','圆(B,2)',
    '圆(交点(圆(O,2), 射线(O,A), 1), 0.5)','圆(交点(圆(O,2), 射线(O,A), 2), 0.5)',
    '圆(交点(圆(A,2), 射线(O,B), 1), 0.5)','圆(交点(圆(A,2), 射线(O,B), 2), 0.5)',
    '圆(交点(圆(B,2), 射线(O,A), 1), 0.5)','圆(交点(圆(B,2), 射线(O,A), 2), 0.5)',
    '旋转(多边形(O,交点(圆(O,2), 射线(O,A), 1),交点(圆(O,2), 射线(O,B), 1)), α, O)',
    '旋转(多边形(O,交点(圆(A,2), 射线(O,A), 1),交点(圆(A,2), 射线(O,B), 1)), α, O)',
    '旋转(多边形(O,交点(圆(B,2), 射线(O,A), 1),交点(圆(B,2), 射线(O,B), 1)), α, O)',
    '#播放 α'],
  22:['#清空','#三维','A=(0,0,0)','B=(1,0,0)','C=(1,1,0)','D=(0,1,0)','多边形(A,B,C,D)','α=60°','t=Slider(0,5,1)','#隐藏 t',
    '图案={多边形(旋转(多边形(A,B,C,D), α*t, A))}','#播放 t'],
  37:['#清空','#三维','A=(0,0,0)','r=3','h=5','圆锥(A,r,h)','α=Slider(0,2*pi,0.05)','#隐藏 α','旋转(圆锥(A,r,h), α, z轴)','#播放 α'],
  50:['#清空','坐标系','f(x)=x^2-2x-3','A=(-1,0)','B=(3,0)','#隐藏 A, B','P=(t, f(t))','线段(A,P)','线段(B,P)',
    's=面积(三角形(A,P,B))','三角形面积最大时 P 的位置=交点(直线(对称轴(f,x),f),线段(A,B),1)','#隐藏 t',
    'α=Slider(0,pi,0.01)','#隐藏 α','旋转(三角形(A,B,P), α, A)','#播放 α'],
};
// 对照：一句语法全对、真会动的动图（体检表自检用的那一张）
const 干净=['#清空','O=(0,0)','A=(2,0)','B=(3,1)','C=(2,2)','多边形(A,B,C)',
  'α=Slider(0,6.28,0.05)','旋转(多边形(A,B,C), α, O)','#隐藏 α','#播放 α'];

(async()=>{
 const t=JSON.parse(await put('/json/new?about:blank'));
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});
 let id=0;const pend={};ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pend[o.id]){pend[o.id](o);delete pend[o.id]}});
 await new Promise(r=>ws.on('open',r));
 const send=(m,p)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}))});
 await send('Page.enable',{});await send('Runtime.enable',{});await send('Network.setCacheDisabled',{cacheDisabled:true});
 const q=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});const R=r.result;
   if(R&&R.exceptionDetails)throw new Error('页面炸了 '+String(R.exceptionDetails.exception&&R.exceptionDetails.exception.description).slice(0,200));
   return R&&R.result?R.result.value:null};
 await send('Page.navigate',{url:'http://localhost:8138/index.html'});
 let 好=false;for(let i=0;i<40;i++){await sleep(700);if(await q('!!(window.SR&&SR.board&&SR.board.isReady&&SR.board.isReady())')===true){好=true;break}}
 if(!好){console.log('画板没起来');process.exit(1)}
 await send('Page.bringToFront',{});

 let 绿=0,红=0;const 判=(好2,现,该)=>{(好2?绿++:红++);console.log('   '+(好2?'✓':'✗')+' '+现+(好2?'':'   ← 该是：'+该))};

 const 跑=async 稿本=>{
   await q('SR.board.stopPlay()');await q('SR.board.clear()');await q('SR.chat&&SR.chat.setStatus&&SR.chat.setStatus("")');await sleep(500);
   await q('window.__稿='+JSON.stringify(稿本));
   await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');
   for(let i=0;i<30;i++){await sleep(250);if(await q('SR.board.isBusy()')===false)break}
   await sleep(600);
   // ★ 两样都要：那句话的**字**，以及它在屏幕上**真的占着地方**。
   //   只读 textContent 会栽在"藏的是它的爹"上（孩子照样报有字）。
   return await q('(function(){var e=document.getElementById("status");if(!e)return {文:"（没有 #status 这个元素）",可见:false,盒:0};'+
     'return {文:e.textContent||"", 可见:!!(e.getClientRects&&e.getClientRects().length), 盒:e.getClientRects().length}})()');
 };

 const 看=async(号,含)=>{
   const r=await 跑(例[号]);
   const 件=await q('(function(){var a=SR.board.applet();return a?a.getAllObjectNames().length:0})()');
   console.log('\n══ 第'+号+'号 ══  板上对象 '+件+' 个');
   console.log('   #status：'+(r.文?JSON.stringify(r.文.slice(0,190)):'（空的）')+'   可见='+r.可见+' 盒='+r.盒);
   判(!!r.文,'屏幕上**有话说**（不是一片沉默）','有那句提醒');
   判(r.可见===true,'那句话**真的看得见**（占着地方，不是藏在某个 display:none 的爹里）','可见');
   含.forEach(x=>判(r.文.indexOf(x)>=0,'那句话里含「'+x+'」','含 '+x));
   return r.文;
 };

 console.log('（命令逐字取自 test/_figall.json，模型当时写的原话）');
 await 看(15,['画板上没有的名字','O']);
 await 看(50,['画板上没有的名字','t']);
 await 看(37,['画板没认','Cone']);
 await 看(22,['画板没认','图案={']);

 console.log('\n── 对照：一句语法全对、真会动的动图 ──');
 const 干净r=await 跑(干净);
 console.log('   #status：'+(干净r.文?JSON.stringify(干净r.文.slice(0,190)):'（空的）'));
 判(干净r.文.indexOf('没认')<0,'干净图上**不许**出现「没认」（否则上面几条绿是恒绿：这句话总是在）','不出现');
 判(干净r.文.indexOf('没有的名字')<0,'干净图上**不许**出现「没有的名字」','不出现');

 console.log('\n───── 漏名字 / 没认的提醒：'+绿+' 绿 / '+红+' 红 ─────');
 ws.close();await put('/json/close/'+t.id);
})().catch(e=>{console.error('炸了 '+(e&&e.stack||e));process.exit(2)});

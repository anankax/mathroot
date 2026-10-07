// 云函数 gate 的前端那一半：把"一步"发上去。
//
// 为什么要有它（孔老师 2026-10-02 定下的第七件事，见 cloudfunctions/gate/index.js 顶上）：
//   Key 摆在网页上谁都能拿；一步之内想重试、想校验形状，浏览器里做不了；
//   以后要调学科网那类不许浏览器直连的接口，浏览器够不着。这三件事需要一个"服务器上的自己人"。
//
// ★★ 它是**可选**的，不是必须的。没配 url、或者云函数没起来、或者超时——
//   一律返回失败，**绝不抛给调用方**，让上面那一层安安静静退回本机那条路。
//   理由很实在：云函数是"锦上添花"，它挂了不该让老师连句话都问不出去。
//
// ★ 它只发四类请求，一类一个函数：
//     kb(step, query, k)        —— 知识库那两步（textbook / zhuawen），**不调模型、不花额度**
//     reslib(query, k)          —— 资源库那一步，同样**不调模型、不花额度**（2026-10-02 加）
//     libList() / libSign(key)  —— 云存储库那两步（列桶 / 签原件），同样不花额度（2026-10-07 加）
//     askStep(step, {...})      —— 模型那几步（topic / routes / step / wrap），过一次额度
//   分成几个函数而不是一个通用 call，是为了让调用点一眼看得出"这一步花不花钱"。
//   ★ reslib 为什么不并进 kb()：回包形状不一样（它给的是正文），
//     更要紧的是**时限不一样**——它冷启动要十来秒，见下面那段。
//   ★ lib* 为什么不并进 reslib()：它们**不是一回事**，而且可用性也不同——
//     列桶走的是 PG（跟 reslib 同一条临时凭证），签原件**还要一把 CLOUDBASE_APIKEY**。
//     合成一个函数的后果很具体：钥匙没配的时候，界面上会显示成"整个云存储库不能用"。
//
// ★ 口令明文写在 js/config.js（跟 GLM_KEY 一个待遇、同一个取舍）。它挡的是
//   "顺手扫到的脚本"，**不是安全**——别在别处再写一遍这句话以外的期待。
var SR = (window.SR = window.SR || {});

SR.gate = (function () {

  function c() { return SR.GATE || {}; }

  // 配了没有。★ 判据是 url 非空 + 没被显式关掉，不判 token——
  //   token 为空时云函数会回 401，那是**它在正常工作**（挡住了），
  //   不该在这一层就把它当"没配"而跳过，否则永远发现不了口令填错。
  function on() {
    var g = c();
    return !!(g.url && g.on !== false);
  }

  function url() { return String(c().url || ''); }

  // 发一次。**永不 reject**：超时、断网、404、不是 JSON，全部变成 {ok:false, why}
  function post(body, ms) {
    var g = c();
    if (!on()) return Promise.resolve({ ok: false, why: '没配云函数' });
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || g.timeout || 8000);
    var t0 = Date.now();
    return fetch(url(), {
      method: 'POST',
      signal: ctl.signal,
      // ★ no-store：别吃同源缓存。这道门判的是"云上那一份跟本机是不是同一份"，
      //   缓存会把"其实没生效"验成"生效了"（这坑在别处踩过一次）。
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Gate-Token': String(g.token || '')
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        clearTimeout(t);
        if (!j) return { ok: false, why: '云函数回的不是 JSON（HTTP ' + r.status + '）', status: r.status, ms: Date.now() - t0 };
        if (!j.ok) return { ok: false, why: j.error || ('HTTP ' + r.status), status: r.status, j: j, ms: Date.now() - t0 };
        j.ms = typeof j.ms === 'number' ? j.ms : Date.now() - t0;
        return j;
      });
    }).catch(function (e) {
      clearTimeout(t);
      var why = (e && e.name === 'AbortError') ? '云函数没在时限内回话' : ('连不上云函数：' + ((e && e.message) || e));
      return { ok: false, why: why, ms: Date.now() - t0 };
    });
  }

  // 知识库一步：{step:'textbook'|'zhuawen', query, k} → {ok, hits:[{title,score,text,body}], ms}
  //
  // ⚠ 一个查实过的坑（2026-10-02 实测，写在这儿免得下次重查一遍）：
  //   **从 localhost 那一页调不通**——拿到的是 `连不上云函数：Failed to fetch`。
  //   原因不在这一行、也不在配置：腾讯云网关对 localhost 这个来源，在预检里回了两个
  //   `Access-Control-Allow-Origin`（它自己回显一个 + 我们函数那个 `*`），Chrome 判
  //   MultipleAllowOriginValues，请求**根本没到函数**就被浏览器拦了（curl 还复现不出来，
  //   只有浏览器那边看得见）。**线上那个来源（anankax.github.io）是通的**——
  //   同一发请求实测 HTTP 200、via:"gate"、命中「苏科版·七上 2.2 数轴」。
  //   ⇒ 所以本机看到这四个字，先别查配置；要验这条链就跑线上那一页。
  //
  // ★★ 2026-10-07 复测：**上面那条症状今天不复现了** —— 别再拿它当"本机的失败必然长这样"。
  //   实测（curl 与真浏览器各一遍，同一天）：
  //     OPTIONS 预检 → 204，`access-control-allow-origin: http://localhost:8138` **只有一个值**
  //     POST        → fetch **成立**（CORS 放行）、status 443、content-length 0
  //     响应头       → `server: tcbgw`、`x-cloudbase-upstream-status-code: 443`、
  //                    `x-cloudbase-upstream-timecost: 430`
  //   ⇒ 今天本机撞到的是**云函数那头挂着**（430ms 远小于 InitTimeout 65s ⇒ 容器压根没起来），
  //     不是浏览器拦的。
  //   ★ 判 CORS 过没过，**唯一可靠的判据是「fetch 成立还是被拒」**：被拒才是拦了。
  //     ⚠ **别去读 `headers.get('access-control-allow-origin')`** —— ACAO **不在 CORS 安全清单里**
  //     （Cache-Control/Content-Language/Content-Length/Content-Type/Expires/Last-Modified/Pragma），
  //     它在了 JS 也读不到，一律回 null，读成"响应里没这个头"当场把结论带反（2026-10-07 栽过一次）。
  //   ⇒ `js/libui.js` 里 `路数()` 那条 CORS 分支**照旧留着**（形状真出现时它是对的，
  //     `test/probe_libpanel.cjs` 的 5b.1 就是把那个形状喂进去验它的）；但**别假定本机一定会
  //     撞出那个形状**——拿它当判据，就会让平台那头的病冒充产品的病。
  function kb(step, query, k) {
    return post({ step: step, query: query, k: k });
  }

  // 资源库那一步：{step:'reslib', query, k} → {ok, hits:[{id,doc,shelf,page,title,score,body}], ...}
  // 出问题时是**软失败**：回 200、hits 为空、另给一个 why 说明为什么（见 gate 里 runRes）。
  //   ★★ 它跟 kb() 唯一的不同是**时限**，而这个不同是非得有不可的：
  //     reslib 的头一件事是"把这个实例的语料从 PG 取回来"，冷的时候实测 8.9～11.7 秒
  //     （7706 块，分 3 页拉回；量法见 cloudfunctions/README.md）。
  //     而 post() 默认时限 8000ms——照默认走，**每个新实例的头一次提问都会被自己掐断**。
  //     掐断之后附注里没有这一段，而它跟"库里真没有"从外面看一模一样，
  //     正是最难查的那一类坏。
  //   ★ 25 秒怎么来的：冷启动实测 11.7 秒，留一倍余量。再长也没有意义——
  //     过了这一趟同一实例就是热的（0.1～0.2 秒），除非实例被回收。
  //   ⚠ 这一趟**不花额度**：gate 那一步记的是 KB_DAILY_CAP，不是调模型那个 DAILY_CAP。
  var RESLIB_MS = 25000;
  function reslib(query, k) {
    return post({ step: 'reslib', query: query, k: k }, RESLIB_MS);
  }

  // 模型一步：{step:'topic'|'routes'|'step'|'wrap', system, user, model, max_tokens}
  //   → {ok, text, tries, shaped, ms}
  // ★ 形状表在两边各有一份（云函数里那份是执行用的，js/flow.js 那份是账本用的），
  //   哨兵是 test/check_gate_contract.cjs（已写好；红验过——把云上那份的 k 改掉它会报红）。
  function askStep(step, o) {
    o = o || {};
    return post({
      step: step,
      system: o.system || '',
      user: o.user || '',
      model: o.model || '',
      max_tokens: o.maxTokens || 1024
    }, o.timeout);
  }

  // 云存储库那两步。★ 不花额度（gate 那边记的是 KB_DAILY_CAP）。
  //   libList()      → {ok, n, items:[{key,name,size}]}   桶里有什么
  //   libSign(key)   → {ok, key, url, expires}            一份原件的限时下载地址
  // ★ 时限跟 reslib 一个量级（都是"这一发可能碰上冷实例"）：
  //   libList 要等一次 executePGSql + manager-node 懒加载；libSign 是一趟外网往返。
  var LIB_MS = 20000;
  function libList() {
    return post({ step: 'liblist' }, LIB_MS);
  }
  function libSign(key, expiresIn) {
    return post({ step: 'libsign', key: key, expiresIn: expiresIn }, LIB_MS);
  }

  return { on: on, url: url, kb: kb, reslib: reslib, libList: libList, libSign: libSign, askStep: askStep, post: post };
})();

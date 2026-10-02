# cloudfunctions/ —— 云上这几个函数各是什么

## `gate` —— 网站唯一的门房（HTTP 云函数）

浏览器直接调它。它是 HTTP 函数（不是事件函数 + 网关），理由写在 `gate/index.js` 顶上：
CORS 得自己说了算，以后要做流式也得走它。

它的活分两类：

- **调模型的步**（topic / routes / step / wrap）——Key 只在它这儿，浏览器看不见。
- **只检索、不调模型的步**（textbook / zhuawen / reslib）——把命中的**那几条**还给浏览器，
  由浏览器自己拼进提示词（提示词不上云，这条规矩没破）。

它读环境变量 `GLM_KEY` / `GATE_TOKEN` / `DAILY_CAP` / `ALLOW_ORIGIN`。
★ **不新增环境变量**——新变量我这边改不了，所以 reslib 那条路上要调的东西一律写进代码。

### ★★ `gate-3`：为什么代码更新了还不算数（warm 实例会接着跑旧代码）

`VERSION` 常量现在是 `gate-3`，`/health` 会把它报出来。它存在的唯一理由：
**SCF 的热实例在代码更新之后还能活着，继续用旧代码答话**——于是"我明明部署了"
和"它真在跑新的"是两件事，而这两件事**从外面看一模一样**。
所以每次动这个函数都升一位，验的时候先看 `/health` 的 `version` 再说别的。

### ★★ `reslib` 那一步的时限是**单独设的**，别拿默认那个 8 秒

前端 `js/gate.js` 里 `RESLIB_MS = 25000`，而 `post()` 的默认时限是 8000。
这个不同**非有不可**：reslib 头一件事是"把这个实例的语料从 PG 取回来"，
冷的时候实测 **8.9～11.7 秒**。照默认走，**每个新实例的头一次提问都会被自己掐断**——
掐断之后附注里就没有这一段，而它跟"库里真没有"长得一模一样，正是最难查的那一类坏。
25 秒是照实测 11.7 秒留了一倍余量；再长没意义，过了这一趟同一实例就热了（0.1～0.2 秒）。

★ 这一趟**不花额度**：gate 记的是 `KB_DAILY_CAP`，不是调模型那个 `DAILY_CAP`。

## `reslib` —— 资源库检索（事件函数）

从 PG 的 `res_chunks` 表里捞最相关的几块。**保留它是为了当调试台**：
`{weigh:true}` 量取回成本、`{probe:true}` 摊开 executePGSql 的回包形状、`{count:true}` 数行数。
线上跑的那份逻辑在 `gate` 里（见下）。

## ★★ 一条实测出来的事实，别再靠读文档猜（2026-10-02 量的）

**HTTP 云函数的运行时里，平台照样注入了临时凭证，而且能读 PG。**

一次性探针 `httpprobe`（HTTP 函数，问完即删）实测：

```
TENCENTCLOUD_SECRETID      has: true  len 68
TENCENTCLOUD_SECRETKEY     has: true  len 44
TENCENTCLOUD_SESSIONTOKEN  has: true  len 448
pg.step: "done"
pg.count: ["7706"]        ← 真的从 HTTP 函数里读到了 PG
```

官方文档 `cloud-functions/references/http-function-credentials.md` 写的是
"HTTP Functions must not depend on that default temporary credential injection:
credential rotation can leave the process with invalid credentials and cause
intermittent authorization failures."

★ 那句话是**可靠性**的告诫（长命实例的凭证可能轮换失效 → 偶发失败），
**不是**"HTTP 函数拿不到"。—— 这两件事差别很大，实测之前我按前者办，白绕了一圈。

于是 `gate` 读库这条路成立，前提是**降级要软**：
读不到就当这一轮没有附注，模型照常答（跟 `kb.js` 没了只关那两步、不关整个函数一个道理）。
绝不能让"检索没拿到"变成"学生那边报错"。

## 冷启动那笔账（2026-10-02 实测，0.2 vCPU / 256 MB）

`reslib` 这一步第一次跑在一台新实例上，时间是这么花的：

```
rows: 7706    pages: 3   (每页 3000)
fetch_ms: 8856      ← 从 PG 把语料取回来
build_ms: 2794      ← 建索引
corpus_ms ≈ 11656   ← 两者相加，这就是冷的那一下
avg_len: 577
--- 热了之后 ---
cache_hits: 1   score_ms: 17～510   整趟 17～200ms
```

★ 冷 11.7 秒 → 热 0.1～0.2 秒，差两个数量级。所以"检索慢"这个抱怨要先问
**是冷的那一下还是每一句都慢**——这两个的治法完全不同。

## 三个共享文件（在 gate 目录里）—— 与 reslib 同源

部署是**按目录打包**的，跨不了目录，所以这三个文件在两个目录里各有一份**逐字副本**：

| 文件 | 字节 | 干什么 |
| --- | --- | --- |
| `reslib-core.js` | 6210 | 打分那套（建索引 / 检索） |
| `reslib-pg.js` | 10220 | 读库那半（连 PG、分页取回） |
| `reslib-retrieve.js` | 3356 | 取 → 算 → 拼 |

两份必须一模一样，哨兵是 `test/check_reslib_core.cjs`（逐字节比 + 报字节数）。

## 这四把尺子各管什么（别互相顶替）

| 哨兵 | 问的问题 | 跑法 |
| --- | --- | --- |
| `test/check_reslib_core.cjs` | 那三个共享文件，两个目录里是同一份吗 | `node test/check_reslib_core.cjs` |
| `test/check_gate_contract.cjs` | 浏览器**读**的那几个字段（body / title / score），云上那份**发**得出来吗；要的条数越没越过云上的上限 | `node test/check_gate_contract.cjs` |
| `test/probe_reslib_cloud.cjs` | 云上 gate 那一步，跟本机拿同一份语料算的，结果一样吗 | `node test/probe_reslib_cloud.cjs` |
| `test/probe_reslib_e2e.cjs` | 从打字到出字，整条链一次走完，走得通吗 | 先开 Chrome 9222，再 `node test/probe_reslib_e2e.cjs` |

★ `check_gate_contract.cjs` 为什么也算 reslib 这把尺子里的：这一步**没有本机退路**，
所以"云上没发 body"和"库里真没有"从界面上看**一模一样**——面板上都写着
「库里没翻到对得上的」。它是这道坏里**唯一能在部署之前**拦住的那一条。
（红验做法：`cp -r cloudfunctions/gate /tmp/改过的gate` 整目录搬，
在副本里把 `body: r.body` 改成 `text: r.body` 再 `GATE_DIR=… node test/check_gate_contract.cjs`，必须报红。）

★ 第三个必须在 **https://anankax.github.io** 这个来源上跑：gate 第二道门槛认 Referer，
白名单里只有它。本机那个来源会被回 403，而那一步会记成"没翻到"——
**"来源被挡"跟"库里真没有"从外面看一模一样**。

★ 第三个**不推 GitHub**：它把线上 `/mathroot/*` 的请求全拦下来、用本机磁盘上的文件回，
所以**来源是真的，代码是本机工作区这一份**。要真上线是另一件事。

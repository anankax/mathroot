# 数根 · mathroot

初中数学错题复盘助手。**只问不答**——不问出你自己说出错在哪一步，它就不给答案。
右边配一块随讲随画的互动画板，图跟着话一点点长出来，动点能真的动起来。

线上地址：<https://anankax.github.io/mathroot/>

---

## 怎么用

1. 打开页面，先填一个自己的 DeepSeek Key（[在这里申请](https://platform.deepseek.com/api_keys)）。
   Key 只存在自己浏览器的 localStorage 里，**仓库和网页里都没有密钥**。
2. 把做错的题贴进去，说说你当时是怎么想的。它顺着你的思路问，不给答案。
3. 卡住了它会说"画出来看看"，右边的画板就出一条数轴给你当纸用——点要你自己标。

顶栏右边可以切 **教师演示模式**：这个模式可以画、可以讲、可以直接给答案，上课演示用。
存书签时带上 `#demo`（`…/mathroot/#demo`）就能直接进演示模式。

## 两个模式的区别

| | 学生模式 | 教师演示模式 |
|---|---|---|
| 给不给答案 | **不给**，一个字都不给 | 给，而且讲透 |
| 画板 | 只出空底图，点要学生自己标 | 随便画，滑块、动点、动画都行 |
| 面向谁 | 学生自己复盘用 | 老师上课演示用 |

## 为什么是纯静态站

不用后端、不用服务器、不用打包。打开 `index.html` 就能跑，推到 GitHub Pages 就能上线。
- **DeepSeek 允许浏览器直连**（CORS 放行），所以不需要任何代理。
- **GeoGebra 官方嵌入脚本**（`deployggb.js`）给出完整的 `ggbApplet` 接口，
  于是画板是"我们自己的"，逐条下命令、控制动画都做得到。

## 本地跑

```bash
# 方式一：直接双击 index.html（GeoGebra 与 DeepSeek 在 file:// 下都实测可用）
# 方式二：起个本地服务（推荐，跟线上环境一致）
python -m http.server 8080
# 然后开 http://localhost:8080/
```

## 目录

```
index.html            页面骨架 + CDN 引入 + 按依赖顺序的 script
css/main.css          两栏布局
js/config.js          常量：后端地址、模型、画板速度、模式定义
js/prompt-student.js  学生模式提示词（由 test/build_prompt.py 生成，别手改）
js/prompt-demo.js     教师演示模式提示词（手写）
js/textbook.js        苏科版教材索引（118 条，由脚本生成）
js/retrieve.js        字符二元组 BM25 检索，按学生这句话找教材条目
js/api.js             DeepSeek 客户端（SSE 流式）
js/render.js          围栏拆分 + markdown + KaTeX
js/board.js           GeoGebra 桥：逐条出图、动点播放
js/chat.js            气泡、chips、拍照
js/main.js            装配与模式切换
test/                 生成脚本与自检，不进部署
```

## 画板命令（提示词里教模型用的就是这套）

```ggb
#清空            把画板擦干净
数轴             横向数轴，只留尺子不留点
坐标系           带网格的坐标平面
A=(1,2)          其余按 GeoGebra 写法原样写
线段(A,B)        中英文命令名都收——见下面"中文命令要翻译"
#隐藏 t          藏起来
#播放 t          画板上冒出播放键，点它 t 动起来（讲动点用）
#暂停            停下来
```

**中文命令要翻译。** 这个 applet 的**界面是中文的，但 `evalCommand` 只认英文命令名**：
`交点(f,g)` 返回 false、什么都不建，`Intersect(f,g)` 才建得出点。所以提示词里照旧教中文
（老师看着自然、模型也愿意照抄），由 `js/board.js` 的 `CMD_MAP` 翻一道再发下去。
不翻的话 `线段`、`圆`、`多边形`、`中点`、`角`、`距离` 全会**一声不响地什么都不画**——
错误弹窗又被关掉了，课上没人会发现。加新命令记得往 `CMD_MAP` 里补，
再用 `node test/probe_zhcmd.cjs` 逐条验一遍（会真的在 applet 里建对象来判）。

## 提示词怎么改

学生模式那份是**生成的**，源在 `C:\数学办公\宜兴东氿中学\23-科技创作\作品材料\05-系统提示词（现行稿·v18）.md`：

```bash
python test/build_prompt.py     # 重新生成 js/prompt-student.js 和 js/textbook.js
node  test/check_prompt.cjs     # 自检：关键节在不在、有没有残留旧名字
node  test/check_retrieve.cjs   # 自检：教材索引检索
```

别直接手改 `js/prompt-student.js`——下次生成就覆盖了。

## 自检怎么跑

先起测试服务器（**必须用它，它带 `no-store`，见下面"同域普通导航吃缓存"**）：

```bash
node test/serve.cjs              # http://localhost:8138
```

然后另开一个终端：

```bash
node test/probe_fence.cjs 8 1.0         # 围栏命中率：同一提示词采样 8 次，数 ```ggb / ```想说
node test/probe_zhcmd.cjs               # 中文命令经翻译后，在真 applet 里建不建得出对象
node test/probe_board.cjs               # 数轴／坐标系／播放键／错误弹窗／代数面板
node test/e2e.cjs student 90 "第一句" "第二句" "第三句"   # 真调 DeepSeek 的多轮端到端
node test/e2e.cjs demo 90 "画个数轴，带个动点 P"
```

`e2e.cjs` 与 `probe_fence.cjs` 会在运行时从 `~/.claude/settings.json` 现读一个 Key
塞进那个浏览器标签的 localStorage，**不写盘、不进仓库**。测完全程留意最后那句
「页面异常: 无」——有异常会在那儿列出来。

## 部署

`main` 分支根目录，`git push` 一两分钟生效。没有 CI、没有构建步骤。

## 踩过的坑

### 画板（GeoGebra）

- **必须用 `appName: 'classic'`。** 原先是 `'graphing'`（图形计算器），那是个精简版：
  `线段`、`圆`、`多边形`、`中点`、`中垂线`、`角`、`距离` **一条都建不出东西**，
  实测 14 条几何命令只过 4 条；换 classic 之后 14 条过 13 条。
- **`evalCommand` 只认英文命令名**（界面是中文的也没用）。见上面「中文命令要翻译」。
- **别用 `evalCommand` 调 `SetGridVisible`／`SetVisibleInView` 这类。** `setVisibleInView`
  这个方法**在这个 applet 里根本不存在**；命令写错时 GeoGebra 会弹一个「未知的指令」的
  **模态框糊在画板正中间**——公开课上弹这个就完了。数轴／坐标系改走真 API
  （`setAxesVisible` / `setGridVisible` / `setCoordSystem`），并在 `appletOnLoad` 里调
  `setErrorDialogsActive(false)` 兜底（命令写错时只记控制台，不弹框）。
- **`perspective:'G'` 这个启动参数不管用**，代数面板照样白占底下三分之一、滑块还在里头露出来。
  得等 `appletOnLoad` 之后再喊一声 `setPerspective('G')`。
- **`文本("...", true, true)` 这个两布尔的写法不合法**，必须给位置：`文本("∠A=40°", (2,3))`。
- **`getVisible('yAxis')` 不可靠**（明明藏住了它报 true）。判画板状态以截图为准，别信这个 getter。
- **GeoGebra 在 `about:blank` 里加载不起来**（不透明源），但在 `file://` 和 https 下都正常。
  别用 `srcdoc` 或空标签页去承载 applet。

### 提示词 / 模型

- **两个围栏必须写在提示词的最末尾。** 「每一轮都要给三个能点的话」这条原先写在
  提示词四分之一处、后面还压着 147 行，模型看不到它——```想说 的命中率只有 **4/8**。
  挪到最末尾（离学生这句话最近）之后是 **8/8**。演示模式同理：
  「老师说画 xxx 就必须给 ```ggb 围栏」补在结尾，出图率从 **5/8 到 10/10**。
  这是这个作品里最便宜、收益最大的一处改动。
- **演示模式不许塞教材索引。** 学生模式那套索引附注里写着"照上面「三、教材索引」那节的规矩"，
  可演示模式的提示词里根本没这一节，模型被这段没头没尾的附注带跑，
  出图率从 8/8 掉到 6/8。`api.js` 里 `buildSystem` 对 demo 直接返回空。
- **思维链要显式关掉**：DeepSeek 默认会吐 `reasoning_content`，
  带上 `thinking:{type:"disabled"}` 才是 0。万一哪天这个参数不被认了，`api.js` 会自动去掉重发。
- **模型漏围栏是概率事件**，别指望一次实验。`test/probe_fence.cjs` 同一个提示词采样 8～10 次
  数命中率，改提示词前后各跑一遍，才知道动的那一下有没有用。

### 前端 / 测试

- **同域普通导航吃缓存。** 改了 `config.js` 之后页面里读出来还是旧值，
  会把「已经生效的改动」误判成「没生效」（今天在这上面白查了一轮）。
  测试一律走 `node test/serve.cjs`（带 `Cache-Control: no-store`），别用 `python -m http.server`
  ——后者只发 `Last-Modified`，浏览器按启发式规则缓存。
- **`isBusy` 要记得在定时器跑完时递减**，只往里塞不移除的话，"画板在画"永远是 true。
  测试脚本里等画板画完不能只看"文字稳了"——逐条出图有 550ms 间隔，文字早稳了图还在长。
- **MathJax 太大**（`tex-svg.js` 实测 2.1MB），用 KaTeX。
- **DOMPurify 必须真的调用**，光引入库不 sanitize 等于没防护。

---

「数根」——刨到根上。

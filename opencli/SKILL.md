---
name: opencli
description: 用 OpenCLI 驱动用户本机那个真实的、已登录的 Chrome，或调用它的 160+ 站点 adapter。任何需要登录态的页面操作都从这里开始——读登录后的后台、抓没有 API 的表格、填表提交、跑一个站点命令、把页面数据取回来。也覆盖会话命名与租约纪律（"我的标签页被别人抢了"）、批量取数与落盘、adapter 的编写与自修复、opencli doctor 排障。用户提到 opencli、浏览器自动化、用我的浏览器、驱动 Chrome、登录态、抓后台数据、抓表格、导出报表、填表、自动点击、截图、adapter、doctor 报错、session 撞名、标签页被抢、tab 泄漏，或说"打开这个页面看看""帮我登录后台查一下""这个站没有 API"时，务必使用本 Skill。只要动作会落在浏览器上，先读这里再动手。
metadata:
  version: "1.2.0"
---

# OpenCLI

OpenCLI 把任意网站、Electron 桌面应用和外部 CLI 收敛成一条 `opencli <site> <command>`，
再加一条 `opencli browser <session> <command>` 用来现场驱动浏览器。

它走的是**用户本机那个真实的、已登录的 Chrome**（浏览器扩展 + 本地守护进程），
不是无痕实例、不是沙箱。这一个事实决定了本 Skill 里几乎所有规则。

本 Skill 面向的是我们自己维护的 fork（`yan-labs/OpenCLI`），和上游 `jackwener/opencli`
有差异，差异清单见 [`references/our-fork.md`](references/our-fork.md)。

---

## 一、先判断：这件事该不该用浏览器

**动手之前先走这条阶梯，命中即停。** 每一级往下的唯一理由是「上一级确实不存在」，
不是「我对下一级更熟」。跳级的代价不是慢，是拿到看起来正常但内容不同的数据。

| 级 | 手段 | 什么时候用 |
|---|---|---|
| 1 | **现成脚本** | 项目里、兄弟 Skill 里已经有的 `.mjs`。直接跑，不要现写等价实现 |
| 2 | **HTTP / REST API**（`curl` / `fetch`） | 没脚本但服务有 API。先用 API，跑通后固化成脚本 |
| 3 | **`opencli <site> <command>` adapter** | 目标站已有 adapter。`opencli list \| grep -i <site>` 一眼就知道 |
| 4 | **`opencli browser <session>` 现场驱动** | 没有 adapter，或 adapter 不覆盖这个动作 |
| 5 | 写一个新 adapter | 这个动作以后还要重复做。见 [`references/adapters.md`](references/adapters.md) |

### 判据：无痕窗口打开，还是不是同一个东西？

答案是「不是」，就**必须**走用户的真实浏览器（也就是 OpenCLI）。

需要身份的一切——第三方数据面板、Search Console、社区后台、聊天式 AI 工具——
用运行环境自带的沙箱浏览器打开，要么直接跳登录页，要么以匿名身份返回**看起来正常
但内容不同**的结果（配额更低、字段更少、国家库不同）。这种失败会伪装成
「这个工具没有这项数据」，而正确的结论其实是「你没登录」。

反过来，**只是看一段公开文本就不要开浏览器**——先问有没有 `curl` 或公开 API。

三个 driver 的取舍（为什么默认是 OpenCLI 而不是 agent-browser 或 Claude in Chrome，
各自的实测泄漏数据）见 [`references/drivers.md`](references/drivers.md)。

### 不在本 Skill 范围

- **找信息、做调研、搜某个话题** → 用 `agent-reach`，它已经负责多平台路由。
  本 Skill 只管「怎么把浏览器开对、把数据取回来」。

---

## 二、开工前：doctor

```bash
opencli doctor
```

`doctor` 只诊断**浏览器桥**（守护进程 + 扩展 + Chrome 连线）。
`PUBLIC` / `LOCAL` 策略的 adapter、`opencli list`、外部 CLI 透传都不需要它绿。
`COOKIE` / `INTERCEPT` / `UI` 策略和所有 `opencli browser *` 才需要。

### 行为和这份文档对不上时，第一件事是查扩展版本

**本 Skill 描述的默认行为全部住在扩展里**——后台默认、标签页开在用户当前窗口、
不切走活动标签页、`--window isolated`、`sessions` 报 windowId。
装成 Chrome 应用商店那个版本的话，**每条命令都照样成功，只是行为回到上游**：
默认前台、自己开一个窗口、抢走用户正在看的标签页、`isolated` 被忽略。

**这类失败没有报错，只有「怎么和文档说的不一样」。** 所以：

| 观察到 | 该做什么 |
|---|---|
| 命令成功但窗口/焦点行为与本文档不符 | 跑 `opencli doctor`，看 `Extension` 那行的版本 |
| 版本 < 1.0.32 | **告诉用户他装的是应用商店版**，需要换成 [yan-labs 的 Release](https://github.com/yan-labs/OpenCLI/releases/latest) 里的 zip，并把商店版移除或停用 |
| `doctor` 自己就报了这条 | 照它说的做——它会打印下载地址和加载步骤 |

`doctor` 会在扩展低于 1.0.32 时主动报这个问题，**不要跳过它的输出**。

红了先看 [`references/troubleshooting.md`](references/troubleshooting.md)。
排障的第一步永远是 **`npm ls -g @jackwener/opencli` 确认 CLI 是发布版还是本地源码 link**——
这一步决定后面是查代码还是查环境，跳过它会浪费一整轮。

**`doctor` 前两行绿、第三行红**是一个特定信号：守护进程和扩展这两个组件都活着，
坏的是它们之间那条命令路径，重启守护进程通常没用。

---

## 三、会话纪律：本 Skill 最贵的一节

`opencli browser <session>` 里的 `<session>` **就是标签页的所有权声明**。
同名会话共用同一个标签页，不同名之间互不干扰。所以「我的标签页被别人抢了」
只有一个成因：**两个任务挑了同一个会话名**。

症状极其阴险：导航报成功，随后读回来的却是**另一个任务打开的页面**——
数据是别人的，而全程没有任何报错。

### 四条法律（完整实测数据见 [`references/session-laws.md`](references/session-laws.md)）

| # | 法律 | 一句话理由 |
|---|---|---|
| 1 | **一个会话一个标签页；N 个页面就要 N 个会话名** | 三个 agent 各用独立名字：跨 agent 抢占 0 次。共用 `work`：3 / 12 / 2 次，其中一个每次读都读错 |
| 2 | **不要用 `tab new` / `tab select` / `open --tab` 在一个会话里放多个页面** | 三个都**静默**失败：命令报成功，下一次读回错误的页面。一次三 agent 运行把用户的 Chrome 从 11 个标签页涨到 30 个孤儿页 |
| 3 | **绝不硬编码会话名** | `opencli browser --help` 的第一个例子就是 `work`，抄它的人全撞在一起 |
| 4 | **开工前一次性把要用的会话全部开好、handle 全部拿到，再进工作循环** | 边创建边使用会把理论上的竞态变成可复现的竞态 |

**法律 1 保护的是标签页身份，不是站点的服务端状态。** 所有会话共用同一个 Chrome
profile 和同一个登录身份，所以如果站点把「当前选中的项目/客户」存在服务端会话里，
一个标签页切换目标，其它标签页刷新后会跟着变——会话名分得再开也拦不住。
**判据：在站点里切换目标之后 URL 变不变？** 不变就先验证再并行，
细节见 [`references/session-laws.md`](references/session-laws.md)。

### `$$` 在脚本里安全，在 Bash tool 里不安全

这是我们踩过的真实事故，必须区分：

| 场景 | `$$` / `process.pid` 行为 | 正确做法 |
|---|---|---|
| **Node 脚本**（一个进程跑完全程） | 整个生命周期同一个 PID，安全 | `` let session = `ahs-${process.pid}` `` |
| **Claude Code 的 Bash tool** | **每次调用都是新进程，PID 不同** | 用**描述性字面常量**（`naver-birthstone`、`bing-check-mysite`），或 `S=$(uuidgen \| cut -c1-8)` 存进文件再读回 |

已验证事故（2026-08-23）：sub agent 用 `S="naver-bs-$$"` 连续调用 OpenCLI，
每条命令都创建了新会话（新空白标签页），上一条打开的页面被遗弃。
agent 看到的永远是空白页，以为页面没加载好不断重试，最终泄漏 9 个会话。

**名字要描述工作**，不只是唯一：`backlink-probe-<后缀>` 胜过 `bl-1`。
会话名是唯一存在的标识符，一个唯一但无意义的名字仍然回答不了「这是谁的标签页」。

JS 里不要手搓后缀，用 `scripts/opencli-core.mjs` 的 `defaultSession(base)`。

### 用完必须还回去

```bash
opencli browser <session> close     # 释放这一个
opencli browser sessions            # 看现在还有谁活着，以及各自在哪个窗口
opencli browser cleanup             # 释放**全部**——只有主线能跑，见下
```

**Sub agent 必须在 finally 块或退出前显式 close 自己的会话**——崩溃时不会自动清理。

**`cleanup` 是主线专用。** 它释放的是**这台机器上全部**的租约，不是「我的」——
sub agent 跑它会把兄弟 agent 正在用的标签页一起关掉，
而那些 agent 只会看到自己的页面莫名其妙不见了。并行扇出时只有父级在全部收工后才跑它。
留着的会话在用户 Chrome 里就是一个标签页，看起来和别人正在做的活儿一模一样。

### 三个窗口模式，默认已经是不打扰的那个

| `--window` | 行为 | 什么时候用 |
|---|---|---|
| `background` | **默认**。在用户当前那个窗口里开标签页，不抬窗口、不切活动标签页 | 几乎所有情况 |
| `foreground` | 抬起窗口并选中标签页 | **只有**需要用户亲自完成验证码、或他明确说要看着的时候 |
| `isolated` | 后台，且不在用户那个窗口里——**所有 isolated 会话共用一个自动化窗口** | 长时间批量作业，不想在用户标签栏里堆东西 |

标志位置在**会话名和子命令之间**（放在子命令后面也能工作）：

```bash
opencli browser <session> --window isolated open "https://..."
```

放在会话名**前面**会报 `unknown command: <你的会话名>`，读起来像装坏了，其实是语法错。

**需要扩展 ≥ 1.0.32**（`opencli doctor` 那行就是判据）。旧扩展上默认仍是前台、
`isolated` 会被静默忽略——那正是下面那张表里的坑。

#### `isolated` 曾经有两条限制，两条都已修好

**当前行为（2026-08-24 复测于扩展 1.0.30 + CLI 1.8.7，两条都 PASS）**：
两个 isolated 会话可以并存，`sessions` 里都在、都可读，
且**共用同一个自动化窗口**（`win379222152`），与用户窗口（`win379220956`）分开。
注意是「共用一个窗口」而不是「一人一个窗口」——它隔离的是**用户 vs 自动化**，
不是会话之间。会话之间的隔离靠会话名，那是上面四条法律的事。

<details>
<summary>修好之前是什么样（留着，因为这两种失败形态会重复出现）</summary>

**一、第二个 isolated 会把第一个静默打掉**（扩展 1.0.27）。
`w1` 开出独立窗口 → 再开 `w2` → `w2` 落回用户窗口，**且 `w1` 整条会话从 `sessions` 蒸发**，
再访问 `session_not_found`，而创建 `w2` 的那一方毫无报错。跨 agent 同样会踩——
一个 agent 开 isolated 就打掉兄弟 agent 已有的那个。

**二、adapter 命令不接受 `isolated`**（CLI ≤ 1.8.7 的某个中间版本）。
报 `--window must be one of: foreground, background`。真因是 adapter 走的是
`src/execution.ts` 里**另一份白名单**，它只列了两个值，而紧挨着的 `src/help.ts`
文案却在宣传 isolated——文档说一套、代码做一套，读起来像用户抄错了参数。

两条的共同点：**失败都不报错，或者报的错指向错误的方向。** 所以下面那条自检值得每次都做。
</details>

背景模式跑的是用户真实的、已登录的 Chrome：`navigator.webdriver` 为 `false`、
UA 不含 `Headless`、`plugins.length` 为 5。
**「后台模式会被反爬识破」不是真问题**，每一项无头特征都是负的。

### 绝不抢用户的浏览器焦点

**这台机器上的 Chrome 是用户正在用的那一个。** 抢焦点不是「体验略差」，
是直接打断他手上的活——他正在打字或看页面，窗口被抬起来、标签页被切走。

| 错误做法 | 正确做法 | 为什么错 |
|---|---|---|
| `--window foreground`（除非用户要亲自操作） | 什么都不加（默认就是 background） | 实测会把用户的**活动标签页切走**（从第 1 个跳到第 3 个）。注意最前端**应用**不变，所以只查应用焦点的测量看不见它 |
| 调 adapter 时用前台「方便看页面」 | `--keep-tab true` + `screenshot` / `state` | 调试是高频动作，一轮能打断十几次。标签页留着，用户想看自己切过去 |
| 在旧扩展（< 1.0.32）上省略 `--window background` | 先看 `doctor` 的扩展版本；旧版就每条命令都显式带 | 旧版两层默认都是前台，省略等于每条命令都抬一次窗口 |
| 给 `PUBLIC` / `LOCAL` 命令加 `--window` | 不加 | 它们不接受这个标志，会报 `unknown option '--window'`；这类命令本来也不开浏览器 |
| 崩溃后不清理，留下一堆孤儿标签页 | `finally` 里 `close` | 泄漏的会话在用户窗口里就是一堆莫名其妙的标签页，比抢一次焦点更烦 |

**实测（2026-08-23，macOS + Chrome）**：后台模式下 `open` / `eval` / `screenshot` /
`click` / `type` 全程——用户窗口的**活动标签页索引不变**，标签数在 `close` 之后回到基线，
页面侧 `document.hasFocus()` 恒为 `false`、`visibilityState` 恒为 `hidden`。
**同一台机器上换成 `--window foreground`，活动标签页立刻从第 1 个被切到第 3 个。**

**这条推翻了本 Skill 到 2026-08-22 为止的旧结论「两种模式都不抢焦点」**——
旧测量只查了「最前端应用」（前台模式下它确实不变），漏掉了「活动标签页」这一轴。
完整对照表见 [`references/session-laws.md`](references/session-laws.md)。

> **这条曾经是坏的，2026-08-23 修好了**（扩展 1.0.32）。当时 `--window isolated`
> 不新开窗口，行为与 `background` 一模一样，于是文档写下了「没办法把 agent 的标签页
> 挪出用户窗口」。真因是四层各自静默地否决它：运行时白名单只认两个值把 `isolated`
> 丢掉了；「这窗口是不是我的」靠猜（全是非 http 页面就算我的）而把用户随手开的空窗口
> 认成了容器；窗口建对了之后分组收敛又把标签页搬回用户窗口；以及挑「用户在哪个窗口」
> 用了 `focused`，而 Chrome 不在最前面时所有窗口的 `focused` 都是 false。
> **每一层都不报错**，所以每修一层都以为好了。

**怎么确认自己拿到的是修好的版本**：`opencli browser <s> --window isolated open <url>`
之后跑 `opencli browser sessions`，它那一行的 `windowId` 应该与默认模式会话的不同。

---

## 四、发现能力：不要背命令表，去问

有 160+ 站点 adapter，数量每周都在变。**任何写死在文档里的清单都会过期**，
所以本 Skill 不列它们。

```bash
opencli list                       # 按站点分组的表格
opencli list -f json               # 机器可读，agent 用这个
opencli list | grep -i twitter     # 找某个站
opencli <site> --help              # 这个站有哪些命令
opencli <site> <command> --help    # 位置参数、专属标志、输出列
```

`opencli list -f json` 每条给 `{site, name, aliases, description, strategy, browser, args, columns}`。
**`strategy` 决定要不要浏览器**：

| strategy | 需要什么 |
|---|---|
| `PUBLIC` | 什么都不要，纯 HTTP |
| `COOKIE` | Chrome 已登录该站 + 装了扩展；命令从活会话里取凭据，不用重新登录 |
| `INTERCEPT` | 同上，另外会开一个自动化窗口截取签名请求 |
| `UI` | 同上，完整 DOM 交互 |
| `LOCAL` | 不要浏览器，连本地/开发端点 |

**在退回裸 `opencli browser` 之前，先查一下有没有 adapter 已经覆盖了这个工作流。**
在高频改版的登录站上尤其值得——adapter 里封装过的坑，现场驱动要重踩一遍。

### 通用标志（多数 adapter 命令有，浏览器相关的那几个例外）

| 标志 | 作用 |
|---|---|
| `-f, --format <fmt>` | `table`（TTY 默认）· `yaml`（非 TTY 默认）· `json` · `plain` · `md` · `csv`。**agent 基本都要 `-f json`** |
| `--trace <mode>` | `off`（默认）· `on` · `retain-on-failure`。排障和写 adapter 时用 |
| `-v, --verbose` | 调试日志 + 失败栈 |
| `--window <mode>` | `background`（默认）/ `foreground` / `isolated`。**`PUBLIC` / `LOCAL` 策略的命令不接受它**——加了直接报 `unknown option '--window'`，读起来像装坏了，其实是这类命令根本不开浏览器（实测 342 个 public + 25 个 local 命令）。先看 `strategy` 再决定加不加 |
| `--site-session <mode>` | `ephemeral`（默认）/ `persistent`，命令结束后是否留着会话标签页 |
| `--keep-tab <bool>` | 结束后是否保留标签页租约 |

---

## 五、现场驱动：最小闭环

```bash
S="recon-pricing"            # 描述性常量，Bash tool 里不要用 $$
opencli browser "$S" open "https://example.com/pricing"
opencli browser "$S" state                       # 拿到带 [N] 编号的快照
opencli browser "$S" click 7
opencli browser "$S" wait selector "[data-loaded]" --timeout 15000
opencli browser "$S" state                       # 页面变了就必须重新 state
opencli browser "$S" close
```

四条心智模型，够用来读懂所有返回：

1. **选择器优先的目标契约**：每个交互命令接受**一个** `<target>`，要么是 `state`/`find`
   给的数字 ref，要么是 CSS 选择器。多个匹配时用 `--nth <n>` 消歧。
2. **每个信封都报 `matches_n` 和 `match_level`**（`exact` / `stable` / `reidentified`）。
   CLI 已经替你救回了中等程度的 DOM 漂移，`match_level` 告诉你该有多信。
3. **先要紧凑输出，需要时再要全量**：`state` 是预算感知的快照；`network` 先给形状预览，
   再用 `--detail <key>` 取单条 body。吐一个巨大的 payload 等于白烧上下文。
4. **错误是机器可读的**：失败返回 `{error: {code, message, hint?, candidates?}}`。
   **按 `code` 分支，不要匹配消息字符串。**

完整命令表、目标契约、compound 表单控件、成本表、配方与坑，见
[`references/browser-driving.md`](references/browser-driving.md)。

### 三条最常被违反的规则

- **动手之前先看。** 先 `state` 或 `find`。数字 ref 是**每次快照独有的**，
  绝不要跨会话凭记忆写死。
- **页面变了就重新 `state`。** 导航、表单提交、SPA 路由切换都会让旧 ref 失效——
  失效还算好的，更糟的是 `reidentified` 到新页面上一个形状相似的元素。
- **`eval` 是只读的，而且必须包 IIFE。** 本环境 eval 上下文跨调用持续，
  重复声明会抛错**且那次调用根本没执行**。要改页面就用 `click`/`type`/`select`/`keys`，
  它们有结构化输出和指纹，`eval` 没有。

### batch：一次调用跑多步

固定序列（open → wait → eval）**一律用 batch**，它复用一条 Page 连接，
省掉每条命令各付一次的连接—解析—拆除开销。

```bash
opencli browser "$S" batch --commands '[
  {"cmd": "open", "args": ["https://example.com"]},
  {"cmd": "wait", "args": ["selector", ".loaded"]},
  {"cmd": "state", "args": []}
]'
```

返回 `{cmd, index, ok, result?, error?}` 数组；默认遇错继续，`--stop-on-error` 改为中止。
**条件逻辑**（每一步决定下一步）用顺序调用，不要硬塞进 batch。

---

## 六、取数与落盘

### 页面里没有 API 时的取数顺序

1. **`network`** —— 页面的数据如果来自 JSON 接口，**接口几乎总比渲染后的 DOM 可靠**。
   先 `network` 看形状，再 `--detail <key>` 取那一条。
2. **`extract`** —— 长文正文，返回带 `next_start_char` 游标，循环到它为 `null`。
3. **`eval`** —— 前两者都不合适时的定点提取。
4. **滚动抓表** —— 兜底手段，不是默认手段。**开抓之前先花一分钟找那个免费导出按钮**。

### 抓之前必须知道的三个坑

- **同名控件陷阱**：同一个报表上常并排放着两个名字高度相似的导出控件，一个走付费配额、
  一个免费导当前页，行为完全相反。**凡是要写下「某功能不可用」，先确认你点的不是同名的另一个控件。**
- **同一个工具里不同报表的导出模型可以完全不同。** 在 A 报表验证出「只能一页页导」，
  不构成 B 报表的结论。每换一个报表，重新看一眼导出面板。
- **导出触发器常常是 `<svg>` 图标**，没有 `.click()` 方法，要 `closest('button,[role=button],a')`
  往上找真正的按钮；面板异步挂载要**轮询等按钮出现**，不要用固定 sleep 或坐标点击。

### 落盘：抓到的数据不许留在下载目录

**首选本地接收端**：起一个只监听 `127.0.0.1` 的服务，让页面 `fetch(..., {method:'POST'})`
把数据直接送进项目目录。它一次性消掉四个问题——不用等文件落齐、不用归并重名副本、
不受下载目录权限影响、不占对话上下文。

**接收端的端口不能写死成常量**，理由和会话名不能写死完全同构：两个项目同时开工时，
第二个实例 `EADDRINUSE` 起不来，而后台常驻的常见写法会把输出丢进 `/dev/null`——
**这个失败是完全静默的**，随后页面的 `fetch` 照样返回 200，打到的是**另一个项目的接收端**。

完整的落盘 SOP（接收端写法、等齐判据、重名归并、manifest 校验）见
[`references/data-extraction.md`](references/data-extraction.md)。

---

## 七、坏了怎么办

**出问题之后回来查证据**：守护进程的日志按类落在 `~/.opencli/logs/`，
`opencli daemon logs`（默认 errors）/ `commands` / `extension` / `daemon`，
支持 `-n` 与 `--grep`。它从守护进程的下一次启动开始记，之前的没有留下来。

| 症状 | 先看哪里 |
|---|---|
| `doctor` 红、`session_not_found`、守护进程/扩展问题 | [`references/troubleshooting.md`](references/troubleshooting.md) |
| 读回来的页面不是你导航过去的那个 | **先怀疑会话撞名**，再怀疑站点或 CLI。诊断顺序见 [`references/session-laws.md`](references/session-laws.md) |
| `selector_not_found` / `stale_ref` / `click` 成功但没反应 | [`references/browser-driving.md`](references/browser-driving.md) 的排障表 |
| `opencli <site> <command>` 因为站点改版失败 | 用 `--trace retain-on-failure` 拿证据，按 [`references/adapters.md`](references/adapters.md) 的自修复流程改 adapter |

**自修复的硬停条件**（不要改代码）：`AUTH_REQUIRED`（叫用户去 Chrome 里登录）、
`BROWSER_CONNECT`（叫用户跑 `doctor`）、验证码 / 限流。修复预算最多 3 轮。

**「空」不等于「坏」。** `EMPTY_RESULT` 常常不是 adapter 的 bug：平台会在反爬启发式下
主动降级结果，站点也会用 HTTP 200 + 空 body 代替真正的 404。换个查询词、
在普通标签页里肉眼看一下，能复现再进修复流程——否则你是在给一个正常的 adapter 打补丁。

---

## 八、人机验证：自动化到最后一步

遇到 CAPTCHA、短信验证码这类无法自动化的节点，**把前面所有能自动完成的步骤全部做完**——
表单填好、选项选好、页面打开好——只把那一下点击留给用户，并明确告诉他
**现在浏览器里哪个标签页、需要点什么**。

不要把整条 SOP 甩回给用户，也不要在回复里写一串「请前往 https://…，然后输入…」。
目标是让用户的操作量从「一整套流程」降到「一次点击」。

---

## 九、参考文件

| 文件 | 什么时候读 |
|---|---|
| [`references/session-laws.md`](references/session-laws.md) | 会话/标签页出问题时；多 agent 并行开工前 |
| [`references/browser-driving.md`](references/browser-driving.md) | 要现场操作页面：点击、填表、等待、读取、截图 |
| [`references/data-extraction.md`](references/data-extraction.md) | 要把数据取回来并落盘：network / extract / 抓表 / 接收端 |
| [`references/adapters.md`](references/adapters.md) | 要写一个新 adapter，或修一个坏掉的 adapter |
| [`references/troubleshooting.md`](references/troubleshooting.md) | `doctor` 红、连不上、命令报的错自相矛盾 |
| [`references/drivers.md`](references/drivers.md) | 有人问「为什么不用 X」；或 OpenCLI 这条路确实走不通 |
| [`references/our-fork.md`](references/our-fork.md) | 命令在别人机器上不存在；升级/同步上游前 |

### 自带脚本

| 脚本 | 干什么 |
|---|---|
| `scripts/opencli-core.mjs` | 给 JS 调用方的最小封装：`defaultSession()` 生成安全的会话名、`batchBrowser()` / `openAndEval()` 包住 batch、`opencli()` 统一调用与 JSON 解析 |
| `scripts/receiver.mjs` | 本地接收端：页面把数据 POST 进项目目录，绕开下载目录。端口按项目根派生、占用即崩、`/ping` 回报 root、`/script` 按白名单喂提取器源码 |

```bash
node <opencli-skill-dir>/scripts/receiver.mjs --root . --out data/<主题>/raw
```

**不要每次重写接收端。** 自己写的版本十有八九会漏掉「端口占用时必须崩」这一条，
而那一条漏了的后果不是崩溃，是数据静默写进另一个项目的目录。

## 十、安装与更新

```bash
npx skills add yan-labs/yan-skills --skill opencli -g -y
npx skills update opencli -g -y
```

OpenCLI 本体分两半，**两半都要装我们的构建**，来源是
[yan-labs/OpenCLI 的 Release](https://github.com/yan-labs/OpenCLI/releases/latest)：

```bash
# 1) CLI
npm i -g https://github.com/yan-labs/OpenCLI/releases/download/v1.8.7-yan.2/opencli-cli-1.8.7-yan.2.tgz

# 2) 浏览器扩展：下载 opencli-extension-v*.zip 解压，
#    chrome://extensions → 开启开发者模式 → 加载已解压的扩展程序
#    ⚠️ 先移除或停用 Chrome 应用商店那个 OpenCLI

# 3) 验证：三行都要 [OK]，Extension 那行的版本 ≥ 1.0.32
opencli doctor
```

**为什么不能用应用商店那个版本**：本 Skill 描述的默认行为——后台模式默认、
在用户当前窗口开标签页、不切走活动标签页、`--window isolated`、`sessions` 报 windowId——
**全都只存在于我们的构建里**。商店版默认是前台，装了它本 Skill 的规则会与实际行为不符。
两个同时装还会一起连上守护进程互相打架。

差异清单见 [`references/our-fork.md`](references/our-fork.md)。

**改过扩展源码之后必须在 `chrome://extensions` 手动 reload 一次**才生效——
CLI 侧的改动重启守护进程即可，扩展侧的不会自动生效。**`opencli doctor` 打印的扩展版本
就是判据**：它显示什么，加载的就是什么。

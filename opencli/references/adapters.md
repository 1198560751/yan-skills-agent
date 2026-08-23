# Adapter：写一个，和修一个

一个 adapter 把「在这个站上做这件事」固化成 `opencli <site> <command>`，
之后任何 agent、任何运行时、任何脚本都能重复它。

**什么时候值得写**：这个动作以后还要做第二次。一次性排查不值得。
这与「可复用操作必须落成脚本」是同一条判据——现场驱动每次的做法都不一样，
结果不可比，踩过的坑要重踩。

## 目录

- [先定 strategy，再写代码](#strategy)
- [写：从骨架到 verify](#authoring)
- [adapter 的形状](#shape)
- [输出设计：columns 与 func 必须 1:1](#columns)
- [站点记忆](#memory)
- [修：坏掉的 adapter 怎么自修复](#autofix)

---

<a id="strategy"></a>
## 先定 strategy，再写代码

**每次动手写 `clis/<site>/<name>.js` 之前，必须先产出一段 strategy note。**
没有这段 note 就开始写，等于把「这个数据源到底稳不稳」这个决定推给未来的自己。

核心判断不是「API 比 DOM 高级」，而是**数据源有没有外部契约**。
实测维护成本：公开/官方接口最稳；UI/DOM 语义通常也有用户可见的契约兜着；
站内未文档化的 XHR/GraphQL/签名端点最容易漂。
**不要为了「API-first」把稳定的 UI/DOM 实现盲目迁到无契约的内部接口。**

| Strategy | 契约级别 | 什么时候用 | 证据要求 |
|---|---|---|---|
| `PUBLIC_API` | stable | 不需要登录，Node 侧 `fetch` 直接拿到目标数据 | 200 + JSON/HTML 含目标数据，不是埋点/广告 |
| `COOKIE_API` | stable | Node 侧 `fetch` + `page.getCookies()` 能拿数据 | cookie/CSRF 来源清楚，replay 非空 |
| `UI_SELECTOR` | visible-ui | publish / upload / click / 表单，或页面语义比内部接口更稳 | selector 有语义锚点；错误路径是 typed error |
| `DOM_STATE` | visible-ui | 数据在 hydration state / bootstrap JSON / SSR HTML 里 | state key / script JSON / HTML 结构明确 |
| `PAGE_FETCH` | internal-unstable | 只能在页面上下文 `fetch` 才能复用 same-origin / session / runtime | `eval fetch(...)` 非空；**必须解释为什么避不开内部接口** |
| `INTERCEPT` | internal-unstable | 请求签名复杂，但页面自己能自然发出请求 | 触发 UI 后能截到目标 response；**必须解释为什么 UI/DOM 不够** |

OpenCLI 上游按 adapter 修复频率统计过这个阶梯：
**`PAGE_FETCH` / `INTERCEPT` 的修复频率约为 `PUBLIC_API` 的 7–8 倍**，
`UI_SELECTOR` 与 `COOKIE_API` 同档。这是它们仓库的统计，不是我们自己测的——
量级可信，具体倍数不必当精确值用。

选择规则：优先 `PUBLIC_API` / `COOKIE_API`。如果 UI/DOM 语义稳定，
不要强行「升级」到 `PAGE_FETCH` / `INTERCEPT`。
只有在公开/官方接口不可用、且 UI/DOM 无法表达目标数据或操作时，
才承担无契约内部接口的维护成本。

### strategy note 模板

```
Strategy: PUBLIC_API | COOKIE_API | PAGE_FETCH | INTERCEPT | DOM_STATE | UI_SELECTOR
Contract: stable | visible-ui | internal-unstable
Evidence:
- observed request/state: <endpoint / state global / UI-only signal>
- auth source: <none / browser cookie / csrf from meta / localStorage / page runtime>
- replay result: <status + content-type + 非空样本形状>

如果 Strategy 是 PAGE_FETCH 或 INTERCEPT，额外回答：
- 为什么 PUBLIC_API / COOKIE_API 不可用：
- 为什么 UI_SELECTOR / DOM_STATE 不更安全：
- 为什么这份维护成本可以接受：
```

### 边界

**只复用页面自己已经合法获得的数据和能力。**
不破解签名、不绕验证码、不绕风控或访问控制。
遇到不可复用的签名（必须由页面 runtime 生成且不能安全抽象），
就降级到 `UI_SELECTOR` / `DOM_STATE` / `INTERCEPT`，而不是想办法把它逆出来。

---

<a id="authoring"></a>
## 写：从骨架到 verify

调试浏览器型 adapter 时直接带上 `--trace on --keep-tab true`：
每轮都落 trace artifact，`summary.md` 是复盘入口；保留 tab 租约方便核对最终页面状态。

**不要加 `--window foreground`。** 这台机器上的 Chrome 是用户正在用的那一个，
前台模式会把窗口抬起来抢走焦点，用户正在打字/看页面时被打断，且调试是高频动作——
一轮下来能打断十几次。**要核对页面状态就用 `screenshot` 或 `state`**，
它们在后台模式下同样工作（实测：后台模式下 `screenshot`、`click`、`type` 之后
用户的活动标签页与标签数都不变）。真的需要用眼睛看那一页时，
`--keep-tab true` 已经把标签页留在那里了，用户自己切过去看即可。

```
doctor 绿？ ─no→ 先修桥接（见 troubleshooting.md）
  │yes
  ▼
读站点记忆：~/.opencli/sites/<site>/{endpoints.json,notes.md}
  │命中 → 仍然要跑下面的 endpoint 验证（记忆会过期）
  ▼
站点侦察：这个数据在哪？（network / state / bundle / token / intercept）
  ▼
直接 fetch 验证候选 endpoint     ─401/403→ 回去排 token
  200 + 数据非空                  ─空/HTML→ 换一个 Pattern
  ▼
字段解码：比一条已知字段和网页肉眼值，确认没错位
  ▼
设计 columns
  ▼
opencli browser init <site>/<command>    # 生成骨架
复制最像的邻居 adapter，改 name / URL / 映射三处
  ▼
opencli validate                          # 语义检查，不联网不开浏览器
opencli browser verify <site>/<command>   # 端到端跑一遍
  │失败 → --trace retain-on-failure，见下面的自修复
  ▼
字段 vs 网页肉眼再对一遍             ─对不上→ 回字段解码
  ▼
回写 ~/.opencli/sites/<site>/
```

**两条容易跳过但必须做的：**

- **站点记忆命中也要跑 endpoint 验证。** 记忆是线索不是证据，站点换版之后
  它会以「代码没问题但数据是空的」这种形态骗你很久。
- **字段解码之后要和网页上肉眼看到的值对一次。** 字段错位（把 `views` 映射成 `likes`）
  在测试里全绿，只有对一眼才发现。

### 存放位置

- **私有**：`~/.opencli/clis/<site>/<command>.js` —— 不需要构建，热可用，不进公开包。
- **要提 PR**：仓库里的 `clis/<site>/<command>.js` —— 需要构建。

`opencli adapter eject <site>` 把官方 adapter 复制到本地供修改，
`opencli adapter reset [site]` 撤销，`opencli adapter status` 看哪些站有本地覆盖。

---

<a id="shape"></a>
## adapter 的形状

```js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
  site: 'example',
  name: 'article',
  access: 'read',
  description: '获取文章正文',          // 会出现在 opencli list 里，写清楚
  domain: 'www.example.com',
  strategy: Strategy.INTERCEPT,
  args: [
    { name: 'id', positional: true, required: true, help: 'Article ID 或完整 URL' },
  ],
  columns: ['field', 'value'],
  func: async (page, args) => {
    if (!id) throw new CliError('INVALID_ARGUMENT', 'Invalid article ID or URL');
    await page.installInterceptor('example.com/api');
    await page.goto(`https://www.example.com/p/${id}`);
    await page.wait(5);
    const data = await page.evaluate(`(() => { /* 返回 JSON-able */ })()`);
    if (!data?.title) {
      throw new CliError('NOT_FOUND', 'Article not found', 'Check the article ID');
    }
    return /* 键必须和 columns 一一对应 */;
  },
});
```

**只 import `@jackwener/opencli/registry` 和 `@jackwener/opencli/errors`，
不要引入任何第三方包。**

`page` 上可用的能力（写 adapter 时最常用的那些）：
`goto` / `evaluate` / `click` / `typeText` / `pressKey` / `scroll` / `autoScroll` /
`wait` / `getCookies` / `installInterceptor` / `getInterceptedRequests` /
`startNetworkCapture` / `readNetworkCapture` / `setFileInput` / `getFormState` /
`screenshot` / `networkRequests` / `consoleMessages`。

**错误一律用 `CliError(code, message, hint?)`**，不要 `throw new Error()`。
类型化错误是调用方能分支的东西，也是自修复流程的入口。

---

<a id="columns"></a>
## 输出设计：columns 与 func 必须 1:1

`columns` 必须在**名称和顺序上**与 `func` 返回对象的键一一对应。
对不上会在表格/CSV 输出里静默丢列——这是最常见的一类静默正确性回归。

另外三条：

- **字段名用调用方能理解的词**，不要照抄站点内部代号。内部代号写进站点记忆里做映射。
- **数值就是数值**，不要带单位后缀的字符串（`1.2万` 这种要在 adapter 里解开）。
- **顺序按重要性**：标识符 → 主体内容 → 元数据。表格输出会按这个顺序截断。

---

<a id="memory"></a>
## 站点记忆

跑通之后回写 `~/.opencli/sites/<site>/`：

| 文件 | 放什么 |
|---|---|
| `endpoints.json` | 验证过的 endpoint、参数、auth 来源 |
| `notes.md` | 这个站的坑：软 404、限流特征、改版历史、必须的 wait |
| `verify/<cmd>.json` | verify 用的断言 fixture |

**记忆是线索不是证据**，下次仍然要验证。但它能把「找到这个 endpoint」
从半小时压到一分钟。

---

<a id="autofix"></a>
## 修：坏掉的 adapter 怎么自修复

当 `opencli <site> <command>` 因为站点改版失败时，**自动诊断、修好、重试**，
而不是把错误报给用户就完事。

### 硬停条件（不要改代码）

| 情况 | 该做什么 |
|---|---|
| `AUTH_REQUIRED`（退出码 77） | **停**。让用户去 Chrome 里登录那个站 |
| `BROWSER_CONNECT`（退出码 69） | **停**。让用户跑 `opencli doctor` |
| 验证码 / 限流 | **停**。这不是 adapter 的问题 |

**修复预算：每次失败最多 3 轮**诊断 → 修 → 重试。3 轮没解决就停下来，
报告试过什么。

**修改范围**：只改 trace `summary.md` front matter 里 `adapterSourcePath` 指的那个文件。
**绝不改** `src/`、`extension/`、`tests/`、`package.json`、`tsconfig.json`。

### 进修复流程之前：「空」不等于「坏」

`EMPTY_RESULT`——有时还有结构上合法但返回空的 `SELECTOR`——**常常不是 adapter 的 bug**。
平台会在反爬启发式下主动降级结果，「没找到」不代表内容真的不在。
**在投入一轮修复之前先排除这些：**

- **换个查询词或入口再试。** 如果 `search "X"` 返回 0 而 `search "X 攻略"` 返回 20，
  adapter 是好的——平台在给第一个查询塑形。
- **在普通 Chrome 标签页里肉眼看一下。** 数据在用户浏览器里看得见而 adapter 返回空，
  通常是登录态、限流或软封，不是代码 bug。修法是重新登录，不是编辑源码。
- **注意软 404。** 不少站点在内容被隐藏或删除时返回 HTTP 200 + 空 payload 而不是真 404，
  快照看起来结构完全正确。隔两三秒重试能区分「临时隐藏」和「真的没了」。
- **搜索返回「0 条」本身就是一个答案。** 成功到达了搜索端点、拿到 200、
  平台返回 `results: []`，就该把「这个查询没有匹配」报告给用户，而不是给 adapter 打补丁。

只有在**跨重试、跨入口都能复现**时才进 Step 1。否则你是在给一个正常工作的 adapter
打补丁，而打完的版本会把原本能走通的路径弄坏。

### Step 1：拿证据

```bash
opencli <site> <command> [args...] --trace retain-on-failure 2>trace-error.yaml
```

失败时 stderr 除了常规错误信封，还会多一个 `trace` 块，里面有
`summaryPath` / `receiptPath` / `dir`。**先读 `summaryPath`**——
它是给 LLM 看的入口，front matter 里有 `adapterSourcePath`、`errorCode`、`errorMessage`。

artifact 目录里还有 `receipt.json`、`trace.jsonl`、`network.jsonl`、
`console.jsonl`、`state/`、`screenshots/`。

**不要让用户用旧的诊断环境变量重跑。** trace 就是修复的证据路径。

### Step 2：按错误码分类

| 错误码 | 可能原因 | 修法 |
|---|---|---|
| `SELECTOR` | DOM 重构、class/id 改名 | 探当前 DOM → 找新选择器 |
| `EMPTY_RESULT` | 响应 schema 变了，或数据挪了位置 | 看 network → 找新的响应路径 |
| `API_ERROR` | endpoint 变了、需要新参数 | 用 network 发现新接口 |
| `TIMEOUT` | 页面加载方式变了、spinner/懒加载 | 加/改 wait 条件 |
| `PAGE_CHANGED` | 大改版 | 可能要重写 |

**探当前站点时用 `opencli browser`，绝不要用那个坏掉的 adapter**——它只会再失败一次。

### Step 3：改，然后验证

改动规则：

1. **最小改动**，只修坏掉的部分，不顺手重构。
2. **保持输出结构不变**，`columns` 和返回格式必须向后兼容。
3. **发现 JSON 接口就优先于 DOM 抓取。**
4. **只用 `@jackwener/opencli/*` 的 import。**
5. **绝不为了让失败变绿而放松 `verify/<cmd>.json` 的 fixture。**
   `patterns` / `notEmpty` / `mustNotContain` / `mustBeTruthy` 挂掉，
   说明 adapter 的输出是坏的。**唯一**能在修复中合法改 fixture 的理由是
   **站点自己变了形状**（比如 URL 格式迁移）——那种情况改 fixture 并把变更记进
   `~/.opencli/sites/<site>/notes.md`。否则改 fixture 就是在掩盖一次静默的正确性回归。

```bash
opencli validate                            # 语义检查
opencli verify <site>/<command>             # 用合成参数跑
opencli browser verify <site>/<command>     # 在桥接里端到端
```

修好并验证之后，如果这个 adapter 来自上游，值得把修复回报上游——
下一次别人就不用再修一遍。

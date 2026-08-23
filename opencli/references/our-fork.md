# 我们这个 fork 与上游的差异

**为什么需要这一篇**：本 Skill 描述的一部分能力**只存在于我们的 fork 里**，
而它缺席时有两种截然不同的表现：

- **CLI 缺席 → 吵闹**：命令直接报 `unknown command`，只是错得像「装坏了」而不是「版本不对」。
- **扩展缺席 → 安静，而且危险得多**：`--window isolated` 这类标志照样被接受，
  命令照样返回成功，**只有行为回到上游**——默认前台、自己开窗口、抢走用户的活动标签页。
  没有任何报错，只有「怎么和文档说的不一样」。

第二种是装了 Chrome 应用商店那个扩展的默认下场。`opencli doctor` 现在会主动报它。

上游是 `jackwener/opencli`，我们的 fork 是 `yan-labs/OpenCLI`。

---

## 装哪一个

发布在 [yan-labs/OpenCLI 的 Release](https://github.com/yan-labs/OpenCLI/releases/latest)，
CLI 与扩展**两半都要装我们的**：

```bash
npm i -g https://github.com/yan-labs/OpenCLI/releases/download/v1.8.6-yan.1/opencli-cli-1.8.6-yan.1.tgz
# 扩展：下载 opencli-extension-v*.zip 解压 →
#   chrome://extensions → 开发者模式 → 加载已解压的扩展程序
#   并把 Chrome 应用商店那个 OpenCLI 移除或停用（两个都装会一起连守护进程互相打架）
```

**只装 CLI 不换扩展是最容易踩的坑**：命令全都能跑，行为却是上游的——
默认前台、自己开窗口、抢走活动标签页。`opencli doctor` 会在扩展低于 1.0.27 时主动报这一条。

## 先确认你在跑哪一个

```bash
opencli --version
npm ls -g @jackwener/opencli
```

如果 `npm ls -g` 的输出指向一个**本地路径**（而不是 `node_modules` 里的实体目录），
说明 CLI 是从源码 `npm link` 过来的——**它的行为等于那个仓库的当前构建**，
而不是 `--version` 打印的那个版本号所对应的发布版。

这条在排障时很关键：版本号可以完全正常，而行为来自一个未发布的本地提交。

```bash
cd <npm ls -g 指出的路径>
git remote -v            # 确认是 fork 还是上游
git log --oneline origin/main..HEAD   # 我们领先上游的部分
```

---

## fork 独有的能力

| 能力 | 在哪一侧 | 缺了它会怎样 |
|---|---|---|
| **后台是默认值** | 扩展 + CLI | 默认变成前台：每条命令抬窗口、抢走用户正在看的标签页 |
| **在用户当前窗口开标签页** | 扩展 | 每次都新开一个 1280×900 的窗口砸在用户布局上 |
| **`--window isolated`** | 扩展 + CLI | 标志被**静默忽略**，行为等同 `background` |
| **自动化跟着用户换窗口** | 扩展 | 一直往用户早就离开的那个窗口里堆 |
| **`sessions` 报 windowId** | 扩展 + CLI | 「谁占着哪个标签页」只能靠眯眼看浏览器猜 |
| **借来的窗口不留占位页** | 扩展 | 释放最后一个租约时在用户标签栏留一个 `about:blank` |
| **批量执行** `browser batch` | CLI/守护进程 | 固定序列只能一条条调，每条各付一次连接开销 |
| **`browser sessions` / `cleanup`** | CLI + 扩展 | 看不到当前有哪些租约，也没有一键释放 |
| **动态标签页组标题** | 扩展 | 分组标题固定是 `OpenCLI Browser`，看不出哪个组属于哪个任务 |
| **不存在会话的护栏** | 扩展 | 对不存在的会话跑 `state`/`eval` 会静默新建空白标签页，制造孤儿页 |

**`batch` 是唯一一个纯 CLI/守护进程层的能力**，官方商店版扩展也能用。
其余全部或部分在扩展侧——**只换 CLI 不换扩展，等于什么都没换**。

---

## 扩展侧改动要手动 reload

这是最容易漏的一步：

- **CLI 侧的改动** → `opencli daemon restart` 就生效。
- **扩展侧的改动** → 必须去 `chrome://extensions` 手动点一次 reload。

改完扩展源码、构建完、却发现行为一点没变，几乎总是漏了这一步。

**约定：每改一次扩展就顶一次 `manifest.json` 的版本号**，于是
`opencli doctor` 打印的扩展版本就是「加载的到底是哪个构建」的判据。
这条是 2026-08-23 定下的——在那之前版本号钉死在 1.0.22，改了代码也不变，
「装进去没有」从外面根本观测不到，一个 bug 因此来回验证了六轮。

---

## 已知回归与修复（读排障时的背景）

护栏（拒绝对不存在的会话执行不带 URL 的命令）落地时，判据写得过宽——
它用「这条命令带没带 URL」来推断「这是不是导航命令」。
有三类调用天生不带 URL，于是被误杀：

1. `open` 自己（它先开网络捕获再导航，捕获命令不带 URL）；
2. `opencli doctor` 的连通性探针（`evaluate('1 + 1')`）；
3. 所有走浏览器的 adapter 租约（`COOKIE` / `INTERCEPT` / `UI`）。

表现是：`doctor` 前两行 `[OK]`、第三行 Connectivity FAIL，
`open` 报 `session_not_found` 并提示「先用 open 打开一个 URL」——**提示自相矛盾**。

修复把护栏收窄到只管 `opencli browser <session>` 这条用户通道
（adapter 租约不受影响），并让 doctor 的探针先用 `tabs op:new` 建好会话。

**留下的通用判据**：提示信息在逻辑上自相矛盾时，先怀疑本地构建，
不要照着提示打转。详见 [`troubleshooting.md`](troubleshooting.md)。

---

## 同步上游时注意

- 我们领先的提交都在浏览器会话/批量这条线上，冲突面集中在
  `src/cli.ts`、`src/browser/page.ts`、`extension/src/background.ts`。
- **合完必须跑** `vitest run --project unit --project extension --project adapter`。
  扩展那一组测试是最灵敏的：护栏那次回归就是被它抓住的
  （合入时带着 10 个红测试，说明当时没跑）。
- 合完还要**实跑一遍最小闭环**：`opencli doctor` 三行绿，
  再 `open` 一个真实页面并 `extract` 出内容。单测绿而端到端挂，
  正是护栏那次事故的形态。

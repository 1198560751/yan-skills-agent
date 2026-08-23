# 我们这个 fork 与上游的差异

**为什么需要这一篇**：本 Skill 描述的一部分能力**只存在于我们的 fork 里**。
在别人的机器上、或者在装了 npm 官方版的环境里，这些命令会报 `unknown command`，
而报错长得像「装坏了」而不是「版本不对」。遇到这种情况先来这里对一眼。

上游是 `jackwener/opencli`，我们的 fork 是 `yan-labs/OpenCLI`。

---

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

| 能力 | 命令 | 缺了它会怎样 |
|---|---|---|
| **批量执行** | `opencli browser <session> batch --commands '[...]'` | 固定序列只能一条条调，每条各付一次连接开销 |
| **全局会话管理** | `opencli browser sessions` / `opencli browser cleanup` | 看不到当前有哪些租约，也没有一键释放；排查「标签页被抢」少一个最直接的入口 |
| **动态标签页组标题** | 自动生效 | Chrome 里的分组标题固定是 `OpenCLI Browser`，人没法一眼看出哪个组属于哪个任务 |
| **不存在会话的护栏** | 自动生效 | 对着一个不存在的会话跑 `state`/`eval` 会静默新建空白标签页，制造孤儿页 |

`batch` 跑在 CLI/守护进程层，**不需要**重新构建的扩展，官方商店版扩展也能用。
**动态标签页组标题和护栏在扩展侧**，需要装我们重新构建的扩展才生效。

---

## 扩展侧改动要手动 reload

这是最容易漏的一步：

- **CLI 侧的改动** → `opencli daemon restart` 就生效。
- **扩展侧的改动** → 必须去 `chrome://extensions` 手动点一次 reload。

改完扩展源码、构建完、却发现行为一点没变，几乎总是漏了这一步。
扩展的 `manifest.json` 版本号不一定跟着改，所以 `doctor` 打印的扩展版本
**不能用来判断加载的是不是新构建**。

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

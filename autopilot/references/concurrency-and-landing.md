# Concurrency and Landing

定义单写者模型、本地互斥租约、共享工作树的路径安全、受保护分支落地序列。
在任何 maker 编辑、commit、rebase、push 或发布之前加载本文件。

前提：现在同一台机器上经常有多个 agent / 多个 worktree 共享同一个 git 仓库。
"我是唯一在改这个仓库的人"是一个**必须被证明的假设**，不是默认事实。

## 并发模型

- **产品级归属真相**：外部协调面（Issue claim、任务票、协调评论）——跨 run、跨机器可读。
- **机器级互斥**：仓库 git common directory 下的原子租约——同一 git 仓库内的排他。
- **跨机器正确性栅栏**：Git fast-forward / rebase + 远端 ancestry 回读。

以下**不能**当作开发锁：

- CI/Actions 的 concurrency group（它序列化 workflow，不序列化本地编辑和 commit）；
- worktree 本地的锁文件（共享同一 git 仓库的兄弟 worktree 看不见它）；
- 分支名、Git author/login、进程列表；
- 外部 DB / Redis / 新建 secret。

## Git-common-dir 租约

锁目录：

```bash
$(git rev-parse --path-format=absolute --git-common-dir)/<automation>/locks/
```

用原子 `mkdir` 获取，然后写**不可变**元数据：
`owner`(稳定 owner ID) / `run`(run ID) / `token`(每次获取随机) /
`purpose`(`maker` 或 `landing-<branch>`) / `created_epoch` / `expires_epoch` / `worktree` / `pid`。

写完**逐字段回读**。缺失、重复、格式错误、不匹配或未知元数据一律判为冲突。
**绝不能只凭 PID 推断归属。**

### 过期与释放

- **不要原地续租。** TTL 覆盖一个有界增量即可。
- 过期时，把锁目录**原子重命名**到唯一的 stale 隔离名，再获取新锁。
  因为元数据不可变，过期不会和续租竞争。
- 只有 owner + run + token + purpose 四项都与回读一致时才释放。
  释放方式是原子 rename 到唯一路径再删除该路径；**绝不 `rm -rf` 活锁路径**。
- 进程猝死时，交给下一个 controller 去隔离过期的不可变租约。
- 时间或元数据有歧义时 fail closed。

### Maker 租约

第一次写入之前获取 `maker`，持有一个有界编辑增量。获取后、写入前
**重新校验产品级归属**（Issue claim 可能已被别人接管）。
maker checkpoint + 本地针对性 gate 通过后释放。

只读的调查者/checker 可以不持 maker 租约运行——除非它在一个正在变化的工作树上
跑 dev server。**把浏览器/dev-server checker 视为持有隐式读租约**：
在服务器和浏览器停止之前，不允许启动 maker。

### Landing 租约

在下列整个序列之前获取 `landing-<target>`，并**全程持有**：

路径归属校验 → staging → commit → fetch/rebase → push → 远端 ancestor 回读。

这防止共享同一 git common dir 的两个 worktree 同时成为 commit/push owner。

## 共享工作树路径安全

staging 之前：

1. **拒绝任何已存在的 staged 内容**，包括恰好落在本次请求路径下的内容
   （别人可能刚 stage 了同一个文件）。
2. fetch，并要求 HEAD 等于目标或只落后于目标；干净时快进，**不要 stash**；
   有脏重叠就停。ahead/diverged 状态在 commit 之前就失败。
3. 要求一份**精确、规范化、仓库相对**的文件清单。拒绝绝对路径、仓库外路径、
   目录、glob、重复项、Git 元数据、状态文件、不安全的缺失路径和特殊文件。
4. 逐个 stage 清单文件，并要求 staged 集合**等于**清单；禁止后代目录匹配。
5. 如果一个任务自有路径里同时含有无法归因的并发编辑，停止并报告冲突。

**绝不使用 `git add -A` / `git add .`。**
**绝不 stash / restore / checkout / reset / 覆盖他人的改动。**
同一个文件混合归属且无法安全分离时，停止并报告碰撞。

## 受保护分支落地序列

在 landing 租约下：

1. 校验请求路径、初始索引为空、远端关系、staged diff。
2. 只把任务自有路径提交为**一个** run-owned commit。
3. run-commit 身份校验与清单相等性**分开**校验。如果 hook 改变了提交的路径集合：
   soft-reset 该 HEAD 到记录的父提交、用 mixed reset 恢复初始空索引、回读 HEAD/索引、
   保留所有工作树字节，然后在 push 之前停止。
4. 遇到 non-fast-forward：只有在 checkout 干净时才 rebase/重试。存在他人脏状态时，
   只 soft-reset 已证明属于本 run 的那个 commit 到其父提交、unstage 显式任务路径、
   回读 unstaged diff，然后停止。
5. 其它任何失败的落地路径，**要么证明该 commit 已到达远端，要么执行同样的
   精确单 commit 回滚**；绝不留下孤立的未推送 commit。
6. 用 `git push origin HEAD:refs/heads/<target>` 显式 refspec 推送。
7. 再次 fetch。
8. 要求 `git merge-base --is-ancestor <delivery-sha> origin/<target>` 成功。

**绝不 force push。**

## 远端 non-fast-forward

把 non-fast-forward 拒绝当作**可能的跨机器竞争**，不是覆盖的许可。

最多两个恢复周期：fetch 目标 → 校验本地任务 commit 和路径归属仍可归因 →
rebase 到 fetch 到的目标 → 任何冲突或意外的任务路径变化都停止 →
重试显式 refspec push → fetch 并回读 ancestry。

网络/TLS 重试单独计次。保留原始 Git 错误分类，但不要打印凭据。

**本地租约只证明同 git-common-dir 的排他性，它不能证明另一台机器是空闲的。**
Git 快进/rebase + 远端回读才是跨机器的正确性栅栏。
有界重试后仍无法证明 ancestry、任务路径身份或排他落地归属时，fail closed。

## Review / 部署归属

review 之后的所有最终 mutation 由**同一个 landing owner** 负责。
checker 可以提出修改建议，但**不 commit、不 push**。
修复路由回 maker → 重跑相关 gate → 由 landing owner 执行唯一一次最终落地序列。

一批任务共用一套部署/review，但每一项都要记录自己独立的验收和终态决定。

## 清理时的成果保护顺序

清理必须"先证明成果不会丢失，再删东西"：

1. `git status --short --untracked-files=all`，区分任务文件、用户文件、其它并发任务文件；
2. 确认本任务 commit 已推到目标远端（`git log origin/<t>..HEAD` 为空
   且 `git merge-base --is-ancestor <task-commit> origin/<t>` 成功）；
3. 发现有效但未推送的 commit → 先按保护分支规则 push/rebase，**再**清理；
   推不上去就 hard-stop 并保留 worktree，报告抢救路径。
   **绝不为了"清理干净"删除成果。**
4. 只删除能证明由本任务创建的路径；禁止宽泛 glob；状态文件最后删。

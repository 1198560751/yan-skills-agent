# yan-skills

[Yan](https://github.com/yan-labs) 的 agent skills —— 自用打磨、实测可跑，适用于 Claude Code / Codex / Cursor 及任何兼容 SKILL.md 的平台。

Agent skills by [Yan](https://github.com/yan-labs), battle-tested in daily use. Works with Claude Code, Codex CLI, Cursor, and any SKILL.md-compatible platform.

## 安装 / Install

```bash
# 交互式选择
npx skills add yan-labs/yan-skills

# 全局安装仓库内全部 Skills
npx skills add yan-labs/yan-skills -g --all

# 只安装 rankup
npx skills add yan-labs/yan-skills --skill rankup -g -y

# 更新已安装的 rankup
npx skills update rankup -g -y
```

## 本地开发 / Local development

如果你要修改这些 Skill 本身，建议把全局技能目录直接链接到本仓库，让全局只存在一份真源：

```bash
git clone https://github.com/yan-labs/yan-skills.git
cd yan-skills

# 建立或修复链接（把被替换掉的实体目录先备份，不直接删除）
node scripts/link-skills.mjs

# 只检查是否有漂移，发现问题退出 1，适合放进 CI 或定期巡检
node scripts/link-skills.mjs --check
```

链接建立之后，仓库里的改动即时生效，**不要再对这些 Skill 运行 `npx skills update`** —— 那会把符号链接换回实体目录副本，双份维护随之回归。

两道保护：

- `rankup` 的自动更新会检测仓库根的 `.skill-source` 标记，识别出自己正从源码运行时拒绝执行更新（`blocked / source-checkout`），因此定时检查不会覆盖你的本地改动。该标记位于仓库根，`skills add/update` 只复制单个 Skill 子目录，所以它永远不会随安装副本分发，也不会误伤项目级安装。
- 万一链接仍被替换掉，重跑 `node scripts/link-skills.mjs` 即可恢复。

## Skills

### [`autopilot`](autopilot/) — 一句话到无人值守执行完毕

接收一句模糊指令，自动调查、分类、拆解为阶段计划、选 skill、定完成判定，然后无人值守执行到底 —— 包括自动部署、自动 E2E 测试、自动代码 review，不跳过任何阶段。

依赖：无。

### [`skill-link-check`](skill-link-check/) — Skill 源目录与运行时链接审计

检查项目级和全局 `.agents/skills` / `.claude/skills` 是否遵守“前者保存真实源文件、后者使用父级或逐项符号链接镜像”的约定。输出孤儿目录、缺失链接、重复目录、断链和错误目标，并给出需人工复核的修复命令；支持 JSON 证据和明确项目路径，适合接入 `/goal` checker，但不会自动修改被审计目录。

依赖：Python 3.10+。

### [`rankup`](rankup/) `2.7.0` — 网站全生命周期总控

`gt`（Google Trends 查询 + 选词工作流）于 2026-08-16 并入本 Skill 并删除：四个趋势子命令（热度对比、地区分布、相关飙升、每日热搜）与三套工作流（小语种市场探测、模糊词收敛成可做站的词、新兴趋势捕捉）现在是 [`references/trends.md`](rankup/references/trends.md) 加 `scripts/gt.py`。合并时发现 `gt/scripts/kd.py` 与本 Skill 已有的 `scripts/seo-webcafe.mjs` 打的是同一个 KD 端点、用的是同一种 `wc_mcp_` 令牌，只是两套实现两个变量名，因此删掉重复的那份，KD 统一走 `seo-webcafe.mjs kd`。**代价照例说明**：`gt` 原本的触发面（谷歌趋势、热搜、"这两个词哪个火"）现在要经由 `rankup` 才能到达，description 已补上这批词。


从机会调研、产品设计和 TanStack Start Monorepo 初始化开始，协调 Cloudflare Workers、D1、R2、Wrangler、Stripe、SEO、内容、外链、上线验证与长期迭代。已有网站也可以从当前阶段接入，不会强制重建。

两个入口降低心智负担：`rankup init` 把新项目或已做很久但还没接入的项目一次性接进来（摸清现状 → 建 `.rankup/` → 补基线与体检 → 出计划）；`rankup review` 定期回顾（对账、合并重复经验、淘汰过时结论、把通用规则提炼回流、体检脚本新鲜度、刷新跨项目名单）。

三层归属互不混淆：**Skill** 只带剥离站点后仍成立的通用方法与规则（由 `scripts/validate-rankup.mjs` 断言，出现站点名、绝对路径、本机代理或凭据位置即构建失败）；**项目** 的事实、数字、裁决与可复用脚本留在各自 `<project>/.rankup/`；**本机** 的 `rankup/registry.md` 是跨项目资产索引，由 `rankup/scripts/registry.mjs scan` 扫描生成；它含项目路径，故被 gitignore 排除并由构建断言拦住 `git add -f`。

每个网站在仓库内使用 `.rankup/` 保存项目事实、架构、决策、基线、实验、发布和日志；密钥文件只记录名称、用途、环境和 Secret 系统位置，真实密钥永远不写入 Git。`skill.json` 与 `.rankup/skill-state.json` 用于记录发布版本、项目启用时间和自动更新状态。自我进化协议负责失败分类、证据分级、适应性重试和通用规则晋升。

依赖：按任务安装 Wrangler、Cloudflare Workers、Stripe、backlink 或其他专项 Skills。

### [`backlink`](backlink/) — 外链发现、资格判定与证据化验证

以 OpenCLI 复用已授权的浏览器会话，覆盖竞品外链发现、机会资格判定、递归评论者域名采集、安全填表与提交守卫、台账记录，以及「已提交 / 已上线 / follow 或 nofollow / 已收录」的逐级证据核验。目录宣传不等于可传递权重的外链，最终公开页必须核对 URL、重定向与 `rel`。

同时覆盖外链画像分析（质量评分、毒性判定、锚文本分布、竞品交集、外联模板）与登录态后台批量取数——这两块原是独立 Skill，见下。

依赖：Node.js 18+、OpenCLI 及使用者自己的授权数据源；第三方面板入口通过 `TOOLS_SHARE_DASHBOARD_URL` 与 `TOOLS_SHARE_APP_ORIGIN` 提供，不随 Skill 分发。

### 已并入 `backlink` 的两个 Skill（2026-08-16）

原先的 `backlink-analyzer` 与 `browser-harvest` 已合并进 `backlink` 并删除，从三个减到一个：

- **`backlink-analyzer`**（外链质量、毒性与竞争缺口分析）本身是一套纯提示词模板，没有脚本也没有浏览器通道——能描述外链画像，却拿不到画像。现为 `backlink/references/` 下的 `link-quality-rubric.md`、`analysis-templates.md`、`outreach-templates.md`，保留上游 [aaron-he-zhu/seo-geo-claude-skills](https://github.com/aaron-he-zhu/seo-geo-claude-skills) 的 Apache-2.0 许可证与归属。
- **`browser-harvest`**（从登录态后台批量取数）现为 `backlink/references/harvest.md` 加三个 `scripts/harvest-*`。它沉淀的是四个必踩的坑——虚拟滚动表格没有 `<table>`、数据出不了页面沙箱、执行通道超时不等于任务失败、后台标签不 mount 且定时器会被密集节流——以及一组「输出看着正常、数据其实错了」的守卫。**注意合并的代价**：这套知识本身是通用的（广告平台、电商后台都适用），现在却挂在一个以外链命名的 Skill 下；做与外链无关的后台取数时，仍然加载 `backlink` 再读那一篇。

## License

除另有标注的第三方内容外，仓库内容采用 MIT License。`backlink/references/` 下三份分析模板来自上游 Apache-2.0 项目，许可证副本与归属说明保留在同目录的 `LICENSE-analysis-templates-Apache-2.0`。

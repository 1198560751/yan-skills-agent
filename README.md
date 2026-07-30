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

## Skills

### [`gt`](gt/) — Google Trends 查询 + SEO 选词工作流

四个基础查询：关键词热度对比曲线、地区热度分布、相关飙升查询、每日热搜榜。脚本自带 venv 自举，处理好了 pytrends 的 urllib3 兼容坑和限流提示。

真正的价值在三套内置工作流：

- **W1 小语种市场探测**：全球扫描 over-index 国家 → 趋势健康度筛选 → 本地语 vs 英语内容决策 → 挖当地真实搜法
- **W2 模糊词 → 可做站的 SEO 词**：多角度扩词（痛点/对比/场景/问句）→ Google Trends 验证收敛 → 输出可执行决策表
- **W3 新兴趋势捕捉**：rising 词雷达 + 新词 vs 类目老词对比，区分起飞和昙花一现

依赖：python3（`hot` 子命令额外需要 [opencli](https://github.com/jackwener/opencli)，可选）。

### [`autopilot`](autopilot/) — 一句话到无人值守执行完毕

接收一句模糊指令，自动调查、分类、拆解为阶段计划、选 skill、定完成判定，然后无人值守执行到底 —— 包括自动部署、自动 E2E 测试、自动代码 review，不跳过任何阶段。

依赖：无。

### [`rankup`](rankup/) `2.0.1` — 网站全生命周期总控

从机会调研、产品设计和 TanStack Start Monorepo 初始化开始，协调 Cloudflare Workers、D1、R2、Wrangler、Stripe、SEO、内容、外链、上线验证与长期迭代。已有网站也可以从当前阶段接入，不会强制重建。

每个网站在仓库内使用 `.rankup/` 保存项目事实、架构、决策、基线、实验、发布和日志；密钥文件只记录名称、用途、环境和 Secret 系统位置，真实密钥永远不写入 Git。`skill.json` 与 `.rankup/skill-state.json` 用于记录发布版本、项目启用时间和自动更新状态。自我进化协议负责失败分类、证据分级、适应性重试和通用规则晋升。

依赖：按任务安装 Wrangler、Cloudflare Workers、Stripe、GT、backlink 或其他专项 Skills。

### [`backlink`](backlink/) — 自动化目录提交与外链发布工作流

通过 Mac Mini 上的 `bb-browser` 批量处理免费目录提交，并覆盖 IndexNow、Awesome List、公开引用仓库、结果复核与链接属性验证。

依赖：Mac Mini SSH、Node.js 18+、`bb-browser`。

### [`backlink-analyzer`](backlink-analyzer/) — 外链质量、风险与竞争缺口分析

分析 referring domains、链接质量、锚文本、毒性风险、竞品链接交集和外链建设机会，附带报告、评分与外联模板。

来源：[aaron-he-zhu/seo-geo-claude-skills](https://github.com/aaron-he-zhu/seo-geo-claude-skills)，Apache-2.0；许可证保留在 Skill 目录内。

## License

除另有标注的第三方 Skill 外，仓库内容采用 MIT License。`backlink-analyzer` 保留其上游 Apache-2.0 许可证与归属说明。

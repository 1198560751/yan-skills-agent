# Rankup 集成与专项 Skill 路由

Rankup 负责识别需求、选择专项能力和保持项目记录；专项 Skill 负责各自领域的操作细节。只安装当前任务需要的依赖，并在执行前确认用户授权范围。

## 已验证的 Skills CLI 命令

以下命令的 `add`、`update`、`--skill`、`-g`、`-y` 和 `--all` 语法已用当前 Skills CLI 帮助与仓库清单核对：

```bash
# 安装或刷新 yan-skills 仓库中的全部 Skill
npx skills add yan-labs/yan-skills -g --all

# 更新全局安装的 rankup
npx skills update rankup -g -y

# 只安装外链执行 Skill
npx skills add yan-labs/yan-skills --skill backlink -g -y

# 只安装外链分析 Skill
npx skills add yan-labs/yan-skills --skill backlink-analyzer -g -y

# Cloudflare 资源、绑定、迁移、密钥和部署
npx skills add cloudflare/skills --skill wrangler -g -y

# Cloudflare Workers 代码与运行时最佳实践
npx skills add cloudflare/skills --skill workers-best-practices -g -y

# Stripe 支付与计费集成规范
npx skills add stripe/ai --skill stripe-best-practices -g -y

# 搜索尚未覆盖的专项能力
npx skills add vercel-labs/skills --skill find-skills -g -y
```

这些示例采用全局范围。项目级安装时遵循 Skills CLI 当前帮助所示的项目范围选项，并在项目内记录实际安装范围。安装依赖只增加本地能力，不代表用户授权修改外部账户。

## 路由表

| 需求 | 使用的 Skill | 使用时机 | 写回 `.rankup/` |
|---|---|---|---|
| Cloudflare 登录、资源查询、bindings、D1 migrations、R2、Worker Secrets、日志 tail、发布与回滚 | `wrangler` | 任何 Cloudflare 控制面或 CLI 操作 | `infrastructure.md`、`secrets.md` 元数据、`releases.md`、日志 |
| Worker 代码、运行时 API、资源限制、性能、安全和代码审查 | `workers-best-practices` | 编写或审查 Worker、SSR 服务端和 bindings 使用方式 | `architecture.md`、`audit.md`、决策 |
| 支付、订阅、Checkout、Billing、Webhook 或 Stripe 数据模型 | `stripe-best-practices` | 仅当支付或计费明确进入任务范围 | `integrations.md`、`secrets.md` 元数据、`releases.md` |
| 趋势方向、关键词热度、区域或时间变化证据 | `gt` | 机会调研、内容选题和关键词复核 | `keywords.md`、`baseline.md`、实验 |
| 外链盘点、质量评估、差距和风险 | `backlink-analyzer` | 任何外链执行之前，以及周期性复查时 | `audit.md`、`baseline.md`、计划 |
| 已批准的外链获取、提交和结果验证 | `backlink` | 分析完成、目标和风险经用户确认后 | `plan.md`、日志、实验 |
| 当前列表没有覆盖某项明确能力 | `find-skills` | 先描述能力缺口，再搜索候选 Skill | `decisions.md`、`integrations.md` |

## Cloudflare 路由

涉及 Cloudflare 时先读取项目的 `.rankup/infrastructure.md` 和 `.rankup/secrets.md` 元数据，再根据任务调用 Wrangler：

1. 用 Wrangler 检查身份与目标环境，不在记录或输出中暴露凭据。
2. 先查询现有资源和 bindings，再决定创建、迁移或修改。
3. D1 schema 变更必须有 migration、目标环境和回滚/恢复说明。
4. binding 变化后重新生成类型，并让 Worker 代码与配置保持一致。
5. 部署后验证真实 SSR HTML、API、bindings、上传、认证和适用的回调路径。
6. 将非敏感资源标识、验证结果和回滚点写回项目记忆。

`workers-best-practices` 与 `wrangler` 可以同时使用：前者约束代码和运行时设计，后者负责 CLI、账户资源和部署操作。

## Stripe 路由

只有用户的产品范围明确包含支付或计费时，才安装或调用 `stripe-best-practices`。执行前确认：

- 测试模式还是生产模式；
- 一次性支付、订阅或其他计费模型；
- 产品、价格、税务、退款和取消规则；
- 服务端创建流程、客户端边界和 Webhook 幂等策略；
- Cloudflare 环境中的密钥存储位置与绑定名称；
- 成功、失败、重试和退款的验证标准。

真实凭据和 Webhook 签名材料绝不写入 `.rankup/`。项目记忆只记录非敏感对象标识、环境、集成状态、验证证据和密钥元数据。任何从测试模式到生产模式的切换都视为独立发布，需重新核对资源、回调地址、监控和回滚方案。

## 趋势、SEO 与外链路由

- 使用 `gt` 补充趋势证据，但不要把单一趋势曲线当作需求或排名结论。
- 先用 `backlink-analyzer` 建立现状、质量、差距和风险证据。
- 只有目标已获批准时才使用 `backlink` 执行获取或提交；完成后验证链接是否存在、属性是否符合预期、页面是否可访问。
- 将关键词、外链和结果证据分别写入对应项目文件，避免把一次观察提升为通用规律。

## 能力发现

当现有路由不能覆盖明确任务时：

1. 用 `find-skills` 按能力而不是按模糊产品名搜索。
2. 优先选择官方提供方或可信维护者，并检查描述、依赖、更新活跃度和权限范围。
3. 安装前说明为什么需要该 Skill、会触达什么系统，以及替代方案。
4. 将选择、版本/来源、适用范围和风险记录到 `.rankup/integrations.md` 或 `decisions.md`。
5. 新依赖仍受 Rankup 的密钥、验证和授权边界约束。

## 权限边界

安装或更新 Skill 不授权以下行为：

- 修改外部账户、计费设置或成员权限；
- 购买产品、域名、套餐或付费服务；
- 删除生产资源、数据、域名、支付对象或历史记录；
- 在用户请求范围之外部署、迁移或切换生产流量；
- 获取、复制、打印或持久化真实密钥；
- 执行外链购买、批量提交或其他未批准的对外操作。

读取状态和准备本地配置可以作为正常诊断或实施步骤；涉及上述外部变更时，必须有用户请求所覆盖的明确授权，并在执行后写回可验证结果。

## 授权与宽限期

- **[2026-08-02] "永久授权"套用为订阅设计的宽限期计算,会把"没有期限"悄悄变成"从现在起算"**:典型写法 `graceBase = periodEnd ?? trialEnd ?? now`,对订阅正确,对永久授权则在两者都为空时回落到 `now`,于是买断用户在离线若干小时后被判为过期。规矩:永久授权必须走**独立分支**,不进入任何以到期时间为基准的计算;写这类回落链时逐个问"每个候选值为空时,语义还成立吗"。
- **配套铁律:服务端修完必须在客户端做同一条兜底**。被卡住的机器恰恰是离线的那台——它永远拉不到你修好的服务端响应,只会一直读本地旧缓存。只改服务端等于只修好了"还没出问题的用户"。

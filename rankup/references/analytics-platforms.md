# 数据分析平台接入：Clarity · Firebase · Ahrefs

阶段 7.5 的子环节。与 [`search-platforms.md`](search-platforms.md) 平行：
搜索平台管「搜索引擎怎么看你」，分析平台管「用户怎么用你、外链怎么指向你」。
同样是**每建一个站都要原样做一遍**，本文档记录操作步骤和自动化脚本。

## 先看这张顺序表

| 顺序 | 做什么 | 依赖 | 自动化程度 |
|---|---|---|---|
| 1 | **Microsoft Clarity 创建项目 + 埋追踪代码** | 微软账号 | 半自动（`clarity-setup.mjs create` 拿 ID → 手动把代码写进 `<head>`） |
| 2 | **Firebase 创建项目 + 添加 Web 应用** | Google 账号 | 半自动（`firebase` CLI 或控制台 UI → 手动把 config 写进代码） |
| 3 | **Ahrefs 创建项目 + 所有权验证** | Ahrefs 账号 | 半自动（`ahrefs-setup.mjs create` → `verify` 通过 GSC 自动验证） |

## 1. Microsoft Clarity

### 它是什么

免费的会话录制和热力图工具。GA4 能告诉你「哪些页面跳出率高」，
Clarity 能告诉你「用户到底在那个页面上做了什么」——鼠标轨迹、滚动深度、
愤怒点击（连续点同一个地方却没有响应）。两者并走，不是替代关系。

### 追踪代码

```html
<script>
(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "<PROJECT_ID>");
</script>
```

`<PROJECT_ID>` 替换为 Clarity 控制台分配的值（形如 `xzmumryb8r`）。
这是公开值，会出现在页面 HTML 里，不是秘密。

### 自动化

```bash
# 查看当前账号下所有项目
node <rankup-skill-dir>/scripts/clarity-setup.mjs status

# 创建新项目并拿到追踪 ID
node <rankup-skill-dir>/scripts/clarity-setup.mjs create --site example.com --name mysite
```

### 当前站点状态

| 站点 | Project ID | 埋码位置 |
|---|---|---|
| intabtools.com | `xzmumryb8r` | `apps/web/src/analytics.ts`（consent-gated） |
| shindan.co | `y6pkwiitlr` | `apps/web/src/routes/__root.tsx` 行 88–90 |
| birthstonemeaning.com | `xof2x9i52w` | `apps/web/src/analytics.tsx`（inline script） |

## 2. Firebase

### 它是什么

Google 的应用开发平台。在 Rankup 的语境下主要用三件事：
1. **GA4 关联**——Firebase 项目关联 GA4 property，一个控制台看行为+事件数据
2. **Crashlytics / Performance Monitoring**——如果上了原生 SDK 才用得上，纯 Web 暂不涉及
3. **Remote Config / A/B Testing**——灰度实验框架，需要 SDK 支持

对纯 SSR 站（TanStack Start + Cloudflare Workers），GA4 已经独立埋好了，
Firebase 项目的主要价值是**把 GA4 property 归口到同一个 Google 账号下管理**，
以及为将来的 SDK 功能预留位置。

### 怎么做

推荐用 Firebase CLI（`npm install -g firebase-tools`）：

```bash
# 登录（只需一次）
firebase login

# 创建项目（--id 如果被占用会报错，换一个）
firebase projects:create --display-name "shindan" --id shindan-co

# 列出项目
firebase projects:list

# 添加 Web 应用（返回 config JSON）
firebase apps:create web "shindan" --project shindan-co
firebase apps:sdkconfig web --project shindan-co
```

也可以走控制台 UI：`console.firebase.google.com` → 创建项目 → 添加应用 → Web `</>` → 复制 config。

### 当前站点状态

| 站点 | Firebase 项目 ID | measurementId | appId |
|---|---|---|---|
| intabtools.com | `intabtools` | `G-J0KH92GFCT` | `1:1029383685466:web:39a3569335d450e04b1f63` |
| shindan.co | `shindan-co` | `G-FQF1K95VDW` | `1:228020203160:web:76cecdc39068b3d85d6aed` |
| birthstonemeaning.com | `birthstone-meaning` | — | — |

> birthstone-meaning 是之前已有的项目，config 见项目代码。

## 3. Ahrefs

### 它是什么

SEO 工具，核心能力是反向链接分析。在 Rankup 里用它：
1. **Site Explorer**——看竞品的外链从哪来、用什么锚文本、DR/UR 变化趋势
2. **Site Audit**——技术 SEO 健康检查（需验证所有权才能启动）
3. **排名跟踪器**——监控目标关键词的 SERP 排名变化
4. **Backlink 监控**——新增/丢失外链通知

与 `backlink` Skill 的关系：`backlink` Skill 驱动 Ahrefs 做盘点和执行，
Rankup 负责项目初始化和维持监控覆盖。

### 自动化

```bash
# 查看 Dashboard 上的项目列表
node <rankup-skill-dir>/scripts/ahrefs-setup.mjs status

# 创建新项目（所有权验证可稍后补）
node <rankup-skill-dir>/scripts/ahrefs-setup.mjs create --site example.com --name mysite

# 通过 GSC 验证所有权（需浏览器已登录 Google 且 GSC 拥有该站点）
node <rankup-skill-dir>/scripts/ahrefs-setup.mjs verify --site example.com
```

### 所有权验证

项目创建后处于「冻结」状态。验证方式（任选一种）：

| 方式 | 操作 | 推荐场景 |
|---|---|---|
| DNS TXT 记录 | 在 Cloudflare DNS 添加 Ahrefs 指定的 TXT 记录 | 站点由 Cloudflare 管理（可 API 自动化） |
| HTML 标签 | 在 `<head>` 添加 `<meta name="ahrefs-site-verification" content="...">` | 代码能快速部署时 |
| HTML 文件 | 在根目录放置验证文件 | Workers 站点不方便（需要额外路由） |
| Google Search Console | 连接 Google 账号自动验证 | GSC 已接入且愿意授权 Ahrefs 读 GSC 数据 |

### 当前站点状态

| 站点 | 项目状态 | 验证状态 |
|---|---|---|
| intabtools.com | 活跃（健康 100） | ✅ 已验证 |
| birthstonemeaning.com | 活跃（健康 100） | ✅ 已验证 |
| shindan.co | 活跃 | ✅ 已验证（GSC） |

## 新站接入清单

每建一个新站，按此清单依次执行：

```
□ 1. Clarity：clarity-setup.mjs create → 拿到 ID → 写进 <head>
□ 2. Firebase：firebase projects:create → firebase apps:create web → 记录 config
□ 3. Ahrefs：ahrefs-setup.mjs create → ahrefs-setup.mjs verify（GSC 自动验证）
□ 4. 部署站点（确认追踪代码上线）
□ 5. 去各平台确认数据开始采集
```

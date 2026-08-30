# platforms/ — 数据平台页面手册

这是一套以 Markdown 为主体的数据平台知识库。**每个平台页面一个目录**，`PAGE.md`
是主体（这个页面有什么功能、什么数据、什么坑），脚本只是挂在该页下面的「执行按钮」，
截图是该页的视觉档案。Agent 做任何事之前先读 Markdown 知道有什么，再决定执行哪个脚本
——不要反过来先跑脚本再猜页面。

## 目录约定（平台 / 板块 / 页面 三级）

```
platforms/
  README.md                     ← 本文件
  <平台>/                       ← 如 semrush/ similarweb/
    OVERVIEW.md                 ← 平台级：host、套餐边界、配额纪律、平台级坑
    <板块>/                     ← 如 traffic-analytics/ organic-research/
      OVERVIEW.md               ← 板块级：路由索引表（哪些页已有 PAGE.md、哪些待建）
      <页面>/                   ← 如 top-pages/ keyword-gap/
        PAGE.md                 ← 主体：功能、数据、坑、验证记录
        collect.sh              ← 执行按钮：一条命令完成该页采集（可选，可多个）
        assets/                 ← 视觉档案：代表性截图（gitignore，不入公开仓库）
```

## PAGE.md 模板（各节按需增删，单文件 100–200 行为宜）

| 节 | 写什么 |
|---|---|
| 页面身份 | URL 模板与参数逐个解释、host、页面标题 |
| 回答什么业务问题 | 一两句话，这页存在的理由 |
| 数据清单 | 页面上每一块数据：卡片区 / 表格逐列 / 分页规模 |
| 形状与就绪 | table 还是 chart-only、数据几秒落 DOM、正确的就绪判据、滚动/懒加载行为 |
| 怎么采 | collect.sh 的用法（参数、输出目录），必要时手动交互配方 |
| 已知坑 | 会骗人的判据、假付费墙、shadow DOM、重定向别名等 |
| 验证记录 | 何时、用什么方法验证过，本地证据目录路径 |

## 使用方式：先读 Markdown，再执行脚本

1. 接到任务先 `ls platforms/<平台>/`，读平台 OVERVIEW → 板块 OVERVIEW → 目标 PAGE.md。
2. PAGE.md 说这页能回答你的问题 → 跑该页的 `collect.sh`（配额纪律见平台 OVERVIEW）。
3. PAGE.md 没有你要的页 → 板块 OVERVIEW 的「待建」表看有没有已知路由，先做地面真值
   采集（`backlink/scripts/ground-truth.mjs` 双证人），判决后再新建页面目录补 PAGE.md。
4. 采集回来的证据由 AI 对质双证人后，把结论回写进 PAGE.md 的「验证记录」——
   **PAGE.md 是活文档，每次验证都要留下日期和证据路径**。

## 截图约定

- `assets/` 里的截图来自登录后的付费面板，**不进公开仓库**：`.gitignore` 已有
  `platforms/**/assets/`。文件名用语义名（`loaded.png`、`buckets.png`），不用 shot-N。
- PAGE.md 引用截图时按相对路径写（`assets/loaded.png`），clean checkout 里链接会断，
  属预期——文字描述必须自足，截图只是佐证。

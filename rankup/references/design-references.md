# 设计组件库参考站：搭架子之外的视觉层

**这份文件的用途只有一个**：脚手架（`shadcn init --preset …`）解决项目结构，
`components/ui/` 解决基础控件，但**页面级的视觉设计——Hero 怎么排、动画怎么做、
landing page 用什么布局——脚手架不管，组件库也不管**。
下面这批外部站是真人设计工程师做的现成案例，AI 在做页面设计时**必须先去翻一遍**，
找到合适的再适配进项目，而不是凭空画。

三条阅读约定：

1. **这些是参考，不是依赖。** 不要 `npm install` 它们的包或把源码整段复制；
   看到合适的组件，理解它的设计思路和实现方式，然后用项目自己的 shadcn 组件库
   和技术栈**重新实现**或**适配**。部分站（如 21st.dev）提供可直接粘贴的 prompt，
   这种可以直接用，但产出的代码仍须符合项目的组件规范。
2. **浏览有目的。** 不是打开首页随便逛——带着具体的页面需求去搜分类
   （Hero / Footer / Background / Card / Navigation / Pricing），
   看 3–5 个案例就够做决策，不要把整个库扫一遍。
3. **这份表会持续扩充。** 每收录一个新站，写清楚它和已有站的差异覆盖，
   不要堆一列功能相同的站。

---

## 收录站

### 21st.dev

| | |
|---|---|
| **地址** | https://21st.dev |
| **定位** | React + shadcn 生态的社区组件库，12000+ 组件、模板和主题 |
| **与项目技术栈的关系** | **直接兼容**——基于 shadcn，和我们的脚手架同一套生态 |
| **核心分类** | **Marketing blocks**（animated heroes、hero sections、shaders、liquid & metal effects、backgrounds、gradients、footers）<br>**UI components**（buttons、AI chats、cards & grids、galleries & 3D、navigation、sign-ins & widgets）<br>**Templates**（完整页面模板）<br>**Themes**（shadcn 主题变体） |
| **使用方式** | 组件以 prompt 形式分发——复制 prompt 粘贴到 Claude Code 即可生成适配当前项目主题的组件代码 |
| **什么时候去看** | 做 landing page、Hero 区、定价页、页脚、404 页、登录页等**页面级设计**时；需要动画、动效、渐变背景等视觉效果时；找不到设计灵感时 |
| **什么时候不要去** | 只需要基础 UI 控件（button、input、dialog）时——那些直接 `shadcn add` |
| **入口 URL** | 组件：`/community/components`；模板：`/community/templates`；主题：`/community/themes`；按分类：`/community/components/s/<分类>` |

### Libraries.dev

| | |
|---|---|
| **地址** | https://libraries.dev |
| **定位** | React 视觉特效库集合——5 个独立 npm 包（border-beam、thinking-orbs、liquid-gooey、metal-fx、img-fx），专注动效和着色器效果 |
| **与项目技术栈的关系** | **直接兼容**——React 18+，零运行时依赖（img-fx 除外需 three），MIT 开源；和 shadcn 组件库互不冲突，特效叠在组件上 |
| **核心分类** | **Border beam**（彩虹光圈沿边框跑动）<br>**Thinking orbs**（AI 接口的思考态加载球）<br>**Gooey**（液态融合变形效果）<br>**Liquid Metal**（实时铬金属环，按钮和图标用）<br>**Image generation**（WebGL 图片生成加载器） |
| **使用方式** | 每个库以 prompt 形式分发——复制 prompt 粘贴到 Claude Code / Cursor，agent 自动 `npm install` 并接入项目；Pro 版解锁 Studio 深度定制 |
| **什么时候去看** | 需要**动画特效、加载态、边框光效、液态/金属质感**等视觉点缀时；给 AI 功能做 thinking 状态指示时；想给按钮、卡片、图标加微交互时 |
| **什么时候不要去** | 需要页面级布局（Hero、定价页、页脚）时——那是 21st.dev 的覆盖范围；需要基础控件时——直接 `shadcn add` |
| **与 21st.dev 的差异** | 21st.dev = 组件和页面模板（广度），Libraries.dev = 动效和着色器特效（深度）；两者互补，不重叠 |
| **入口 URL** | 各库 playground：`/beam.html`、`/orbs.html`、`/gooey.html`、`/metal.html`、`/image.html`；使用说明：`/how-to-use.html` |

---

## 使用时机：什么场景触发浏览

| 场景 | 动作 |
|---|---|
| 用户要求做一个「好看的」「有设计感的」「精美的」页面 | **必须先浏览**至少一个收录站的相关分类，找 2–3 个参考案例再动手 |
| 做 landing page / Hero / 定价页 / 关于页 | **建议浏览**——这些页面的视觉质量直接影响转化 |
| 需要动画、动效、过渡效果、背景特效 | **建议浏览**——特效类先看 Libraries.dev（border beam / orbs / gooey / metal），页面级动效看 21st.dev 的 animated heroes 和 shaders 分类 |
| 做内页、工具页、表单页等功能导向页面 | **不必浏览**——用 shadcn 组件库即可 |

## 浏览流程

1. **明确需求**：要做什么页面、什么区块（Hero / Footer / Background / …）。
2. **按分类搜索**：去收录站的对应分类页浏览，按热度排序看前几个。
3. **选 2–3 个候选**：截图或记录组件名，带回给用户确认方向。
4. **适配实现**：理解设计思路，用项目自己的技术栈实现。如果收录站提供
   可直接粘贴的 prompt（如 21st.dev），可以直接使用，但产出代码须检查：
   - 是否符合项目的组件目录结构（`components/ui/`）
   - 是否正确使用了项目的设计令牌（颜色、字体、间距）
   - 是否有占位内容（红线）
   - 响应式是否达标

## 与现有规则的关系

- **不替代 shadcn 组件库红线**：基础控件（下拉框、弹窗、日期选择、表格分页、Toast）
  仍然只准来自 `components/ui/` 或 `shadcn add`，这条不变。
- **不替代 `/imagegen`**：页面里的图片素材（logo、og:image、配图）仍然用 imagegen 生成，
  组件库参考站解决的是**布局和交互设计**，不是图片素材。
- **不替代段 4 体检**：参考外部组件做出来的页面，段 4 全套检测照跑。

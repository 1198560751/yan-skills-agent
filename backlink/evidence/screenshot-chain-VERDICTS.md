# 截图链路实盘判决书

2026-08-30。三波双证人重构把「截图 + DOM 证人成对落盘」写进了约 37 个浏览器脚本，
但全部是离线写的代码——`opencli browser <session> screenshot <path>` 在各封装形态下
从未在真 Chrome 上跑过。本次逐项实盘，环境：opencli 1.8.7 / 扩展 1.0.32，
起跑前零活动会话。

**总判决：截图链路全线出图，无一处封装形态写错。** 发现并修掉 1 个真 bug
（demand `captureBrowserScene` 吞掉截图失败原因），另记 3 条「不是 bug 但会误读证据」
的事实。

---

## 第一梯队 —— 零配额验证

| # | 验证了什么 | 实际结果 | 出图 |
|---|---|---|---|
| 1 | 裸 `opencli browser <session> screenshot <path>` | 两种形态都成功：`browser S screenshot P` 与 `browser S --window background screenshot P`（后者是 opencli-core 注入 `--window` 后的实际 argv 顺序，CLI 接受） | ✅ 41227 B，PNG 2560×1646 |
| 2 | `backlink/scripts/lib-evidence-scene.mjs` `captureScene()` | census + png 成对落盘，`censusError`/`screenshotError` 均 null；剥敏生效（census 里 href 只留 path，`__gmitm=` 只剩键名） | ✅ png 41227 B / census 20891 B |
| 3 | `rankup/scripts/lib-scene.mjs` `captureScene()`（截图回调由调用方注入） | 仓库里两种真实注入形态都出图：**形态 A** execSync 引号版 `cli(\`screenshot "${p}"\`)`（clarity-setup / ahrefs-setup / gsc-remove-urls / naver-setup / webmaster-sitemap）、**形态 B** execFileSync 数组版 `browser(session,["screenshot",p])`（ahrefs-site-audit / gefei-ask / gt-browser / webcafe-forum）。故意给不存在的目录 → 错误进 `scene.errors`、不抛、另一个证人照常落盘 | ✅ 各 41227 B，manifest 3 幕 |
| 4 | `rankup/scripts/demand/_lib.mjs` `captureBrowserScene()`（spawnSync + `--window`） | 正常路径文本证人 + 截图成对；会话名不存在时文本证人退化成 `session_not_found` 现场文件、`shot=null`——**但原因被静默吞掉，见下方 Bug 1** | ✅ png 41227 B / page.json 240 B |
| 5a | 真实脚本失败路径：`rankup/scripts/demand/chrome-stats.mjs`（chrome-stats.com，非配额站），`--path /chrome/definitely-not-a-real-list-xyz` 故意制造 404 | 走 `zero-cards` 分支，退出前落 `zero-cards-shot.png` + `zero-cards-page.json` + manifest（`stopReason: died: zero_cards`，`sources[].scene` 带两个证人的绝对路径）。肉眼看图：确实是 chrome-stats 的「Page not found」页——「这次没取到」和「榜单为空」现在真的分得开 | ✅ 1115368 B，2560×1534，可读 |
| 5b | 真实脚本：`backlink/scripts/page-read.mjs`（公开页） | 成功路径落 `scene-page-read.png` + census；换成不可解析域名时，Chrome 自己的 `ERR_CONNECTION_CLOSED` 错误页被完整取证（脚本不判断这是不是失败，交给 AI 看图——符合设计） | ✅ 40092 B / 76084 B |

## 第二梯队 —— 配额站最小验证

| # | 验证了什么 | 实际结果 | 出图 |
|---|---|---|---|
| 6 | `backlink/scripts/ground-truth.mjs`，Semrush `/analytics/traffic/top-pages/?q=canva.com`（会话 `semrush-nav`） | `lockHeld=true, lockWaitMs=3`（整轮持机器级锁）；`eagerReload=true`（打开即刷新生效，首刷不计入 `refreshCount=0`）；`readyAfterMs=27139`，`readyBranch="table"`，`filledCells=850`；`hijacked=false`；4 组 census+shot 成对，4 个截图 md5 互不相同（滚动确实动了）；`stopReason=max-screens`，exit 0 | ✅ 235809 / 333683 / 358233 / 354063 B，肉眼可读真数据表 |
| 7 | `backlink/scripts/semrush-batch.mjs`，1 个域名 `example.com --db us` | 行内 `evidence.screenshot` 真有图、`evidence.screenshotError=null`；**`verdict` 字段确实已不存在**（`hasOwnProperty("verdict") === false`）；`parse=parsed, organicTraffic=9800, authorityScore=53, stopReason=stable`。肉眼看图：Semrush 域名概览页，自然流量 9.8K / AS 53，与解析值一致 | ✅ 362704 B |

会话纪律：全程只用自己的会话名（`shotchain-*`）与脚本自带的 `semrush-nav`，
结束逐个 `close`，**没有跑过 cleanup**，收尾时 `opencli browser sessions` 为空。

---

## 发现并修复的问题

### Bug 1（已修）：`captureBrowserScene` 把截图失败的原因整个吞了

`rankup/scripts/demand/_lib.mjs` 的截图分支原本是
`if (r.status === 0 && fs.existsSync(file)) out.shot = file;` 加一个空 catch——
拍不到时 `out.shot` 是 `null`，**而「这次没拍成」和「压根没打算拍」长得一模一样**。
兄弟实现 `lib-evidence-scene.mjs` 一直记 `screenshotError`，两边契约不一致。

已改为记录 `out.shotError`（`r.error.message` / stderr / `exit N`，压平空白截 300 字），
返回对象初始化为 `{ text: null, shot: null, shotError: null }`。
补了一条测试：假 opencli 在场但 `screenshot` 子命令退 4 → 文本证人照常落盘、
`shot=null`、`shotError` 匹配 stderr。`rankup/tests/demand-lib-evidence.test.mjs` 6/6 绿。

## 不是 bug，但会让人读错证据的三件事

1. **census 的 `href` 只有 path+search+hash，没有 host。** 这是 `CENSUS_EXPR` 的
   刻意设计（落点自检比的是路由，host 不进证据）。`example.com` 上取到 `href: "/"`
   是对的，不是取证失败。
2. **`deep.textLength` 恒在 1.6M 上下，是浏览器扩展的 shadow DOM，不是页面内容。**
   实测 example.com（正文 129 字符）读出 1598835：用户 Chrome 里的 Doubao 翻译
   与 aitdk 两个扩展各注入约 533K 字符的 shadow root，被穿透统计三次算了进去。
   ground-truth.mjs 的文档早已写明「就绪判据是 filledCells > 0，不是文本长度」，
   本次实测确认了那条结论的成因。`deepText` **样本**的开头仍是真页面文本
   （主 root 排第一），扩展的 CSS 从中段开始灌——读样本只信开头。
3. **第 6 步的截图拍到的是 nytimes.com，不是 canva.com。** 打开的 URL 明明是
   `?q=canva.com`，Semrush 自己追加了 `lid=1234971`（上次用的 .Trends 列表），
   页面渲染的是该列表的域名。这与 SKILL.md 已记录的规则一致：
   「Traffic Analytics 整棵树只要带 `lid=` 就忽略 `q=`，`q=` 是装饰」。
   ground-truth 的落点自检只比 path/hash，**看不见主体域名被换掉**——
   跑 Traffic Analytics 路由时必须自己核对 `lid=`，或看 census 的 deepText 头部。
   （历史 evidence 目录复查：带 lid 的 24 轮里绝大多数 `q=` 与渲染域名一致，
   只有 `recheck-page-groups`、`semrush-round4-email-nytimes` 两处对不上——
   同一类漂移，不是本次新引入的。）

## 仍存问题

- ground-truth 的 manifest 不记「页面实际在讲哪个域名」。这需要判断，按
  one-collector-per-quota-tool 的分工不该由脚本下结论；但 manifest 里连
  最终 `href`（含 `lid=`）都没有，AI 想发现漂移必须自己去翻 census 文件。
  值不值得加一个纯机械的 `finalHref` 字段，留给下一轮决定。
- 第一梯队只覆盖了三个共享取证库和 2 个真实脚本。其余脚本用的都是这三种封装
  形态之一（已逐个 grep 核对过注入写法），未逐脚本实跑。

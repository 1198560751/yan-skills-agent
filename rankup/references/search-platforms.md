# 搜索平台接入：站长工具与 IndexNow

阶段 7.5 的一个子环节，独立成文是因为它**每建一个站都要原样做一遍**，
而每次重新摸索的成本远高于抄一份。这份文档要回答三件事：

1. 一个新站要接哪几样，按什么顺序；
2. 每样怎么自动化（现成脚本在哪、参数怎么给）；
3. 哪些步骤**不允许**自动化，必须由用户本人点。

## 先看这张顺序表

**按「依赖什么」排序，不按「哪个重要」排序。** 前两项不依赖任何第三方账号，
所以它们不会被「用户的账号暂时不可用」阻塞——先把它们做完，站就已经在往外推内容了。

| 顺序 | 做什么 | 依赖 | 自动化程度 |
|---|---|---|---|
| 1 | **IndexNow 密钥文件上线** | 无 | 全自动（`indexnow-submit.mjs --generate-key` + 站点路由） |
| 2 | **IndexNow 首次全量推送** | 无 | 全自动（`indexnow-submit.mjs`） |
| 3 | **Bing Webmaster 所有权验证** | 微软账号 | 半自动：meta 标签由你写进代码，**验证按钮由用户点** |
| 4 | **GSC 资源创建 + 所有权验证** | Google 账号 | 半自动：TXT 记录可由你写 DNS，**验证按钮由用户点** |
| 5 | **两边提交 sitemap** | 已验证的资源 | 全自动（`webmaster-sitemap.mjs`） |
| 6 | **每次内容变更后推 IndexNow** | 无 | 全自动，应当挂进发布流程 |

**IndexNow 排在站长工具前面，是因为它一样都不欠。** 它不需要账号、不需要验证、
不需要等谁批准——一个密钥文件就是全部凭据。把它排到后面，等于白白等着账号问题解决的那几天。

## 1–2. IndexNow

### 它是什么，不是什么

IndexNow 是一个开放协议：你在自己域名上放一个密钥文件，就获得了「主动告诉搜索引擎
某些 URL 变了」的权利。Bing、Yandex、Seznam、Naver 共用同一张网，推一次全都收到。
**Google 不参与**——Google 那侧只有 sitemap 和 Search Console，不要指望 IndexNow 能替代它们。

「已接受」不等于「已收录」。接口回 200 的意思是队列收下了，收录与否、多久，仍然由各家自己决定。
任何把 IndexNow 说成「立刻收录」的说法都是错的。

### 怎么做

```bash
# 生成密钥（只打印，不写文件——写去哪里由项目决定）
node <rankup-skill-dir>/scripts/indexnow-submit.mjs --generate-key

# 全量推送：URL 列表从线上 sitemap 取
node <rankup-skill-dir>/scripts/indexnow-submit.mjs \
  --site-url https://example.com --key <密钥>

# 只推刚改过的几页（日常应当用这个，不要每次全量）
node <rankup-skill-dir>/scripts/indexnow-submit.mjs \
  --site-url https://example.com --key <密钥> /pricing /zh/pricing
```

### 密钥文件必须由应用层提供，不能是静态文件

这一条在任何「静态资源绑定 + 应用/Worker」的架构上都成立：**静态资源会抢在应用之前响应**，
所以放进静态目录的密钥文件会**永久遮蔽**应用里的同名路由，之后轮换密钥必须重新构建、重新部署。
把它做成应用层的一条路由，轮换就只是改一个常量。

Cloudflare Worker 里的形状（`robots.txt` 和 `sitemap.xml` 同理，同一个原因）：

```ts
// INDEXNOW_KEY 是公开值：协议本来就靠「你能在自己域名上放出它」证明所有权。
// 它可以进源码、进 git——但要在注释里写明它不是机密，否则后人会当泄露删掉。
if (path === `/${INDEXNOW_KEY}.txt`) {
  return new Response(INDEXNOW_KEY, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}
```

### 挂进发布流程

在项目里加一条 npm script，让「发完版顺手推一下」不依赖谁记得：

```json
{ "scripts": { "indexnow": "node <rankup-skill-dir>/scripts/indexnow-submit.mjs --site-url https://example.com --key <密钥>" } }
```

推送时机是**部署完成之后**，不是构建之后：脚本会先校验密钥文件，而密钥文件在部署完成前还是旧的。

### 三个坑

1. **密钥文件不可达时，整批提交被丢弃，而接口照样回 200。**
   这是脚本默认先 GET 一次密钥文件的唯一理由。没有这一步，「推送成功」这句话在
   密钥没部署、拼错、或被静态资源抢答时**逐字一样**地打印出来。
   判据是密钥文件正文 trim 后**逐字节等于**密钥。
2. **URL 列表从线上 sitemap 取，不要在脚本里维护数组。** 硬编码数组会和实际发布的页面漂移，
   而漂移方向永远是「新页面没推」。sitemap 已经是那份清单了。
3. **`host` 必须与 urlList 每一条的主机名一致**，否则整批 422。子域算不同主机，
   `www.` 与非 `www.` 也算。脚本会先自查再提交。

## 3–4. 站长工具的所有权验证

### 验证方式怎么选

**优先「网域」资源（DNS 验证）而不是「网址前缀」**：前者覆盖全部子域与 http/https，
后者一个前缀一份资源，`www` 与非 `www` 要建两份。

各方式的取舍：

| 方式 | 代价 | 适用 |
|---|---|---|
| DNS TXT | 要能写 DNS | **首选**，唯一能建「网域」资源的方式 |
| HTML meta 标签 | 一行代码 + 一次部署 | 没有 DNS 权限、或只需要「网址前缀」资源时 |
| 上传 HTML 文件 | 与 meta 同级，但多一个静态文件要维护 | 没理由优先它 |
| 「从其它平台导入」 | **给对方一个对你另一个平台账号的长期 OAuth 授权** | 见下，默认不用 |

### 两条不允许代替用户做的

- **「授权访问你的 DNS 服务商账号」那个按钮，不得代替用户点。** 它给出的是对用户 DNS 账号的
  长期访问权，属于必须由用户本人决定的动作。等价替代：把验证方式切到「任何 DNS 提供商」，
  取回 TXT 值，由**你**通过 DNS API 写入记录，再让用户点验证——一样自动化，且不产生任何长期授权。
- **Bing 的「从 Google Search Console 导入」同理。** 它省下的是几分钟，换来的是
  Bing 对用户 Google 账号的长期 OAuth。HTML meta 验证达到完全相同的效果，
  代价是一行代码。默认走 meta，除非用户明确要求导入。

meta 标签的形状（token 是公开值，本来就印在每一页的 HTML 里）：

```ts
{ name: "msvalidate.01", content: BING_SITE_VERIFICATION }   // Bing
{ name: "google-site-verification", content: GSC_TOKEN }      // GSC（网址前缀资源）
```

### 域名有「前世」时

上线后第一件事是对首页提交「请求编入索引」，把搜索引擎对该域名的旧记忆（停放页、旧站）
尽快覆盖掉。这件事越早越好，且**必须用正确的资源做**——见下一节。

## 5. 提交 sitemap

```bash
# 先读状态（只读）
node <rankup-skill-dir>/scripts/webmaster-sitemap.mjs gsc  status --property sc-domain:example.com
node <rankup-skill-dir>/scripts/webmaster-sitemap.mjs bing status --site https://example.com

# 提交
node <rankup-skill-dir>/scripts/webmaster-sitemap.mjs gsc  submit --property sc-domain:example.com --sitemap sitemap.xml
node <rankup-skill-dir>/scripts/webmaster-sitemap.mjs bing submit --site https://example.com --sitemap https://example.com/sitemap.xml
```

### 为什么是浏览器而不是 API

本 Skill 的取数优先级是 API 高于浏览器。这里是**确实没有零配置 API**的少数场景之一：

- **GSC** 的 Search Console API 能提交 sitemap，但要先建 GCP 项目、开 API、配 OAuth 同意屏幕、
  跑一次授权码流程，还要长期保管一串 refresh token。为一次 sitemap 提交做这一整套不划算。
- **Bing** 有一个后台一键生成的 API key，`POST https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=…`。
  **项目如果已经有那把 key，Bing 这半边就该走纯 HTTP**，不必用浏览器。

所以脚本的定位是**零配置的默认路径**，不是「唯一路径」。

### 选错资源是这类后台最贵的错误

**网域资源覆盖它的全部子域**，所以拿父级资源去查子域的单条 URL、提交编入索引，
**都会成功**——正因为它「看起来能用」，这个坑才难发现。它悄悄搞错的只有**聚合数字**：
点击、曝光、索引覆盖全是别的站的。把那些数字当基线记下去，会把后面几个月的增长判断全带偏。

**判据：读聚合数字之前，先确认资源 ID 恰好等于目标站点；单条 URL 的动作用父级资源也行。**
一个账号下常有多个名字相近的资源，**核对 ID，不要核对名字**。

### 四个实测的坑

1. **不要用 `opencli browser <s> extract` 读这两个后台。** 它会把页面里的 base64 内嵌图片
   一起吐出来——实测 Bing 后台一次 127 万字符，够冲掉一大半上下文，而你只想要表格里的六个数。
   用 `eval` 取 `innerText` 再切片。
2. **属性由 URL 参数决定，不要去点属性选择器。**
   GSC 是 `?resource_id=<urlencoded 属性>`，Bing 是 `?siteUrl=<urlencoded 源>`。
3. **`click --role button --name "提交"` 会因为「包含匹配」撞词而失败。**
   实测 GSC 站点地图页上同时有「提交」和「提交反馈」，多匹配直接报错。
   正确做法是**在页面里精确认出目标、打一个一次性属性，再让驱动按 CSS 选择器点**——
   精确匹配发生在页面里，点击仍然是驱动的真实 CDP 点击。
   （不能改成在页面里 `el.click()`：这两个后台的按钮多是挂 jsaction 的 `div`，
   合成事件不触发它们的处理器，**报成功、什么都没发生**。）
4. **Bing 的 sitemap 输入框默认不存在**，要先点「Submit sitemap」才挂载。
   少了这一步，脚本会去填页面上唯一可见的那个 input——顶部搜索框——然后点提交、报成功。
   这类「填错了框还报成功」的失败不会有任何报错，只会在几天后表现为「Bing 一直没抓新 sitemap」。

### 两边的表格形状不一样，不要按列解析

同一份数据，`innerText` 里的形状不同：**GSC 整行一条记录、字段用制表符分隔；
Bing 只有地址在行首，其余字段各占一行。** 按列下标解析的代码在任何一次改版后会**静默错位**，
而错位后的数字看起来完全正常。脚本因此只做两件事：认出哪几行是 sitemap 地址、把随后的字段贴回同一行。

### 「提交成功」是什么、不是什么

平台对同一地址的重复提交是**幂等**的，所以「它在列表里」这件事在提交前后长得一模一样，
**不构成提交生效的证据**。可用的证据有两种：

- 提交后状态列立刻从 `Success` 变成 `Processing`（实测 Bing 会）；
- 隔一天再跑一次 `status`，看「上次读取」的日期有没有前进。

另外，**表里的「已提交/上次读取/已发现网址数」是上一次抓取的快照，不是实时值**。
刚改完 sitemap 就来看会读到旧条数——这不是失败，不要因此反复重新提交。

## 验收：写进 `.rankup/integrations.md` 的东西

逐条记，每条都要有证据而不是断言：

- IndexNow 密钥**所在的路由**（不是所在的文件）、密钥值、最近一次推送的条数与 HTTP 状态。
- 两边站长工具的**资源 ID**（不是名字）、验证方式、验证通过日期。
- 两边 sitemap 的提交日期、上次读取日期、状态、已发现条数——**并注明这是快照日期**。
- 已知的、尚未对齐的差异（例如线上 sitemap 已经 N 条而平台仍显示 M 条），
  以及它预计怎么自行收敛。写下来，下次才不会有人把它当成故障重查一遍。

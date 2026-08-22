/**
 * gefei-chat.browser.js — 在**已登录用户的浏览器里**驱动哥飞 SEO Agent（seo.web.cafe/chat/）
 * 提问并取回全文。移植自来源项目 `.rankup/scripts/gefei-chat.browser.js`
 * （原文件已验证两次：2026-08-18 / 2026-08-19，2026-08-22 移植进 Skill）。
 *
 * ## 为什么不能做成纯 Node 脚本
 *
 * 本 Skill 的 `seo-webcafe.mjs` 里已经有 `chat` 命令，但它**强制要求登录**
 * （匿名 `401 {"code":"login"}`，不像别的工具那样先放行再扣访客配额），
 * 因此需要 `SEO_WEBCAFE_COOKIE`。而那个会话 Cookie 是 **HttpOnly**，
 * JS 读不到，要拿只能去翻浏览器的 Cookie 存储 —— 那等于把用户的会话凭据
 * 抠出来落盘，应当避免。
 *
 * 所以走另一条路：**请求在用户已登录的页面上下文里发出**，Cookie 由浏览器自动
 * 附带，脚本自始至终碰不到它。两条路径的取舍见本目录 `gefei-ask.mjs` 头部注释
 * 与 `../references/seo-webcafe.md` 的「问哥飞 AI：两条路径怎么选」一节。
 *
 * ## 用法
 *
 * 不要手工逐步粘贴调用——配套的 `gefei-ask.mjs` 已经把「注入 → 提问 → 轮询 →
 * 取回 → 截断检查 → 落盘」编排成一条命令。本文件只在两种情况下需要手动接触：
 * 调试选择器是否失效，或者移植到别的会话式 AI 页面时当参考。
 * 手工调用顺序（在 opencli `eval` / MCP javascript 工具里逐步执行）：
 *
 *   0) 浏览器打开 https://seo.web.cafe/chat/ 并确认已登录（页面会显示"今日已用 N/M"）
 *   1) 整段粘贴本文件执行一次 → 得到 window.__gf
 *   2) __gf.ask('你的问题')            // 填入并发送，返回 {已发送:字数}
 *   3) __gf.poll()                     // 反复调用直到 {done:true}，**单次别超 12s**
 *   4) __gf.grab()                     // 点复制按钮取原始 Markdown，直接返回全文
 *
 * `grab()` 不再 POST 给本地接收端——移植时特意去掉了这个耦合（原版靠一个项目内的
 * HTTP 接收进程落盘）。现在 `grab()` 把捕获到的文本**直接放进 eval 的返回值**，
 * 调用方（`gefei-ask.mjs`，一个 Node 进程）自己用 `fs.writeFileSync` 落盘。
 * 好处是这份 `.browser.js` 不再要求任何本机进程先跑起来，
 * 换项目、换机器都不用先起一个接收端——登录浏览器一开就能用。
 *
 * ## 踩过的坑（都在这个文件里修掉了，别再踩）
 *
 * - **别用 innerText 落库。** 回答含表格时 innerText 会把表格压成制表符，
 *   和页面自己准备的 Markdown 不是一份东西。一律走「复制本段」按钮。
 * - **别读剪贴板。** `navigator.clipboard.readText()` 要权限 + 页面焦点，
 *   自动化里两者都不稳。改成**劫持写入侧**：包一层 `writeText` 再兜一个
 *   `copy` 事件监听，页面照常复制，我们拿到同一份文本。
 * - **别靠按钮文案判完成。** 实测「停止」这个文案在流结束后仍会滞留一小会儿，
 *   曾据此判过一次「还在生成」而其实早就完事了。判据用**回答长度连续两次不变**
 *   加按钮回到「发送」，两者都满足才算完。
 * - **按钮不止两种状态。** 早先只把「停止」当忙，结果 2026-08-22 撞上第三种
 *   ——「云端生成中」——被当成空闲，`poll()` 报 done，`grab()` 抓回 107 个字的
 *   中间过程（「让我换几个更精准的角度继续挖」），而那不是回答。
 *   中间过程的长度也会长时间不变，所以长度判据救不了这个，只能靠按钮。
 *   判据因此反过来写：**只有恰好是「发送」才算空闲**，其余一律当忙。
 *   这样将来再冒出第四种状态，默认行为是继续等，而不是提前收工。
 * - **单次 await 别超 12 秒。** CDP 的 Runtime.evaluate 约 45s 超时，但流式输出
 *   期间渲染器很忙，可用预算远小于名义值。超时拿到的是「渲染器无响应」，
 *   这次调用有没有副作用你无从确认。未完成就再调一次，代价只是一次往返。
 * - **一条消息扣的不是 1 分。** `ask()` 之前把问题写完整，不要靠追问补。
 *   历史回答重新 `grab()` 不扣费，别为了拿全文重新提问。
 *   实测口径（2026-08-19）：一次带调研的长回答扣的是 **52 分**
 *   （它自己要跑 DR / SERP / 知识库检索），日额度 500（VIP 档，见 `check()`）。
 *   所以「省一次提问」是真的在省钱，别用重问来做本可以续问的事。
 * - **回答会被服务端拦腰截断，而按钮照样回到「发送」。** 2026-08-19 首答
 *   停在半句话上，`poll()` 仍然报 `done:true`——因为判据只看长度稳定加按钮空闲，
 *   这两条在流被掐断时同样满足。**落盘前必须看最后一句是不是完整的。**
 *   truncated 就发一条「你上一条在『……』处被截断，不用重新调研，从那里接着写完」——
 *   续问比重问便宜得多，而且它保留着上一轮已经查到的数据。截断检查放在
 *   `gefei-ask.mjs` 里做（跨调用状态），这个文件只负责把结尾片段带出去。
 *
 * ## 选择器（2026-08-18 实测，2026-08-22 复验仍成立）
 *
 *   输入框 textarea#q · 发送 button#send · 回答 .msg.ai · 复制按钮 文案含「复制本段」
 *   流式中 #send 文案为「停止」，空闲为「发送」，另有一种中间态「云端生成中」也算忙
 *   输入框是受控组件：直接 `el.value=` 不触发框架状态更新，发送时会被当成空，
 *   必须走原型链上的原生 setter 再派发 input 事件。
 *   这几个选择器是 seo.web.cafe/chat/ 这一个页面的固有耦合，站点改版就要重探，
 *   和「项目路径」那类可配置项无关，因此没有做成参数。
 *
 * 已验证：2026-08-18（VIP 登录态，3055 字回答一次取全）
 * 复验：2026-08-19（新会话注入正常；首答被截断，续问后 5538 字一次取全）
 * 移植进 Skill：2026-08-22（去掉接收端依赖，grab() 直接回传全文；选择器与判完成逻辑未改动）
 */
window.__gf = (() => {
  const $q = () => document.getElementById("q")
  const $send = () => document.getElementById("send")
  const $ai = () => [...document.querySelectorAll(".msg.ai")].pop()
  let lastLen = -1

  return {
    /** 填入并发送。返回填入的字数，便于确认没被受控组件吃掉。 */
    ask(text) {
      const q = $q()
      if (!q) return { 错误: "没找到 textarea#q —— 页面改版了，重新探选择器" }
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value",
      ).set
      setter.call(q, text)
      q.dispatchEvent(new Event("input", { bubbles: true }))
      if (q.value.length !== text.length) return { 错误: "填入后 value 对不上，受控组件没接住" }
      $send().click()
      lastLen = -1
      return { 已发送: text.length }
    },

    /**
     * 轮询一次。**外部反复调用直到 done:true**，不要在这里面写长循环。
     * 判完成用「长度连续两次不变 且 按钮空闲」，两条都满足才算——
     * 只看按钮会误判（按钮文案在流结束后会滞留），只看长度也会误判
     * （中间过程「让我换几个角度继续挖」这类文本的长度同样能长时间不变）。
     * 空闲的判据反过来写成「只有恰好是『发送』才算空闲」，其余一律当忙，
     * 这样新出现的第三、第四种按钮状态默认被当成"还在跑"而不是提前收工。
     */
    poll() {
      const ai = $ai()
      const len = ai ? ai.innerText.length : 0
      const label = $send().textContent.trim()
      const idle = label === "发送"
      const stable = len === lastLen && len > 0
      lastLen = len
      return { done: stable && idle, 长度: len, 按钮: label }
    },

    /**
     * 点「复制本段」取原始 Markdown，**直接把全文放进返回值**，不再 POST 给
     * 任何本地接收端——这是移植进 Skill 时去掉的唯一耦合，见文件头。
     * 落盘、去重、截断检查都交给调用方（`gefei-ask.mjs`）做。
     */
    async grab() {
      window.__cap = null
      const orig = navigator.clipboard && navigator.clipboard.writeText
      if (orig) {
        navigator.clipboard.writeText = function (t) {
          window.__cap = t
          return Promise.resolve()
        }
      }
      document.addEventListener(
        "copy",
        (e) => {
          try {
            window.__cap = e.clipboardData.getData("text/plain") || window.__cap
          } catch {
            /* 某些浏览器禁止读 clipboardData，writeText 那条已经兜住了 */
          }
        },
        { once: true },
      )
      const ai = $ai()
      // 必须精确匹配「复制本段」：回答里若有代码块，代码块自带的「复制」按钮
      // 在 DOM 里排在前面，/复制/ 会先命中它，拿回来的是代码片段不是全文。
      const btn = [...ai.querySelectorAll("button")].find((b) => /复制本段/.test(b.textContent))
      if (!btn) return { 错误: "没找到复制按钮", 候选: [...ai.querySelectorAll("button")].map((b) => b.textContent.trim()) }
      btn.click()
      await new Promise((r) => setTimeout(r, 300))
      if (!window.__cap) return { 错误: "劫持没拿到内容 —— 页面可能换了复制实现" }
      return {
        字数: window.__cap.length,
        文本: window.__cap,
        结尾: window.__cap.slice(-60), // 结尾不是完整句子 = 被服务端截断了，见文件头
      }
    },

    /** 连通性自检：页面是不是登录态、额度读没读到。不再检查本地接收端。 */
    check() {
      const quota = (document.body.innerText.match(/今日已用\s*\d+\/\d+/) || [])[0] || null
      return { 额度: quota, 已登录: !!quota, 输入框: !!$q(), 发送按钮: !!$send() }
    },
  }
})()

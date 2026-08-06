/**
 * chatbot-drive.browser.js — 在浏览器里驱动「网页版 AI Chatbot」并**完整取回**它的回答。
 *
 * 适用场景：某个能力只以聊天网页的形式存在（登录态、扣积分、没有 API 或 API 另收费），
 * 需要以脚本方式反复提问并把答案原文落进项目。典型是各类 SEO / 数据分析 Agent 网页。
 *
 * 为什么不用截图 OCR：回答动辄几千字、含表格与代码块，滚动截图既慢又会丢字符。
 * 本脚本走**回答区的「复制」按钮**——那是页面自己准备的原始 Markdown，一次点击就是全文。
 *
 * 为什么不用 navigator.clipboard.readText()：读剪贴板要权限 + 页面焦点，
 * 在自动化里两者都不稳。改为**在点击前劫持写入侧**：包一层 clipboard.writeText，
 * 同时监听 'copy' 事件兜住 execCommand 老写法。页面照常复制，我们拿到同一份文本。
 *
 * ── 用法（在 MCP javascript 工具里逐步调用，每步都是一个短表达式）────────────────
 *   1) 安装：把本文件内容整段粘进去执行一次 → 得到 window.__rk
 *      再执行 __rk.init(PROFILE)                      // PROFILE 见下方 SELECTOR 约定
 *   2) 提问：__rk.send('你的问题')                     // 返回 {ok, pending}
 *   3) 等待：__rk.wait()                                // 返回 {done, msgCount, len}
 *            —— 未 done 就再调一次。**单次别超过 15s**，见「已知约束」。
 *   4) 取全文：__rk.capture()                          // 点复制按钮 → 返回 {chars}
 *   5) 读出：__rk.read(0, 900) / __rk.read(900, 900)   // 分片读，避开工具输出截断
 *   6) 记账：__rk.session()                            // {id, title} —— **必做，见「会话找回」**
 *      找回：__rk.open('<id 或标题片段>')
 *
 * ── SELECTOR 约定（PROFILE）──────────────────────────────────────────────────
 *   {
 *     input:   'textarea#q',         // 输入框（textarea / input / [contenteditable]）
 *     send:    'button#send',        // 发送按钮
 *     log:     '#chatlog',           // 消息容器
 *     answer:  '.msg.ai',            // 单条 AI 回答（取最后一条）
 *     copy:    'button.anscopy',     // 回答内的「复制」按钮
 *     busyText:'停止',               // 流式输出时发送按钮的文案（用于判完成）
 *     idleText:'发送',               // 空闲时的文案；两者任一命中即可判定
 *     convItem:'#convlist .convitem',// 侧边栏会话条目；会话 id 通常在 data-id 上
 *     convIdAttr:'id',               // 读 dataset 的哪个键（默认 'id' → data-id）
 *     convSearch:'#convSearch',      // 侧边栏搜索框（找回会话的兜底路径）
 *   }
 *   不确定选择器时先跑 __rk.probe() —— 它列出候选输入框/按钮/消息容器供你填 PROFILE。
 *   PROFILE 属于**账号与站点侧配置**，连同登录态一起放 <project>/.rankup/scripts/，不进 Skill。
 *
 * ── 已知约束（踩过的坑，别再踩）────────────────────────────────────────────────
 *   • CDP Runtime.evaluate 约 45s 超时：任何 await 轮询循环必须**留足余量并可续跑**。
 *     实测 wait(28000) 撞超时，改成 20000 后**换一轮又撞了一次**，15000/10000 稳。
 *     流式输出期间渲染器很忙，可用预算远小于名义值且**随回答长度浮动**——所以默认压到
 *     12s、硬上限 15s，别按「45 减去等待时长还剩多少」去推。未 done 就再调一次，
 *     代价只是一次往返；超时拿到的是「渲染器无响应」，这次调用的副作用你无从确认。
 *   • **要注入就整段注入。** 手打一个「精简版」很容易漏掉 send/wait，等真要用时才报
 *     `__rk.send is not a function`——而那时你可能已经在等一个根本没发出去的问题。
 *   • 输入框多为受控组件：直接 el.value= 不触发框架状态更新，发送时会当成空。
 *     必须用原型链上的原生 setter 再派发 input 事件（本脚本已处理）。
 *   • 回答含表格/代码时 innerText 与复制内容不同（表格会被压成制表符）。
 *     判定长度可以用 innerText，**落库一律用 capture() 的复制原文**。
 *   • 每条消息通常扣积分。send() 前先确认问题写完整，不要靠追问补——追问是另一次扣费。
 *
 * ── 会话找回：URL 里没有会话 id，刷新即回首页 ────────────────────────────────
 *   这类聊天页常常**不把会话 id 写进 URL**，甚至主动擦掉查询参数
 *   （实测见过 `history.replaceState(null, '', location.pathname)`）。后果有三个：
 *     1. 地址栏 URL 存下来没用，它只会把你带回「新对话」空白页；
 *     2. 一刷新当前会话就从视图里消失，只能去**侧边栏列表**里点回来；
 *     3. 刷新会连 window.__rk 一起清掉 —— **重新加载后必须重新注入脚本再 init()**。
 *
 *   所以每开一个新会话，**send() 之后立刻 __rk.session() 记一笔 {id, title}**，
 *   连同这次问了什么一起写进项目记忆。id 通常挂在侧边栏条目的 data-id 上，是稳定主键；
 *   标题是页面从首个问题**截断**生成的，你改不了，而且很容易撞车
 *   （连着问同一个域名，侧边栏就会出现两条前缀一模一样的记录）——**认 id，不要认标题**。
 *
 *   找回：`__rk.open(id)` 直接点回那条；只记得大意时 `__rk.open('片段')` 走搜索框
 *   （这类搜索框通常标题和正文一起搜）。恢复后消息与每条回答的复制按钮都还在，
 *   可以直接 capture() 重新取全文——**历史回答重新复制不扣积分，别为了拿全文重新提问**。
 *
 * ── 落盘 ────────────────────────────────────────────────────────────────────
 *   capture() 拿到的原文按项目的导出物落盘 SOP 存进 <project> 的数据目录，
 *   文件名带上「问题主题 + 日期」，并在项目记忆里记一句这次问了什么、结论是什么。
 */
(() => {
  const S = {
    cfg: null,
    text: null, // capture() 的最新原文
  };

  const $ = (sel) => (sel ? document.querySelector(sel) : null);
  const $$ = (sel) => (sel ? [...document.querySelectorAll(sel)] : []);

  /** 把值写进受控输入框：原生 setter + input 事件，缺一不可。 */
  function setValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** 判断当前是否还在流式输出。busyText / idleText 任一可用。 */
  function isBusy() {
    const btn = $(S.cfg.send);
    if (!btn) return false;
    const t = (btn.innerText || "").trim();
    if (S.cfg.busyText && t.includes(S.cfg.busyText)) return true;
    if (S.cfg.idleText) return !t.includes(S.cfg.idleText);
    return btn.disabled === true;
  }

  const api = {
    /** 未知页面先跑这个，把候选元素挑出来填 PROFILE。 */
    probe() {
      return {
        inputs: $$("textarea,input[type=text],[contenteditable=true]").map((e) => ({
          sel: e.id ? `#${e.id}` : e.tagName.toLowerCase() + "." + e.className,
          placeholder: e.placeholder || "",
        })),
        buttons: $$("button")
          .map((b) => ({
            sel: b.id ? `#${b.id}` : "button." + b.className,
            text: (b.innerText || "").trim().slice(0, 12),
            title: b.title || "",
          }))
          .filter((b) => b.text || b.title)
          .slice(0, 40),
        containers: $$("[id]")
          .filter((e) => e.children.length > 1 && /log|chat|message|thread/i.test(e.id))
          .map((e) => ({ sel: "#" + e.id, kids: e.children.length })),
      };
    },

    /** 安装配置与剪贴板钩子。可重复调用（幂等）。 */
    init(cfg) {
      S.cfg = cfg;
      if (!window.__rkHooked) {
        const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async (t) => {
          S.text = t;
          try {
            return await orig(t);
          } catch {
            /* 无权限也没关系，文本已经拿到 */
          }
        };
        document.addEventListener(
          "copy",
          (e) => {
            const s = e.clipboardData && e.clipboardData.getData("text/plain");
            if (s) S.text = s;
          },
          true,
        );
        window.__rkHooked = true;
      }
      return { ok: true, hooked: true, answers: $$(S.cfg.answer).length };
    },

    /** 发一条消息。返回后立刻进入 wait() 轮询。 */
    send(text) {
      const el = $(S.cfg.input);
      if (!el) return { ok: false, error: "input not found: " + S.cfg.input };
      const before = $$(S.cfg.answer).length;
      setValue(el, text);
      const btn = $(S.cfg.send);
      if (!btn) return { ok: false, error: "send not found: " + S.cfg.send };
      btn.click();
      return { ok: true, answersBefore: before };
    },

    /**
     * 等待流式输出结束。**默认 12s，硬上限 15s**（CDP 名义 45s，实测 28s 和 20s 都撞过）。
     * 未 done 就再调一次，可无限续跑。
     */
    async wait(ms = 12000) {
      const t0 = Date.now();
      const budget = Math.min(ms, 15000);
      while (Date.now() - t0 < budget) {
        if (!isBusy()) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      const last = $$(S.cfg.answer).pop();
      return {
        done: !isBusy(),
        msgCount: $$(S.cfg.answer).length,
        len: last ? last.innerText.length : 0,
        tail: last ? last.innerText.slice(-120) : "",
      };
    },

    /** 点第 index 条回答（默认最后一条）的复制按钮，抓下原始 Markdown。 */
    async capture(index = -1) {
      const list = $$(S.cfg.answer);
      const el = index < 0 ? list[list.length + index] : list[index];
      if (!el) return { ok: false, error: "answer not found" };
      const btn = el.querySelector(S.cfg.copy);
      if (!btn) return { ok: false, error: "copy button not found: " + S.cfg.copy };
      S.text = null;
      btn.click();
      await new Promise((r) => setTimeout(r, 600));
      if (!S.text) return { ok: false, error: "clipboard hook captured nothing" };
      return { ok: true, chars: S.text.length, head: S.text.slice(0, 120) };
    },

    /** 分片读出 capture() 的原文——一次别超过 ~1000 字，工具输出会截断。 */
    read(from = 0, len = 900) {
      return S.text ? S.text.slice(from, from + len) : null;
    },

    /** 原文全文（仅在你有办法直接落盘时用，例如 POST 给本机接收端）。 */
    raw() {
      return S.text;
    },

    /**
     * 当前会话的 {id, title}。**send() 之后立刻调一次并记进项目记忆**——
     * URL 不带 id，刷新就找不回来了。id 是主键，title 会撞车。
     */
    session() {
      const key = S.cfg.convIdAttr || "id";
      const active = $(S.cfg.convItem + ".active") || $(S.cfg.convItem);
      if (!active) return { ok: false, error: "no conversation item found" };
      return {
        ok: true,
        id: active.dataset[key] || null,
        title: (active.innerText || "").trim().split("\n")[0],
        index: $$(S.cfg.convItem).indexOf(active),
        total: $$(S.cfg.convItem).length,
      };
    },

    /** 列出侧边栏所有会话 {id, title}，用于对账「我记的那条还在不在」。 */
    sessions() {
      const key = S.cfg.convIdAttr || "id";
      return $$(S.cfg.convItem).map((el, i) => ({
        i,
        id: el.dataset[key] || null,
        title: (el.innerText || "").trim().split("\n")[0].slice(0, 40),
        active: el.classList.contains("active"),
      }));
    },

    /**
     * 找回会话：传 id 直接点回；传标题片段则先走侧边栏搜索框再点第一条。
     * 恢复后 capture() 照常可用（重新复制历史回答不扣积分）。
     */
    async open(idOrText) {
      const key = S.cfg.convIdAttr || "id";
      let el = $$(S.cfg.convItem).find((e) => e.dataset[key] === idOrText);
      let searched = false;
      if (!el && S.cfg.convSearch) {
        const box = $(S.cfg.convSearch);
        if (box) {
          searched = true;
          setValue(box, idOrText);
          await new Promise((r) => setTimeout(r, 1200));
          el = $$(S.cfg.convItem).find((e) => getComputedStyle(e).display !== "none");
        }
      }
      if (!el) {
        if (searched) await this.clearSearch();
        return { ok: false, error: "conversation not found: " + idOrText };
      }
      el.click();
      await new Promise((r) => setTimeout(r, 2000));
      // 搜索框不清空，列表就一直是过滤后的样子 —— 实测非匹配条目会被移出 DOM，
      // 于是之后的 session()/sessions() 会把 total 报成 1，看起来像"会话都没了"。
      if (searched) await this.clearSearch();
      return {
        ok: true,
        ...this.session(),
        msgCount: $$(S.cfg.answer).length,
      };
    },

    /** 清空侧边栏搜索框，把列表还原成全量。 */
    async clearSearch() {
      const box = $(S.cfg.convSearch);
      if (!box) return { ok: false };
      setValue(box, "");
      await new Promise((r) => setTimeout(r, 800));
      return { ok: true, total: $$(S.cfg.convItem).length };
    },
  };

  window.__rk = api;
  return "__rk ready: probe / init / send / wait / capture / read";
})();

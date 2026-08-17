/**
 * harvest.browser.js — 登录态后台表格提取器（贴进浏览器代码执行工具运行）
 *
 * 必须在**用户的真实浏览器**里跑（有登录态那个）。隔离的预览浏览器只会看到登录页。
 *
 * ── 快速上手 ───────────────────────────────────────────────────────────
 *   HARVEST.init()                    // 定位滚动容器；每次切页/切报表后重调
 *   HARVEST.start()                   // 抓当前页（**不要 await**）
 *   HARVEST.status()                  // 隔几秒轮询
 *   HARVEST.save('scope', 'type')     // 导出到下载目录
 *
 *   // 批量：
 *   HARVEST.crawl([{ name:'a', seed:'scope', type:'a', hash:'#/path?x=1' }])
 *   HARVEST.log                       // 轮询进度
 *
 * ── 为什么不用更简单的写法（都试过，都不行）────────────────────────────
 *  1. 没有 <table>/<tr>/role="row"：现代数据网格是虚拟滚动 + 列式 div。
 *     只能按 getBoundingClientRect 的 Y 坐标聚类重建行。
 *  2. 行锚点不能用行号列：实测 100 行会漏 23 行（行号与其它单元格偶尔落进不同 Y 分桶）。
 *     用内容主列做锚点再收同一 Y ±11px 的单元格，才 100%。
 *  3. 扫描必须限定在滚动容器内：整个 document 扫 div,span,a 单次约 2s，
 *     滚动循环几十次直接爆执行超时；TreeWalker + 限定容器实测 6ms（快 300 倍）。
 *  4. 列位不能写死：同一后台不同报表列序不同，写死 x 区间换张表就错位 → 默认用 grabAny。
 *  5. 长循环不能 await：执行工具单次常有 45s 超时，**但超时的是传输通道，页面里还在跑**。
 *     超时后回查全局变量往往发现早就干完了。误判成失败去重跑 = 产生重复文件。
 *  6. 数据出不了沙箱：返回值约 1KB 截断；clipboard 报 NotAllowedError: Document is not
 *     focused 并卡死执行通道。**Blob + <a download> 是唯一稳的高带宽出口。**
 *  7. 后台标签不 mount 虚拟表格：`location.hash` 导航后若标签隐藏，init() 拿不到滚动容器
 *     （实测连续多个目标全失败）。每次导航后必须让该标签**前台化一次**（截图即可）。
 *     且后台定时器节流约 2.4×（setTimeout 1000ms 实测 2403ms）——多开约 1.5–2× 收益，不是 N×。
 */
(function () {
  const HARVEST = {
    rows: {},
    any: {},
    log: [],
    sc: null,
    done: false,

    /** 定位滚动容器（页面上最高的可滚动 div）。切页/切报表后必须重调。 */
    init() {
      this.rows = {};
      this.any = {};
      this.sc = [...document.querySelectorAll('div')]
        .filter((d) => d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 300)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      return !!this.sc;
    },

    /** 取当前视口内所有叶子单元格的坐标与文本 */
    _leaves(topY, minX) {
      const out = [];
      const walker = document.createTreeWalker(this.sc || document, NodeFilter.SHOW_ELEMENT);
      let el;
      while ((el = walker.nextNode())) {
        if (el.children.length) continue;
        const text = el.textContent && el.textContent.trim();
        if (!text || text.length > 70) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.top <= topY || r.left < minX) continue;
        out.push({ x: r.left, y: r.top + r.height / 2, t: text });
      }
      return out;
    },

    /**
     * 列位自适应重建行：纯按 Y 聚类，不假设任何列的 x。**换报表首选这个。**
     * @param minCells 一行至少几个单元格才算数据行（用来滤掉标题/图例）
     */
    grabAny({ minCells = 5, topY = 300, minX = 0 } = {}) {
      const leaves = this._leaves(topY, minX);
      const buckets = {};
      leaves.forEach((l) => {
        const k = Math.round(l.y / 6) * 6;
        (buckets[k] = buckets[k] || []).push(l);
      });
      Object.values(buckets).forEach((cells) => {
        if (cells.length < minCells) return;
        const row = cells.sort((a, b) => a.x - b.x).map((c) => c.t).join('\t');
        this.any[row.split('\t')[0] + '|' + row.length] = row;
      });
      return Object.keys(this.any).length;
    },

    /**
     * 已知列位时的精确版：以「内容主列」为锚点，配一个行号列做行 key。
     * 只在 grabAny 分不清行边界时才用，且 x 区间要按实际报表量。
     */
    grabAnchored({ anchorMinX = 450, anchorMaxX = 700, idMaxX = 450, topY = 390 } = {}) {
      const leaves = this._leaves(topY, idMaxX > 0 ? 0 : 0);
      leaves
        .filter((l) => l.x > anchorMinX && l.x < anchorMaxX && !/^\d+$/.test(l.t))
        .forEach((anchor) => {
          const same = leaves.filter((l) => Math.abs(l.y - anchor.y) < 11).sort((a, b) => a.x - b.x);
          const id = same.find((l) => l.x < idMaxX && /^\d+$/.test(l.t));
          if (id) this.rows[+id.t] = same.filter((l) => l.x >= idMaxX).map((l) => l.t).join('\t');
        });
      return Object.keys(this.rows).length;
    },

    /** 滚一遍当前页并抓取。**不要 await**，用 status() 轮询。 */
    start(opts = {}) {
      this.done = false;
      (async () => {
        for (let y = 0; y <= this.sc.scrollHeight; y += opts.step || 200) {
          this.sc.scrollTop = y;
          await new Promise((r) => setTimeout(r, opts.wait || 140));
          this.grabAny(opts);
        }
        this.sc.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 400));
        this.grabAny(opts);
        this.done = true;
      })();
      return 'started';
    },

    status() {
      return { done: this.done, rows: Object.keys(this.any).length, log: this.log };
    },

    /**
     * 导出到下载目录。文件名 `harvest_<YYYYMMDD>_<scope>_<type>.tsv`
     *
     * **日期与作用域是必需的**：浏览器对同名下载不覆盖，而是另存成 `xxx (1).tsv`
     * 或**直接去掉扩展名**。实测同一目标重复触发产生了两份内容不同的文件
     * （带扩展名 / 不带扩展名），之后按 *.tsv 通配合并要么漏读要么重复计入，全程不报错。
     */
    save(scope, type) {
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const slug = (s) => String(s).replace(/[^a-z0-9.-]+/gi, '-').replace(/^-|-$/g, '');
      const name = `harvest_${stamp}_${slug(scope)}_${slug(type)}.tsv`;
      const payload = Object.values(this.any).length
        ? Object.values(this.any).join('\n')
        : Object.values(this.rows).join('\n');
      const blob = new Blob([payload], { type: 'text/tab-separated-values' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
      return { name, bytes: payload.length };
    },

    /**
     * 批量跑多个目标（**不要 await**，用 HARVEST.log 轮询）。
     * targets: [{ name, seed, type, hash, wait }]
     *
     * ⚠ 每个目标之间靠 `location.hash` 切换（SPA 不整页刷新，JS 上下文得以存活）。
     *   但标签在后台时 SPA 不 mount 表格 → init() 失败。多标签并行时，
     *   每次导航后先把该标签前台化一次再抓。
     */
    crawl(targets) {
      this.done = false;
      this.log = [];
      (async () => {
        for (const t of targets) {
          location.hash = t.hash;
          await new Promise((r) => setTimeout(r, t.wait || 8000));
          if (!this.init()) {
            this.log.push(`${t.name} :: NO_SCROLLER（标签在后台？先前台化一次）`);
            continue;
          }
          for (let y = 0; y <= this.sc.scrollHeight; y += 200) {
            this.sc.scrollTop = y;
            await new Promise((r) => setTimeout(r, 130));
            this.grabAny();
          }
          this.sc.scrollTop = 0;
          await new Promise((r) => setTimeout(r, 400));
          this.grabAny();
          const res = this.save(t.seed || 'scope', t.type || t.name);
          this.log.push(`${t.name} :: rows=${Object.keys(this.any).length} → ${res.name}`);
          await new Promise((r) => setTimeout(r, 1200));
        }
        this.done = true;
      })();
      return `crawling ${targets.length}`;
    },

    /**
     * 取 URL 列：**从 href/title 属性读，不要从文本读。**
     *
     * 长 URL 在单元格里会换行成两行并加省略号，于是：
     *  - 文本是截断的（`…/blogs/tarot-car d-meanings-list/the-hieropha…` 这种）；
     *  - 换行让该单元格跨两个 Y 分桶，坐标法会把这一行拆散，
     *    再被 minCells 过滤掉 —— **整类行会静默消失**。
     *    实测：某报表 100 行里 78 行是长 URL，坐标法只回收到 18 行，且毫无报错。
     * 属性里存的是完整 URL，一次就能全拿到。
     *
     * @param urlPattern 用来认目标 URL 的正则
     * @param maxDx 数值列与链接右边缘的最大水平距离外的都不算（同 Y 才配对）
     */
    grabLinks(urlPattern, { yTol = 22 } = {}) {
      const num = (s) => {
        const m = (s || '').trim().match(/^([\d.]+)([KM]?)$/);
        return m ? parseFloat(m[1]) * (m[2] === 'M' ? 1e6 : m[2] === 'K' ? 1e3 : 1) : 0;
      };
      const leaves = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let el;
      while ((el = walker.nextNode())) {
        if (el.children.length) continue;
        const t = el.textContent && el.textContent.trim();
        if (!t) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0) continue;
        leaves.push({ y: r.top + r.height / 2, x: r.left, t });
      }
      const links = [...document.querySelectorAll('a[href],[title]')].filter((e) =>
        urlPattern.test(e.getAttribute('title') || e.getAttribute('href') || '')
      );
      const out = {};
      links.forEach((e) => {
        const r = e.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const url = e.getAttribute('title') || e.getAttribute('href');
        const v = leaves.filter((l) => Math.abs(l.y - y) < yTol && l.x > r.right).map((l) => num(l.t)).filter((n) => n > 0)[0] || 0;
        if (v > 0 && (!out[url] || out[url] < v)) out[url] = v;
      });
      return out;
    },

    /** 分片取数，绕开执行工具返回值的长度截断 */
    dump(i = 0, j = 20) {
      return Object.values(this.any).slice(i, j).join('\n');
    },
  };

  window.HARVEST = HARVEST;
  return HARVEST.init();
})();

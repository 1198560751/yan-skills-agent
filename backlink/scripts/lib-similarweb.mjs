/**
 * lib-similarweb.mjs — Similarweb 页面解析，**唯一一份**。
 *
 * 为什么抽出来：`similarweb-query.mjs` 和 `similarweb-batch.mjs` 各自抄了一份
 * `deriveMetrics`，于是同一个解析 bug 要修两遍，而实际发生的是**只修了一遍**。
 * 本 Skill 对「写第二个」有明文禁令，这里是补上欠账。
 *
 * ---
 *
 * ## 取值的两条硬规则（都是被错报逼出来的）
 *
 * 页面结构是「标签一行、值在后面几行」，中间夹着日期范围、国家名、图例。
 * 所以必须往后扫——但**扫描必须有边界，模式必须整行匹配**：
 *
 *   1. **碰到下一个标签就停。** 否则某个指标没有值时，扫描会一路穿过去，
 *      把下一个指标的数字抓来当自己的。
 *   2. **`-` / `—` / `N/A` 是「这一项没有值」，不是「继续往后找」。** 命中就返回 null。
 *
 * 2026-08-24 实测事故：na.whatismymmr.com 的三个排名在页面上全是 `-`，
 * 而旧代码的模式 `#?\s*[\d,]+` 不限整行、不设边界，一路扫到
 * 「Last 28 days (As of Aug 21)」，把 **28** 抓成了国家排名和行业排名。
 * 一个月访问 2 万的站被写成「国家排名第 28」，而且不报错。
 * **错报比漏报危险得多，所以宁可返回 null。**
 */

/** 页面上出现的指标标签。`nextValue` 用它当扫描边界。 */
export const SW_LABELS = [
  '总访问量', '全球排名', '国家/地区排名', '行业排名', '跳出率',
  '页面数/访问', '每次访问页数', '访问持续时间', '平均访问时长',
  '参与度概览', '站点排名', '渠道流量', '流量来源',
];

/** 「1.5M」「20,300」「1.6万」都要还原成数字。中文面板会用「万」「亿」。 */
export function parseNumber(value) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  const match = normalized.match(/^([\d.]+)\s*([KMB万亿])?$/i);
  if (!match) return null;
  const multipliers = { k: 1e3, m: 1e6, b: 1e9, 万: 1e4, 亿: 1e8 };
  return Number(match[1]) * (multipliers[(match[2] || '').toLowerCase()] || 1);
}

/** 排名必须**整行**就是一个（可带 # 的）数字。半行匹配正是上面那起错报的成因。 */
export function parseRank(value) {
  const match = String(value ?? '').replace(/,/g, '').trim().match(/^#?\s*(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** 明写的「没有这一项」。命中即停，不许继续往后找数字。 */
const NO_VALUE = /^(?:[-—–]|N\/A|n\/a|--)$/;

/**
 * 从标签往后找第一个匹配的值。**碰到下一个标签、或碰到 `-`，立刻停。**
 * labels 可以给多个候选：同一个指标在面板上不止一种写法（实测「访问持续时间」
 * 与「平均访问时长」并存，「页面数/访问」与「每次访问页数」并存），
 * 只认一种会让指标静默变成 null——报表看起来查成功了，字段却缺一半。
 */
export function nextValue(lines, labels, pattern = /./, span = 8) {
  for (const label of [].concat(labels)) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== label) continue;
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + span); j++) {
        if (SW_LABELS.includes(lines[j])) break;        // 越界即停
        if (NO_VALUE.test(lines[j])) break;             // 页面明说没有
        if (pattern.test(lines[j])) return lines[j];
      }
    }
  }
  return null;
}

const NUMLINE = /^[\d,.]+\s*[KMB万亿]?$/i;
const RANKLINE = /^#?\s*[\d,]+$/;

/** 「网站表现」页的指标。**只有这一页有**——在渠道页上跑它会把筛选器里的字当数值抓。 */
export function deriveMetrics(lines) {
  const metrics = {
    totalVisits: parseNumber(nextValue(lines, '总访问量', NUMLINE)),
    globalRank: parseRank(nextValue(lines, '全球排名', RANKLINE)),
    countryRank: parseRank(nextValue(lines, '国家/地区排名', RANKLINE)),
    industryRank: parseRank(nextValue(lines, '行业排名', RANKLINE)),
    bounceRatePercent: (() => {
      const hit = nextValue(lines, '跳出率', /^[\d.]+\s*%$/);
      const m = hit && hit.match(/([\d.]+)\s*%/);
      return m ? Number(m[1]) : null;
    })(),
    pagesPerVisit: parseNumber(nextValue(lines, ['页面数/访问', '每次访问页数'], /^[\d.]+$/)),
    visitDuration: nextValue(lines, ['访问持续时间', '平均访问时长'], /^\d{2}:\d{2}:\d{2}$/),
  };
  return metrics;
}

/**
 * 「流量来源渠道」页：下方那张「渠道 → 绝对访问数」的表是最稳的结构，取它。
 * **占比直接由绝对值算，不去页面上捞那串百分比**——页面顶部并排列了一串 % 和一串
 * 渠道名，中间夹着图例和空行，顺序配对极易错位，而错位的占比比没有占比更危险。
 */
export const CHANNEL_KEYS = [
  'Direct', 'Search - Organic', 'Search - Paid', 'Referrals', 'Display Ads',
  'Social - Organic', 'Social - Paid', 'Gen AI', 'Email', 'Affiliates',
];

/** 输出时把 null 字段去掉；**判断「有没有解析到东西」不能用它**——见 similarweb-query 的注释。 */
export const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

export function deriveChannels(lines) {
  const visits = {};
  for (const key of CHANNEL_KEYS) {
    const i = lines.indexOf(key);
    if (i >= 0) {
      const v = lines[i + 1];
      visits[key] = NO_VALUE.test(String(v || '').trim()) ? null : parseNumber(v);
    }
  }
  const total = Object.values(visits).reduce((a, v) => a + (v || 0), 0);
  const sharePercent = {};
  if (total > 0) {
    for (const [k, v] of Object.entries(visits)) {
      if (v !== null && v !== undefined) sharePercent[k] = Number(((v / total) * 100).toFixed(2));
    }
  }
  return { totalFromChannels: total || null, sharePercent, visits };
}

/**
 * 关键词生成器的表格提取器（在页面里跑）。
 *
 * **这张表在 DOM 里是按列渲染的**：`.swReactTable-column` 一个容器装一整列，
 * 表头列和数据列还是分开的两组。innerText 出来是「100 个行号一块、100 个关键词一块」，
 * 按行切分必然错位——某一列有空值时 innerText 不会留空行，于是整列往上挪一格，
 * 得到一组读起来完全正常的错数据。
 *
 * 按 DOM 列取值则由结构本身保证对齐：第 i 个数据列的第 j 个格子，就是第 j 行的该列值。
 * 表头列（子元素 <= 2 个）与数据列（子元素上百个）按出现顺序一一对应。
 * 末尾有一个空的占位格，靠关键词为空过滤掉。
 */
export const SW_KEYWORD_TABLE_CELLS = `(() => {
  const all = [...document.querySelectorAll('.swReactTable-column')];
  const headerCols = all.filter((c) => c.children.length <= 2);
  const dataCols = all.filter((c) => c.children.length > 2);
  if (!dataCols.length || headerCols.length !== dataCols.length) return null;
  const headers = headerCols.map((c) => (c.children[0]?.innerText || '').trim().split('\\n')[0].trim());
  const columns = dataCols.map((c) => [...c.children].map((x) => (x.innerText || '').trim()));
  const depth = Math.min(...columns.map((c) => c.length));
  const rows = [];
  for (let i = 0; i < depth; i++) rows.push(columns.map((c) => c[i]));
  return { headers, rows };
})()`;

/** 「44%」「$1.21」这类带符号的值。空串与占位符一律 null，绝不落成 0。 */
function swCell(value, { percent = false, currency = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:-|—|N\/A|n\/a|不可用)$/i.test(text)) return null;
  if (percent) return parseNumber(text.replace(/%$/, ''));
  if (currency) return parseNumber(text.replace(/^[$¥€£]/, ''));
  return parseNumber(text);
}

/**
 * 把提取到的列表变成行对象。**按列名取值，不按下标**——列顺序变了会得到 null 并
 * 记进 missingColumns，而不是把体量的数字安到 KD 头上。
 */
export function deriveKeywordRows(cells) {
  if (!cells?.headers?.length || !Array.isArray(cells.rows)) {
    return { rows: [], missingColumns: ['<no DOM columns>'] };
  }
  const wanted = {
    keyword: '关键词', volume28d: '28 天的体量', avgVolume: '平均体量',
    zeroClickPercent: '零点击搜索', kd: 'KD', intent: '意图', cpc: 'CPC',
  };
  const index = Object.fromEntries(Object.entries(wanted).map(([key, label]) => [key, cells.headers.indexOf(label)]));
  const missingColumns = Object.entries(index).filter(([, i]) => i < 0).map(([key]) => wanted[key]);
  const cell = (row, key) => (index[key] >= 0 ? row[index[key]] : null);

  const rows = cells.rows.map((row) => ({
    keyword: String(cell(row, 'keyword') ?? '').trim(),
    volume28d: swCell(cell(row, 'volume28d')),
    avgVolume: swCell(cell(row, 'avgVolume')),
    zeroClickPercent: swCell(cell(row, 'zeroClickPercent'), { percent: true }),
    kd: swCell(cell(row, 'kd')),
    // 一个词可以同时带多个意图，页面用换行分隔。
    intent: String(cell(row, 'intent') ?? '').split(/\s+/).filter(Boolean),
    cpc: swCell(cell(row, 'cpc'), { currency: true }),
  })).filter((row) => row.keyword);

  return { rows, missingColumns };
}

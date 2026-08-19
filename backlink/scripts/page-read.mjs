#!/usr/bin/env node
/**
 * page-read.mjs — 渲染任意公开页面，取回正文、价格、导航链接。
 *
 * 用途是**竞品产品勘测**：对手卖什么、怎么收费、付费墙长什么样、产品目录有多少个。
 * 这类判断的证据只在对手自己的页面上，任何 SEO 工具都查不到。
 *
 * 和已有脚本的分工，别用错：
 *   - inspect-page.mjs  → 扫**表单**，为提交目录/发评论服务，输出的是字段和选择器；
 *   - 本脚本            → 读**内容**，输出的是正文、价格、链接，不碰任何输入框。
 *
 * 为什么不用 curl：这类站基本都是 SPA，`curl | grep` 拿到的是一个空壳。必须让浏览器渲染。
 *
 * 只读公开页面，不登录、不填表、不点任何会产生副作用的按钮。
 *
 * 用法：
 *   node page-read.mjs --url https://example.com/pricing [--wait 6] [--links /plan] [--out x.json]
 */
import { writeFile } from 'node:fs/promises';
import { defaultSession, firstJson, opencli, parseFlags, printJson, required, validateSession } from './opencli-core.mjs';

const flags = parseFlags(process.argv.slice(2));
const url = new URL(required(flags, 'url'));
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are supported.');
const session = flags.session ? validateSession(flags.session) : defaultSession('page-recon');
const waitSeconds = Math.max(1, Math.min(30, Number(flags.wait || 6)));
const env = { OPENCLI_WINDOW: flags.window === 'foreground' ? 'foreground' : 'background' };
const linkFilter = typeof flags.links === 'string' ? new RegExp(flags.links, 'i') : null;
const maxChars = Math.max(500, Math.min(60_000, Number(flags.chars || 8000)));

// 各市场的货币写法。日元和韩元最常见的坑是数字和符号中间有全角空格，
// 以及日文页面把价格写成「￥3,990」而不是「¥3990」。
const PRICE_PATTERNS = [
  ['JPY', String.raw`[¥￥]\s*[0-9][0-9,]*|[0-9][0-9,]*\s*円`],
  ['KRW', String.raw`[0-9][0-9,]*\s*원|₩\s*[0-9][0-9,]*`],
  ['USD', String.raw`\$\s*[0-9][0-9,]*(?:\.[0-9]{2})?`],
  ['EUR', String.raw`€\s*[0-9][0-9,]*(?:[.,][0-9]{2})?`],
  ['CNY', String.raw`[0-9][0-9,]*\s*元(?!素|气|旦)`],
];

await opencli(['browser', session, 'open', url.href], { env, timeoutMs: 90_000 });
await new Promise((r) => setTimeout(r, waitSeconds * 1000));

const captured = firstJson(
  (await opencli(['browser', session, 'eval', `(() => {
    const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n');
    return JSON.stringify({
      url: location.href,
      title: document.title,
      description: document.querySelector('meta[name=description]')?.content || null,
      textLength: text.length,
      text: text.slice(0, ${maxChars}),
      links: [...document.querySelectorAll('a[href]')].map((a) => ({
        href: a.getAttribute('href'),
        text: (a.innerText || '').trim().slice(0, 60),
      })).filter((l) => l.href && !l.href.startsWith('javascript:')).slice(0, 200),
    });
  })()`], { env, timeoutMs: 60_000 })).stdout,
);

const prices = {};
for (const [currency, pattern] of PRICE_PATTERNS) {
  const hits = [...new Set(captured.text.match(new RegExp(pattern, 'g')) || [])];
  if (hits.length) prices[currency] = hits.slice(0, 30);
}

// 付费墙形态：一次性买断 / 订阅 / 两者并存。这决定了对手的收入模型，
// 也决定了我们要不要跟。三种语言的说法都收进来。
const shape = {
  oneTime: /都度購入|買い切り|一次性|단건|단품|one[- ]time|single purchase/i.test(captured.text),
  subscription: /サブスクリプション|定期購読|月額|年額|구독|정기결제|subscription|per month|\/mo\b/i.test(captured.text),
  freeTrial: /無料体験|無料お試し|무료 ?체험|free trial/i.test(captured.text),
  refund: /返金|환불|refund|money[- ]back/i.test(captured.text),
};

const output = {
  version: 1,
  source: 'Rendered public page via OpenCLI browser session',
  retrievedAt: new Date().toISOString(),
  requestedUrl: url.href,
  session,
  finalUrl: captured.url,
  title: captured.title,
  description: captured.description,
  textLength: captured.textLength,
  truncated: captured.textLength > maxChars,
  prices,
  paywallShape: shape,
  links: linkFilter ? captured.links.filter((l) => linkFilter.test(l.href) || linkFilter.test(l.text)) : captured.links,
  text: captured.text,
};

if (typeof flags.out === 'string') await writeFile(flags.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
printJson({ ...output, text: `${output.text.slice(0, 600)}${output.truncated ? ' …[截断，全文见 --out 文件]' : ''}` });

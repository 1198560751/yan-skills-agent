/**
 * lib-probe-classifier.mjs — probe-submission-targets 的分类层，独立成 lib
 * （2026-08-30 拆分：fetch 层只采集并落盘原始 HTML，分类层在这里，可单测）。
 *
 * **这里的一切输出都是启发式建议（suggested），不是判决。** usable/gated/
 * unverified、gate 列表、kind 都来自对原始 HTML 的正则匹配；AI 拿着
 * `<out>.evidence/<domain>.html` 里的原始现场可以推翻任何一条。历史事故：
 * regex 判 usable 的页面第二步冒出 security-code；英文-only 的 kind 正则漏掉
 * 整类中文 AI 导航站。建议可被推翻，正是把这层单独拎出来的原因。
 *
 * 负向声明保持弱势：plain HTTP 证明不了「没有」（客户端渲染、对脚本 403），
 * 所以「没找到表单」只落 `none-found`/`unverified`，绝不落 `dead`。
 */
import { cohortOf, primaryGate } from './lib-cohort.mjs';

// The old test was English-only and required a literal "ai tools"/"ai
// directory" phrase. Chinese-language AI-nav sites — a whole class of them,
// not a handful of stragglers — carry no such English string anywhere on the
// page (e.g. "AI工具集官网", "AI工具导航站", "提交AI产品 | AI导航网站") and
// classified as 'unknown', which is how ai-bot.cn, ai138.com, ai-nav.net and
// aiheron.com survived a downstream filter that excludes by
// kind === 'ai-directory'. Fix the class: match "ai" immediately fused to a
// Chinese AI-directory noun (工具/导航/产品/软件/应用/网站/平台), plus
// "人工智能" on its own, alongside the broadened English set. \b already
// keeps this off false positives like chain/email/domain/maintainer/retail/
// air/paid/said/available — none of them has a word boundary immediately
// before "ai", and none is followed by a Chinese character. The Chinese
// branch also needs its OWN leading \b: without it, "ai" embedded inside a
// longer Latin word right before a Chinese noun still matched — e.g.
// "Shanghai网站导航" (a city), "Chennai应用市场" (a city), "Kai软件下载站"
// (a brand), "外卖waimai导航网" (pinyin brand + 导航) all false-positived as
// ai-directory. \b is defined on \w (ASCII alnum + underscore) and Chinese
// characters are not \w, so the boundary on the *trailing* side (between
// "ai" and the following Chinese character) already existed for free; the
// bug was the missing boundary on the *leading* side.
export const AI_DIRECTORY_RE = /\bai[\s-]?(?:tools?|directory|software|apps?|websites?|platforms?)\b|\bartificial intelligence\b|\bai-powered\b|\bai(?:工具|导航|产品|软件|应用|网站|平台)|人工智能/;

const stripScripts = (html) => String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

/** 站点类型的启发式建议。'unknown' 是「正则没认出来」，不是「不是任何类型」。 */
export function classifyKind(title, html) {
  const t = `${title || ''} ${stripScripts(html).slice(0, 4000)}`.toLowerCase();
  if (AI_DIRECTORY_RE.test(t)) return 'ai-directory';
  if (/startup|indie hacker|product launch|launch your/.test(t)) return 'startup-launch';
  if (/saas|software (?:reviews?|alternatives)/.test(t)) return 'saas-review';
  if (/business directory|local business|company directory/.test(t)) return 'business-directory';
  if (/web directory|link directory|site directory/.test(t)) return 'web-directory';
  if (/search engine|submit your url to/.test(t)) return 'search-engine';
  if (/forum|community|developers?/.test(t)) return 'dev-community';
  if (/directory|submit your (?:tool|product|site)/.test(t)) return 'product-directory';
  return 'unknown';
}

// Collect EVERY gate, not just the first. A site can want an account and a
// CAPTCHA and an email confirmation; recording only one of the three hides two
// thirds of what the submission actually costs, and cost is what decides which
// batch it can go in.
export function gatesFrom(a) {
  const g = [];
  if (a.captchaModern || a.captchaLegacy) g.push('captcha-interactive');
  if (a.hasPassword || a.loginWall) g.push('account');
  if (a.reciprocal) g.push('reciprocal');
  if (a.personalContact) g.push('personal-contact');
  if (a.emailVerify) g.push('email-verify');
  if (a.forms && !g.length) g.push('open-form');
  if (!a.forms && !g.length) g.push('none-found');
  return g;
}

/**
 * 状态建议。返回值带 `suggested: true`：status/gate/cohort 是对原始 HTML 的
 * 正则解读，AI 对着落盘的 HTML 现场可推翻。`why` 记录建议的依据。
 */
export function decide(probe, a) {
  const bail = (gates, why) => ({ suggested: true, status: 'unverified', gates, gate: primaryGate(gates), cohort: cohortOf(gates), why });
  if (probe.status === null) return bail(['unknown'], `unreachable over plain HTTP (${probe.error}); needs a browser before any claim`);
  if (probe.status >= 500) return bail(['unknown'], `server error ${probe.status}`);
  if (probe.status === 404 || probe.status === 410) return bail(['none-found'], `route answered ${probe.status}`);

  const gates = gatesFrom(a);
  const gate = primaryGate(gates);
  const cohort = cohortOf(gates);

  if (gates.includes('none-found')) {
    return bail(['none-found'], a.submitLinks.length
      ? 'no form on this page, but a submission-looking link exists; follow it in a browser'
      : 'no form and no submission link found over plain HTTP; absence is not provable this way');
  }
  if (cohort === 'open') {
    return { suggested: true, status: 'usable', gates, gate, cohort, why: `reachable ${probe.status}, ${a.forms} form(s), no CAPTCHA/login/reciprocal signal in raw HTML` };
  }
  return { suggested: true, status: 'gated', gates, gate, cohort, why: `reachable ${probe.status}, gates observed: ${gates.join(' + ')}` };
}

/**
 * lib-batch-evidence.mjs — 批量流量筛查的**证据契约**，similarweb-batch 与
 * semrush-batch 共用的唯一一份。
 *
 * 原则（对齐 ground-truth.mjs）：**脚本只采集，不判断。** 每域一行 JSONL，
 * 落的是实测原始值 + 解析状态 + 原文摘录 + 截图路径 + stopReason；
 * `pass/fail/below-floor` 这类判决一律不产——判断由 AI 拿着证据做，
 * 「空值 ≠ 低流量」，空值只说明这次没拿到数字，成因写在 stopReason 里。
 *
 * 行契约（两个脚本共同遵守的字段）：
 *   domain        测的是谁
 *   parse         'parsed'（至少一个指标解析出来了）
 *                 | 'no-data-marker'（数据源自己写了「未找到匹配内容」这类空态句）
 *                 | 'none'（一个指标都没解析出来）
 *   stopReason    'stable'（数值连读一致，采集完成）
 *                 | 'empty-state'（空态句连读稳定，采集完成——**不是**低流量结论）
 *                 | 'unstable'（读到过指纹但始终没稳定，采集未完成）
 *                 | 'timeout'（连一个可解析指标都没等到，采集未完成）
 *                 | 'exception'（launch/导航/eval 抛错，采集未完成）
 *   rawExcerpt    采集时刻页面正文摘录（已剥敏），AI 复核「解析漏了什么」的现场
 *   evidence      { screenshot, raw, screenshotError } —— evidence 目录里的
 *                 截图与全文 dump 的相对路径（拿不到就是 null + 错误说明）
 *   error         未完成时的机器可读原因（已剥敏）
 *   checkedAt     ISO 时间戳
 *
 * 完成/未完成只由 stopReason 决定：resume 跳过已完成的行，未完成的行重测；
 * 熔断也数未完成的行。旧格式（verdict 字段）的行按 legacy 规则识别，
 * 让新脚本能续跑旧输出文件。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 采集完成的 stopReason。empty-state 是「数据源明说没有」，是采集结果不是判决。 */
export const COMPLETE_STOP_REASONS = new Set(['stable', 'empty-state']);

/**
 * 这一行算不算「已经测过」（resume 时跳过）。
 * 新格式看 stopReason；旧格式（还带 verdict 的历史 JSONL）沿用旧语义：
 * verdict === 'error' 是「这次没测成」，其余算测过。两种都认，续跑才不会
 * 把历史文件里已完成的域名重烧一遍配额。
 */
export function isRowComplete(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.stopReason !== undefined) return COMPLETE_STOP_REASONS.has(row.stopReason);
  if (row.verdict !== undefined) return row.verdict !== 'error';
  return false;
}

/** 输出文件旁边的证据目录：`sw.jsonl` → `sw.jsonl.evidence/`。 */
export function evidenceDirFor(outPath) {
  return `${outPath}.evidence`;
}

/** 域名到证据文件名的安全化（域名本身已被 normalizeDomain 限制在 [a-z0-9.-]）。 */
export function evidenceBaseName(domain) {
  return String(domain || '').toLowerCase().replace(/[^a-z0-9.-]/g, '_');
}

/** 原文摘录：去多余空白、截断。落行内用，全文进 evidence 目录的 raw 文件。 */
export function rawExcerptOf(bodyText, maxLen = 1200) {
  const text = String(bodyText ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * 把采集时刻的现场写进 evidence 目录：正文全文（已由调用方剥敏）落 raw 文件，
 * 截图由调用方自己拍（要驱动浏览器）。返回行里要记的相对路径。
 */
export function writeRawEvidence({ outPath, domain, text, redact = (s) => s }) {
  const dir = evidenceDirFor(outPath);
  mkdirSync(dir, { recursive: true });
  const file = `${evidenceBaseName(domain)}.txt`;
  writeFileSync(path.join(dir, file), `${redact(String(text ?? ''))}\n`, 'utf8');
  return path.join(path.basename(dir), file);
}

/** 截图落点（相对路径 + 绝对路径），拍不拍得到由调用方决定。 */
export function screenshotPaths(outPath, domain) {
  const dir = evidenceDirFor(outPath);
  const file = `${evidenceBaseName(domain)}.png`;
  return { abs: path.join(dir, file), rel: path.join(path.basename(dir), file) };
}

#!/usr/bin/env node
// 批量跑 seo.web.cafe 的 On Page SEO 体检(/audit/api/analyze),
// 给一批 url+keyword 对逐个体检,再拼一张对比汇总表。
//
//   node scripts/seo-webcafe-audit.mjs --pairs "https://a.com=keyword a,https://b.com=keyword b" --out ./out
//   node scripts/seo-webcafe-audit.mjs --file ./pairs.tsv --out ./out
//
// 验证记录:2026-08-07,用真实浏览器会话确认过端点契约——
//   POST https://seo.web.cafe/audit/api/analyze
//   Content-Type: application/json
//   X-AUDIT-Token: <浏览器会话签发的令牌,见下方"令牌怎么拿">
//   body: {"url": "...", "keyword": "..."}
//   响应: {score, grade, categories:[{..., checks:[...]}], page{}, ngramTop{}, serpInsight{}}
// (成功响应体的确切形状来自此前已核实的记录;本次批量测试时访客配额已被前面测别的工具耗尽,
// 没能重新拿到一次成功响应,脚本对响应结构保持宽容,缺字段不报错,只在汇总表里留空。)
//
// 认证:实测这个端点**始终**要求一个 X-AUDIT-Token 请求头,不带这个头或帯假值,
// 不管有没有配额,一律直接 403 {"error":"令牌无效或已过期","code":"token"}——
// 这一步和配额检查是两回事,配额检查(游客 10/天、登录 100/天、VIP 500/天)在令牌校验之后才发生。
// 这个令牌不是账号登录凭据,是打开 /audit/ 页面时前端签发的会话令牌,形如
// "<13位时间戳>.<64位十六进制>",实测在有效期内可以跨多次调用重复使用,具体过期时间未知。
//
// 令牌怎么拿(不是登录,是读你自己浏览器已经拿到的东西):
//   1. 用真实浏览器(或 agent-browser)打开 https://seo.web.cafe/audit/,跑一次体检;
//   2. 开发者工具 Network 面板里找 POST /audit/api/analyze 这条请求,复制请求头
//      X-AUDIT-Token 的值;
//   3. export SEO_WEBCAFE_AUDIT_TOKEN='<复制的值>' 再跑本脚本。
// 本脚本不会,也不应该帮你生成或破解这个令牌——它是你自己已建立的浏览器会话签发的,
// 脚本只是替你少开几次浏览器去逐条填表。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://seo.web.cafe/audit/api/analyze";

function printHelp() {
  console.log(`用法:
  node seo-webcafe-audit.mjs --pairs "url1=keyword1,url2=keyword2" [选项]
  node seo-webcafe-audit.mjs --file <url\\tkeyword 每行一对,TSV> [选项]

选项:
  --pairs <逗号分隔的 url=keyword>   直接传 URL/关键词对,用 = 分隔
  --file <path>                     从 TSV 文件读 url\\tkeyword,# 开头和空行跳过
  --out <dir>                       输出目录,默认 ./seo-webcafe-audit-out
  --spacing-ms <ms>                 请求间隔,默认 3000(体检比较重,给点余量)
  --token <string>                  直接传 X-AUDIT-Token 值(优先于环境变量)
  --help                            显示这个帮助

环境变量:
  SEO_WEBCAFE_AUDIT_TOKEN   必需。从你自己的浏览器会话里复制的 X-AUDIT-Token 值,
                            见上方文件头注释"令牌怎么拿"。本脚本不会帮你生成或破解它。

输出:
  <out>/<url-slug>.json     每个 URL 的完整体检响应
  <out>/summary.tsv         url、keyword、score、grade、失败项数、失败的 check id 列表
`);
}

function parseArgs(argv) {
  const args = { pairs: [], out: "./seo-webcafe-audit-out", spacingMs: 3000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--pairs":
        args.pairsRaw = argv[++i];
        break;
      case "--file":
        args.file = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--spacing-ms":
        args.spacingMs = Number(argv[++i]);
        break;
      case "--token":
        args.token = argv[++i];
        break;
      default:
        throw new Error(`未知参数: ${arg}(用 --help 看用法)`);
    }
  }
  return args;
}

function slugify(url) {
  return url
    .replace(/^https?:\/\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "url";
}

async function loadPairs(args) {
  const pairs = [];
  if (args.pairsRaw) {
    for (const chunk of args.pairsRaw.split(",")) {
      const idx = chunk.indexOf("=");
      if (idx === -1) throw new Error(`--pairs 里这一项没有 "=": ${chunk}`);
      pairs.push({ url: chunk.slice(0, idx).trim(), keyword: chunk.slice(idx + 1).trim() });
    }
  }
  if (args.file) {
    const text = await readFile(args.file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [url, keyword = ""] = trimmed.split("\t");
      pairs.push({ url: url.trim(), keyword: keyword.trim() });
    }
  }
  return pairs;
}

async function auditOne({ url, keyword }, token) {
  const headers = { "Content-Type": "application/json", "X-AUDIT-Token": token };

  const started = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, keyword }),
  });
  const elapsedMs = Date.now() - started;
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, elapsedMs, body };
}

function extractFailedChecks(body) {
  const failed = [];
  for (const category of body?.categories ?? []) {
    for (const check of category?.checks ?? []) {
      const passed = check?.pass ?? check?.passed ?? check?.ok;
      if (passed === false) {
        failed.push(check?.id ?? check?.name ?? "unknown-check");
      }
    }
  }
  return failed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.pairsRaw && !args.file)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const token = args.token ?? process.env.SEO_WEBCAFE_AUDIT_TOKEN ?? null;
  if (!token) {
    console.error(
      "缺少 X-AUDIT-Token。\n" +
        "本脚本不会帮你生成或破解它 —— 打开 https://seo.web.cafe/audit/ 跑一次体检,\n" +
        "从开发者工具 Network 面板复制 POST /audit/api/analyze 请求的 X-AUDIT-Token 请求头,\n" +
        "然后 `export SEO_WEBCAFE_AUDIT_TOKEN='...'` 或用 --token 传入再重跑。",
    );
    process.exit(1);
  }

  const pairs = await loadPairs(args);
  if (pairs.length === 0) {
    console.error("没有可体检的 url/keyword 对。");
    process.exit(1);
  }

  await mkdir(args.out, { recursive: true });
  const summaryRows = ["url\tkeyword\tstatus\tscore\tgrade\tfailed_checks\terror"];

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    process.stderr.write(`[${i + 1}/${pairs.length}] ${pair.url} (${pair.keyword}) ... `);
    let result;
    try {
      result = await auditOne(pair, token);
    } catch (err) {
      result = { status: "network-error", ok: false, elapsedMs: 0, body: { error: String(err) } };
    }

    const outPath = path.join(args.out, `${slugify(pair.url)}.json`);
    await writeFile(outPath, JSON.stringify({ ...pair, ...result }, null, 2), "utf8");

    const failedChecks = extractFailedChecks(result.body);
    const errorMsg = result.ok ? "" : result.body?.error ?? result.body?.message ?? "";
    summaryRows.push(
      [
        pair.url,
        pair.keyword,
        result.status,
        result.body?.score ?? "",
        result.body?.grade ?? "",
        failedChecks.join(";"),
        errorMsg,
      ].join("\t"),
    );
    process.stderr.write(`${result.status}\n`);

    if (i < pairs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, args.spacingMs));
    }
  }

  const summaryPath = path.join(args.out, "summary.tsv");
  await writeFile(summaryPath, summaryRows.join("\n") + "\n", "utf8");
  console.error(`\n完成。逐条结果在 ${args.out}/*.json,对比汇总在 ${summaryPath}`);
}

main().catch((err) => {
  console.error(`执行失败: ${err.message}`);
  process.exit(1);
});

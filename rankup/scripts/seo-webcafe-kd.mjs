#!/usr/bin/env node
// 批量查 seo.web.cafe 的关键词难度(哥飞版 KD)。
//
//   node scripts/seo-webcafe-kd.mjs --keywords "markdown to pdf,pdf editor" --out ./out
//   node scripts/seo-webcafe-kd.mjs --file ./keywords.txt --gl us --format full --out ./out
//
// 验证记录:2026-08-07,针对 GET https://seo.web.cafe/kd/api/v1/kd 手动核对过一次
// (未在本次批量测试中重复调用,遵照"该端点已文档化、不要再花配额去重测"的约束)。
// 端点契约来自项目既有文档:query 参数 keyword/gl/hl/force/format,
// Authorization: Bearer wc_mcp_... ,访客 10/天、登录 100/天、VIP 500/天,
// 10 请求/分钟突发熔断,7 天结果缓存。
//
// 本脚本只做批量调度和落盘,不做认证:token 必须来自环境变量 SEO_WEBCAFE_TOKEN,
// 绝不写在代码或配置文件里,也绝不由脚本去登录/生成。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://seo.web.cafe/kd/api/v1/kd";
// 站点文档写的是"10 请求/分钟"的突发熔断,换算成请求间隔要大于 60/10=6 秒,
// 这里留一点余量。
const MIN_SPACING_MS = 6000;

function printHelp() {
  console.log(`用法:
  node seo-webcafe-kd.mjs --keywords "词1,词2" [选项]
  node seo-webcafe-kd.mjs --file <关键词文件,每行一个> [选项]

选项:
  --keywords <逗号分隔>   直接传关键词列表
  --file <path>           从文件读关键词,每行一个,# 开头的行和空行会跳过
  --gl <国家代码>         地区,默认 us
  --hl <语言代码>         语言,默认 en
  --force                 跳过 7 天缓存强制重查(会额外消耗配额,谨慎使用)
  --format <mode>         传给 API 的 format 参数,默认不传(用站点默认值)
  --out <dir>             输出目录,默认 ./seo-webcafe-kd-out
  --spacing-ms <ms>       请求间隔,默认 ${MIN_SPACING_MS}(不允许低于这个值)
  --help                  显示这个帮助

环境变量:
  SEO_WEBCAFE_TOKEN      必需。https://seo.web.cafe 签发的 wc_mcp_ 开头的 Bearer token。
                         本脚本不会,也不应该帮你登录或生成这个 token。

输出:
  <out>/<keyword-slug>.json   每个关键词的完整响应
  <out>/summary.tsv           关键词、难度分、状态、耗时的汇总表
`);
}

function parseArgs(argv) {
  const args = {
    keywords: [],
    gl: "us",
    hl: "en",
    force: false,
    format: null,
    out: "./seo-webcafe-kd-out",
    spacingMs: MIN_SPACING_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--keywords":
        args.keywordsRaw = argv[++i];
        break;
      case "--file":
        args.file = argv[++i];
        break;
      case "--gl":
        args.gl = argv[++i];
        break;
      case "--hl":
        args.hl = argv[++i];
        break;
      case "--force":
        args.force = true;
        break;
      case "--format":
        args.format = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--spacing-ms":
        args.spacingMs = Number(argv[++i]);
        break;
      default:
        throw new Error(`未知参数: ${arg}(用 --help 看用法)`);
    }
  }
  return args;
}

function slugify(keyword) {
  return keyword
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "keyword";
}

async function loadKeywords(args) {
  const keywords = [];
  if (args.keywordsRaw) {
    keywords.push(...args.keywordsRaw.split(",").map((s) => s.trim()).filter(Boolean));
  }
  if (args.file) {
    const text = await readFile(args.file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      keywords.push(trimmed);
    }
  }
  return [...new Set(keywords)];
}

async function queryOne(keyword, token, args) {
  const url = new URL(API_BASE);
  url.searchParams.set("keyword", keyword);
  if (args.gl) url.searchParams.set("gl", args.gl);
  if (args.hl) url.searchParams.set("hl", args.hl);
  if (args.force) url.searchParams.set("force", "true");
  if (args.format) url.searchParams.set("format", args.format);

  const started = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const elapsedMs = Date.now() - started;
  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, elapsedMs, body };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.keywordsRaw && !args.file)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (args.spacingMs < MIN_SPACING_MS) {
    throw new Error(
      `--spacing-ms 不能低于 ${MIN_SPACING_MS}ms:站点文档写的是 10 请求/分钟的突发熔断,` +
        `低于这个间隔会被限流。`,
    );
  }

  const token = process.env.SEO_WEBCAFE_TOKEN;
  if (!token) {
    console.error(
      "缺少环境变量 SEO_WEBCAFE_TOKEN。\n" +
        "本脚本不会帮你登录或生成 token —— 去 https://seo.web.cafe 用你自己的账号获取 wc_mcp_ 开头的 token,\n" +
        "然后 `export SEO_WEBCAFE_TOKEN=wc_mcp_...` 再重跑。",
    );
    process.exit(1);
  }

  const keywords = await loadKeywords(args);
  if (keywords.length === 0) {
    console.error("没有可查询的关键词(--keywords 和 --file 都是空的)。");
    process.exit(1);
  }

  await mkdir(args.out, { recursive: true });
  const summaryRows = ["keyword\tstatus\tkd_score\telapsed_ms\terror"];

  for (let i = 0; i < keywords.length; i += 1) {
    const keyword = keywords[i];
    process.stderr.write(`[${i + 1}/${keywords.length}] ${keyword} ... `);
    let result;
    try {
      result = await queryOne(keyword, token, args);
    } catch (err) {
      result = { status: "network-error", ok: false, elapsedMs: 0, body: { error: String(err) } };
    }

    const outPath = path.join(args.out, `${slugify(keyword)}.json`);
    await writeFile(outPath, JSON.stringify({ keyword, ...result }, null, 2), "utf8");

    const kdScore = result.body?.score ?? result.body?.kd ?? result.body?.difficulty ?? "";
    const errorMsg = result.ok ? "" : result.body?.error ?? result.body?.message ?? "";
    summaryRows.push(
      `${keyword}\t${result.status}\t${kdScore}\t${result.elapsedMs}\t${errorMsg}`,
    );
    process.stderr.write(`${result.status}\n`);

    if (i < keywords.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, args.spacingMs));
    }
  }

  const summaryPath = path.join(args.out, "summary.tsv");
  await writeFile(summaryPath, summaryRows.join("\n") + "\n", "utf8");
  console.error(`\n完成。逐词结果在 ${args.out}/*.json,汇总表在 ${summaryPath}`);
}

main().catch((err) => {
  console.error(`执行失败: ${err.message}`);
  process.exit(1);
});

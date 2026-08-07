#!/usr/bin/env node
// 批量查 seo.web.cafe 的「Stripe 收银台引荐流量榜」(/referring/),按域名核对
// 谁在给 Stripe Checkout 送付费流量、按月看榜单。
//
// 之所以是第三个被封装的工具而不是别的:实测这是唯一一组**完全不吃访客配额**的接口——
// 其余工具(translate/mine/serp/domain/history/worth/backlink/review/adsense/audit)全部
// 命中同一个全站共享的访客配额池(10/天),批量脚本化的意义不大,一次批量调用就打光当天额度。
// `/referring/` 的三个 GET 端点在配额之外没有额外限制,数据是月度榜单快照,
// 适合反复、批量地核对多个域名,复用价值最高。详见 references/seo-webcafe.md。
//
//   node scripts/seo-webcafe-referring.mjs --month 202606 --out ./out
//   node scripts/seo-webcafe-referring.mjs --domains "stripe.com,cloudconvert.com" --out ./out
//   node scripts/seo-webcafe-referring.mjs --month 202606 --domains "a.com,b.com" --out ./out
//
// 验证记录:2026-08-07,真实浏览器会话实测:
//   GET https://seo.web.cafe/referring/api/summary        → 榜单总览,页面加载即发,无参数
//   GET https://seo.web.cafe/referring/api/month?m=YYYYMM → 指定月份的榜单
//   GET https://seo.web.cafe/referring/api/site?domain=X  → 单个域名的历史趋势,
//                                                            响应含 {domain, months:[...], stats{}}
// **重要更正**:一开始误以为这组接口完全不需要认证,后来用 curl 单独重放才发现——
// 不带 X-REF-Token 或带一个瞎编的值,一律 403 {"error":"令牌无效或已过期","code":"token"};
// 用从真实浏览器会话复制出来的 X-REF-Token(格式 "<13位时间戳>.<64位十六进制>")重放,
// 200 且可以跨域名、跨端点重复使用。也就是说这组接口"不吃配额"是真的,但"免认证"是假的——
// 它免的是配额限制,免不了这个每个工具各自签发的会话令牌。
//
// 令牌怎么拿(不是登录,是读你自己浏览器已经拿到的东西):
//   1. 用真实浏览器(或 agent-browser)打开 https://seo.web.cafe/referring/,
//      随便点一次"站点查询"或切一次月份;
//   2. 开发者工具 Network 面板里找 /referring/api/* 任意一条请求,复制请求头
//      X-REF-Token 的值;
//   3. export SEO_WEBCAFE_REF_TOKEN='<复制的值>' 再跑本脚本。
// 实测这个令牌可以跨多次、跨端点重复使用,具体过期时间未知,过期了重新按上面步骤取一次即可。
// 本脚本不会,也不应该帮你生成或破解这个令牌。

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://seo.web.cafe/referring/api";
const SPACING_MS_DEFAULT = 1500;

function printHelp() {
  console.log(`用法:
  node seo-webcafe-referring.mjs [--month YYYYMM] [--domains "a.com,b.com"] --out <dir>

选项:
  --month <YYYYMM>      查这个月的榜单(等价于点开"榜单"标签选月份)
  --summary             额外拉一次总览(/referring/api/summary)
  --domains <逗号分隔>   逐个查询这些域名的历史趋势(等价于"站点查询")
  --out <dir>           输出目录,默认 ./seo-webcafe-referring-out
  --spacing-ms <ms>     请求间隔,默认 ${SPACING_MS_DEFAULT}(该接口未见限流,但仍不做并发轰炸)
  --token <string>      直接传 X-REF-Token 值(优先于环境变量)
  --help                显示这个帮助

环境变量:
  SEO_WEBCAFE_REF_TOKEN   必需。从你自己的浏览器会话里复制的 X-REF-Token 值,
                          见上方文件头注释"令牌怎么拿"。

输出:
  <out>/summary.json           总览(若传了 --summary)
  <out>/month-<YYYYMM>.json    指定月份榜单(若传了 --month)
  <out>/site-<domain-slug>.json  每个域名的历史趋势(若传了 --domains)
  <out>/domains-summary.tsv    域名批量查询的汇总表(domain、月份数、最新月流量、错误)
`);
}

function parseArgs(argv) {
  const args = { out: "./seo-webcafe-referring-out", spacingMs: SPACING_MS_DEFAULT, domains: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--month":
        args.month = argv[++i];
        break;
      case "--summary":
        args.summary = true;
        break;
      case "--domains":
        args.domains = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--token":
        args.token = argv[++i];
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

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "value";
}

async function getJson(url, token) {
  const started = Date.now();
  const res = await fetch(url, { headers: { "X-REF-Token": token } });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.month && !args.summary && args.domains.length === 0)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const token = args.token ?? process.env.SEO_WEBCAFE_REF_TOKEN ?? null;
  if (!token) {
    console.error(
      "缺少 X-REF-Token。\n" +
        "本脚本不会帮你生成或破解它 —— 打开 https://seo.web.cafe/referring/ 点一次\"站点查询\",\n" +
        "从开发者工具 Network 面板复制任意一条 /referring/api/* 请求的 X-REF-Token 请求头,\n" +
        "然后 `export SEO_WEBCAFE_REF_TOKEN='...'` 或用 --token 传入再重跑。",
    );
    process.exit(1);
  }

  await mkdir(args.out, { recursive: true });

  if (args.summary) {
    process.stderr.write("获取总览 ... ");
    const result = await getJson(`${BASE}/summary`, token);
    await writeFile(path.join(args.out, "summary.json"), JSON.stringify(result, null, 2), "utf8");
    process.stderr.write(`${result.status}\n`);
  }

  if (args.month) {
    if (!/^\d{6}$/.test(args.month)) {
      throw new Error(`--month 要是 YYYYMM 六位数字,收到的是: ${args.month}`);
    }
    process.stderr.write(`获取 ${args.month} 月榜单 ... `);
    const result = await getJson(`${BASE}/month?m=${encodeURIComponent(args.month)}`, token);
    await writeFile(
      path.join(args.out, `month-${args.month}.json`),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    process.stderr.write(`${result.status}\n`);
  }

  if (args.domains.length > 0) {
    const summaryRows = ["domain\tstatus\tmonths_count\tlatest_month\terror"];
    for (let i = 0; i < args.domains.length; i += 1) {
      const domain = args.domains[i];
      process.stderr.write(`[${i + 1}/${args.domains.length}] ${domain} ... `);
      let result;
      try {
        result = await getJson(`${BASE}/site?domain=${encodeURIComponent(domain)}`, token);
      } catch (err) {
        result = { status: "network-error", ok: false, elapsedMs: 0, body: { error: String(err) } };
      }

      await writeFile(
        path.join(args.out, `site-${slugify(domain)}.json`),
        JSON.stringify({ domain, ...result }, null, 2),
        "utf8",
      );

      const months = result.body?.months ?? [];
      const errorMsg = result.ok ? "" : result.body?.error ?? result.body?.message ?? "";
      summaryRows.push(
        `${domain}\t${result.status}\t${months.length}\t${months[months.length - 1] ?? ""}\t${errorMsg}`,
      );
      process.stderr.write(`${result.status}\n`);

      if (i < args.domains.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, args.spacingMs));
      }
    }
    const summaryPath = path.join(args.out, "domains-summary.tsv");
    await writeFile(summaryPath, summaryRows.join("\n") + "\n", "utf8");
    console.error(`域名批量查询汇总在 ${summaryPath}`);
  }

  console.error(`完成。所有原始结果在 ${args.out}/`);
}

main().catch((err) => {
  console.error(`执行失败: ${err.message}`);
  process.exit(1);
});

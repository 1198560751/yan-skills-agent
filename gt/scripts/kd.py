#!/usr/bin/env python3
"""Keyword Difficulty estimator — wraps the Web.Cafe KD API (哥飞版).

Usage:
    python3 kd.py <keyword> [--gl US] [--format json|markdown] [--force] [--token TOKEN]

Examples:
    python3 kd.py "ai photo editor"
    python3 kd.py "remove background" --gl JP
    python3 kd.py "pdf to excel" --format json
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://seo.web.cafe/kd/api/v1/kd"
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_env_token() -> str | None:
    env_file = os.path.join(SKILL_DIR, ".env")
    if not os.path.exists(env_file):
        return None
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line.startswith("KD_TOKEN="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return None


def fetch_kd(keyword: str, gl: str = "us", hl: str = "en",
             force: bool = False, fmt: str = "json", token: str | None = None) -> dict | str:
    token = token or os.environ.get("KD_TOKEN") or _load_env_token()
    if not token:
        print("❌ 未找到 KD_TOKEN。", file=sys.stderr)
        print(f"   方法 1: 在 {SKILL_DIR}/.env 中写入 KD_TOKEN=你的令牌", file=sys.stderr)
        print("   方法 2: export KD_TOKEN='你的令牌'", file=sys.stderr)
        print("   方法 3: python3 kd.py <keyword> --token 你的令牌", file=sys.stderr)
        print("   令牌获取: https://seo.web.cafe/kd", file=sys.stderr)
        sys.exit(1)
    params = {"keyword": keyword, "gl": gl, "hl": hl}
    if force:
        params["force"] = "1"
    if fmt == "markdown":
        params["format"] = "markdown"

    url = f"{API_BASE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "kd-skill/1.0",
    })

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            if fmt == "markdown":
                return body
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)
        except Exception:
            err = {"error": body}
        code_map = {
            401: "令牌无效，请重新获取: https://seo.web.cafe/kd",
            429: "限流或额度用完，稍后重试（每分钟 ≤10 次，每日额度共用）",
            400: "参数错误（keyword 缺失或过长）",
            502: "上游数据源故障，可重试",
        }
        hint = code_map.get(e.code, "")
        print(f"❌ HTTP {e.code}: {err.get('error', err)}", file=sys.stderr)
        if hint:
            print(f"   → {hint}", file=sys.stderr)
        sys.exit(1)


def fmt_number(n: int | float | None) -> str:
    if n is None:
        return "—"
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(int(n))


def calc_backlink_cost(n: int) -> float:
    """Tiered backlink cost: first 10 @ $100, 11-50 +1%/link, 51-200 +1.5%/link, 200+ +2%/link."""
    total = 0.0
    price = 100.0
    for i in range(1, n + 1):
        total += price
        if i >= 200:
            price *= 1.02
        elif i >= 50:
            price *= 1.015
        elif i >= 10:
            price *= 1.01
    return total


def calc_kdroi(monthly_volume: int | float, required_backlinks: int) -> float | None:
    """KDROI = (daily_vol × $0.1 × 365 / backlink_cost - 1) × 100%"""
    if not monthly_volume or not required_backlinks:
        return None
    daily_vol = monthly_volume / 30
    annual_revenue = daily_vol * 0.1 * 365
    backlink_cost = calc_backlink_cost(required_backlinks)
    if backlink_cost == 0:
        return None
    return (annual_revenue / backlink_cost - 1) * 100


def render_markdown(data: dict) -> str:
    lines = []
    kw = data["keyword"]
    gl = data.get("gl", "us").upper()
    score = data["score"]
    level = data["level"]
    kw_type = data.get("keywordType", "generic")
    volume = data.get("keywordVolume")
    trend = data.get("keywordTrend")
    lb = data.get("linkBudget")

    lines.append(f"## {kw} ({gl})")
    lines.append("")

    parts = [f"**难度**: {score}/100 ({level})"]
    if volume:
        parts.append(f"**月搜索量**: {fmt_number(volume)}")
    parts.append(f"**类型**: {'品牌词' if kw_type == 'brand' else '通用词'}")
    if data.get("genericScore"):
        parts.append(f"**常规口径**: {data['genericScore']}")
    lines.append(" | ".join(parts))
    lines.append("")

    kdroi = None
    if volume and lb:
        mid_links = lb.get("quality", {}).get("mid")
        if mid_links:
            kdroi = calc_kdroi(volume, mid_links)
            backlink_cost = calc_backlink_cost(mid_links)
            annual_rev = (volume / 30) * 0.1 * 365
            roi_label = f"{kdroi:+.0f}%" if kdroi is not None else "—"
            roi_verdict = "✅ 高回报" if kdroi and kdroi > 100 else "⚠️ 正回报" if kdroi and kdroi > 0 else "❌ 负回报"
            lines.append(f"### KDROI 投资回报")
            lines.append(f"- **KDROI**: {roi_label} ({roi_verdict})")
            lines.append(f"- 年化流量价值: ${annual_rev:,.0f}（{fmt_number(volume)}/月 × $0.1/点击 × 365天）")
            lines.append(f"- 外链成本: ${backlink_cost:,.0f}（{mid_links} 条优质外链，阶梯定价）")
            lines.append("")

    if trend and trend.get("ratio") is not None:
        r = trend["ratio"]
        if r >= 1:
            lines.append(f"🔥 **上升期**: {trend.get('domain', '?')} 月搜索流量 {fmt_number(trend.get('estimatedValue', 0))}，ratio {r:.2f} — 快速增长中")
        else:
            lines.append(f"📊 **趋势 ratio**: {r:.2f} (< 1 = 未进入爆发期)")
        lines.append("")

    reasons = data.get("reasons", [])
    if reasons:
        lines.append("### 判断原因")
        for r in reasons:
            lines.append(f"- {r}")
        lines.append("")

    if lb:
        lines.append("### 链接预算（进入前十）")
        lines.append(f"- **目标 DR**: {lb.get('targetDr', '—')}")
        q = lb.get("quality", {})
        d = lb.get("directory", {})
        lines.append(f"- **优质外链**: {q.get('low', '—')}–{q.get('high', '—')}（中值 {q.get('mid', '—')}）")
        lines.append(f"- **目录型外链**: {d.get('low', '—')}–{d.get('high', '—')}（中值 {d.get('mid', '—')}）")
        lines.append("")

    details = data.get("details", [])
    if details:
        lines.append("### 前十盘面")
        lines.append("| # | 域名 | 类型 | DR | 月访问 | 年龄 | 专门经营 | 主力词命中 | 强度 |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for d in details:
            pos = d.get("position", "?")
            domain = d.get("domain", "?")
            pt = d.get("pageType", "?")
            dr = d.get("dr", "?")
            visits = d.get("visitsLabel", "?")
            age = d.get("ageLabel", "?")
            ded = "✅" if d.get("dedicated") else "—"
            kw_hit = "✅" if d.get("kwHit") else "—"
            if d.get("kwHitTraffic"):
                kw_hit += f" ({fmt_number(d['kwHitTraffic'])})"
            strength = f"{d.get('strength', '?'):.0f}" if isinstance(d.get("strength"), (int, float)) else "?"
            lines.append(f"| {pos} | {domain} | {pt} | {dr} | {visits} | {age} | {ded} | {kw_hit} | {strength} |")
        lines.append("")

        new_sites = [d for d in details if isinstance(d.get("ageYears"), (int, float)) and d["ageYears"] < 1.5]
        if new_sites:
            lines.append("### 新站信号")
            for s in new_sites:
                lines.append(f"- **{s['domain']}**（{s.get('ageLabel', '?')}）排第 {s['position']} 名，DR {s.get('dr', '?')} — 新站可入场的证据")
            lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Keyword Difficulty (哥飞版)")
    parser.add_argument("keyword", help="关键词（英文）")
    parser.add_argument("--gl", default="us", help="Google 国家代码 (default: us)")
    parser.add_argument("--hl", default="en", help="语言代码 (default: en)")
    parser.add_argument("--force", action="store_true", help="跳过 7 天缓存强制重算")
    parser.add_argument("--format", choices=["json", "markdown", "raw"], default="markdown",
                        help="输出格式: markdown(默认, 本地渲染) / raw(API 原始 markdown) / json")
    parser.add_argument("--token", help="API 令牌 (也可设 KD_TOKEN 环境变量)")
    args = parser.parse_args()

    if args.format == "raw":
        result = fetch_kd(args.keyword, args.gl, args.hl, args.force, "markdown", args.token)
        print(result)
    elif args.format == "json":
        result = fetch_kd(args.keyword, args.gl, args.hl, args.force, "json", args.token)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result = fetch_kd(args.keyword, args.gl, args.hl, args.force, "json", args.token)
        print(render_markdown(result))


if __name__ == "__main__":
    main()

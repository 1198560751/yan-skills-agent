#!/usr/bin/env bash
# Semrush Site Audit · 已抓取页面（review/pagereport）双证人采集（见同目录 PAGE.md）
# 用法: collect.sh [campaign-id] [out-dir]
#   campaign-id 默认 31025602（本仓已有项目；建新项目会吃掉 15 个 Projects 名额之一）
# 注意: 本路由 302 到 /review/pagereport/pages，必须放行该具体路径；
#       accept 的是真别名，绝不是 "/"（放行 "/" 等于把空白页当数据采）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel)"

CID="${1:-31025602}"
OUT="${2:-$ROOT/backlink/evidence/ground-truth/semrush-siteaudit-pagereport-$(date +%Y%m%d-%H%M%S)}"

URL="https://sem.3ue.co/siteaudit/campaign/${CID}/review/pagereport"

exec node "$ROOT/backlink/scripts/ground-truth.mjs" \
  --url "$URL" \
  --out "$OUT" \
  --budget 180 --max-screens 16 \
  --accept-redirect "/siteaudit/campaign/${CID}/review/pagereport/pages"

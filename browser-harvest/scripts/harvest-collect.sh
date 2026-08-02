#!/bin/bash
# harvest-collect.sh — 把下载目录里的抓取结果等齐、查重、收拢到项目目录
#
#   bash harvest-collect.sh <期望文件数> <目标目录> [下载目录]
#
# 为什么必须等：Blob 下载是异步的，最后一个文件常常晚几秒才落盘。
# 实测在最后一个下载完成前就 cp，**整整一个数据源静默丢失**，
# 而后续的合并报告看起来完全正常 —— 这类错误没有任何报错，只能靠计数拦。
#
# 为什么必须查重：浏览器对同名下载不覆盖，而是另存成 `xxx (1).tsv` 或**去掉扩展名**。
# 实测同一目标产生过两份内容不同的文件。按 *.tsv 通配合并要么漏读要么重复计入。
set -euo pipefail

EXPECT="${1:?用法: harvest-collect.sh <期望文件数> <目标目录> [下载目录]}"
DEST="${2:?用法: harvest-collect.sh <期望文件数> <目标目录> [下载目录]}"
DL="${3:-$HOME/Downloads}"
PREFIX="harvest_"

mkdir -p "$DEST"

n=0
while [ $n -lt 60 ]; do
  c=$(find "$DL" -maxdepth 1 -name "${PREFIX}*.tsv" 2>/dev/null | wc -l | tr -d ' ')
  [ "$c" -ge "$EXPECT" ] && break
  sleep 3
  n=$((n + 1))
done

c=$(find "$DL" -maxdepth 1 -name "${PREFIX}*.tsv" 2>/dev/null | wc -l | tr -d ' ')
if [ "$c" -lt "$EXPECT" ]; then
  echo "✗ 只等到 $c/$EXPECT 个文件就超时了。不复制 —— 宁可重跑，也不要静默少一个数据源。" >&2
  exit 1
fi

# 浏览器重名产物：`(1)` 后缀 与 无扩展名残片
dupes=$(find "$DL" -maxdepth 1 -name "${PREFIX}*([0-9])*" 2>/dev/null || true)
strays=$(find "$DL" -maxdepth 1 -name "${PREFIX}*" ! -name "*.tsv" 2>/dev/null || true)
if [ -n "$dupes" ] || [ -n "$strays" ]; then
  echo "✗ 下载目录有浏览器重名产物，内容可能与正本不同，先清理再跑：" >&2
  [ -n "$dupes" ] && echo "$dupes" >&2
  [ -n "$strays" ] && echo "$strays" >&2
  exit 1
fi

find "$DL" -maxdepth 1 -name "${PREFIX}*.tsv" -exec cp {} "$DEST"/ \;
echo "✓ 已收拢 $c 个文件到 $DEST"

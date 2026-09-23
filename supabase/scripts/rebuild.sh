#!/usr/bin/env bash
# Story 5.4：本地干净重建（一条命令）。FR-P2-16；AR-3、AR-6
#
#   1. 停止本地栈并删除全部数据卷 —— 数据库与 Storage 从零（真·干净环境）
#   2. 启动本地栈 —— 首次启动会自动应用迁移 + 种子
#   3. 重建数据库 —— 迁移 + 种子（保证任何状态下都得到干净库）
#   4. 运行数据库测试 —— supabase test db
#
# 用法：cd supabase && bash scripts/rebuild.sh
# 之后可运行重建后端到端验证（需要 Deno）：
#     deno task verify:login && deno task verify:rebuild
#
# 注意：会删除本地栈里的全部数据（Phase 2 只有测试数据，取杯号跳号无害）。
# 本阶段不上云，没有云端推送步骤。

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 1/4 停止本地栈并删除全部数据卷（干净环境的前提）"
if supabase status >/dev/null 2>&1; then
  supabase stop --no-backup --yes
else
  echo "    本地栈未在运行，跳过停止步骤"
fi

echo "==> 2/4 启动本地栈（首次启动会自动应用迁移与种子）"
supabase start

echo "==> 3/4 重建数据库（迁移 + 种子）"
supabase db reset --yes

echo "==> 4/4 运行数据库测试（supabase test db）"
supabase test db

echo
echo "重建完成。重建后端到端验证（需要 Deno）："
echo "    deno task verify:login"
echo "    deno task verify:rebuild"

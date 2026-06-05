#!/bin/bash
# launchd plist のアンインストーラ
# - ~/Library/LaunchAgents/ に置かれた dailyClaudeNews 系の plist を bootout し、
#   生成済 .plist と repo 内の launchd/*.plist (もしあれば) を削除する。
#
# 使い方:
#   ./scripts/uninstall-launchd.sh

set -euo pipefail

: "${HOME:?HOME が未設定です}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${HOME}/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

shopt -s nullglob
agents=("${TARGET_DIR}"/*dailyClaudeNews*.plist)
for plist in "${agents[@]}"; do
  label="$(basename "${plist}" .plist)"
  echo "[uninstall-launchd] bootout: ${label}"
  launchctl bootout "${DOMAIN}/${label}" 2>/dev/null || true
  rm -f "${plist}"
  echo "[uninstall-launchd] 削除: ${plist}"
done

# repo 内に生成済 .plist が残っていれば掃除（.template は残す）
gen=("${PROJECT_ROOT}/launchd"/*.plist)
for plist in "${gen[@]}"; do
  rm -f "${plist}"
  echo "[uninstall-launchd] 削除: ${plist}"
done

echo "[uninstall-launchd] 完了"

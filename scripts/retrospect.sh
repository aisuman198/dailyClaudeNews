#!/bin/bash
# launchd から 10:00 JST に起動される retrospect ラッパー
# - 当日作成された GitHub Issue を点検し
# - 過去と同一パターンでない novel な issue があれば
# - macOS 通知 + draft PR を自動作成する
#
# PROJECT_ROOT / HOME はスクリプトの実体位置と launchd 環境から導出する（個人パス非依存）

set -u

: "${HOME:?HOME が未設定です。launchd が gui ドメインで起動していることを確認してください}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${HOME}/Library/Logs/dailyClaudeNews"
mkdir -p "${LOG_DIR}"

LOG_FILE="${LOG_DIR}/retrospect.log"
ERR_FILE="${LOG_DIR}/retrospect.error.log"

cd "${PROJECT_ROOT}" || {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] cd 失敗: ${PROJECT_ROOT}" >> "${ERR_FILE}"
  exit 1
}

if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${PROJECT_ROOT}/.env"
  set +a
fi

export PATH="${HOME}/.nodenv/shims:${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="ja_JP.UTF-8"
export LC_ALL="ja_JP.UTF-8"

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === retrospect 起動 ==="
  node dist/retrospect.js
  EXIT_CODE=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === 終了コード: ${EXIT_CODE} ==="
  exit "${EXIT_CODE}"
} >> "${LOG_FILE}" 2>> "${ERR_FILE}"

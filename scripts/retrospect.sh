#!/bin/bash
# launchd から 09:00 JST に起動される retrospect ラッパー
# - 当日作成された GitHub Issue を点検し
# - 過去と同一パターンでない novel な issue があれば
# - macOS 通知 + draft PR を自動作成する
#
# 設計は run.sh と同じ: cron 専用 worktree で動き、毎回 origin/main に reset
# してから npm ci / npm run build / node dist/retrospect.js を実行する。

set -u

: "${HOME:?HOME が未設定です。launchd が gui ドメインで起動していることを確認してください}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_PATH="${HOME}/Library/Application Support/dailyClaudeNews/worktree"
LOG_DIR="${HOME}/Library/Logs/dailyClaudeNews"
mkdir -p "${LOG_DIR}"

LOG_FILE="${LOG_DIR}/retrospect.log"
ERR_FILE="${LOG_DIR}/retrospect.error.log"

export PATH="${HOME}/.nodenv/shims:${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="ja_JP.UTF-8"
export LC_ALL="ja_JP.UTF-8"

# worktree が無ければ作る (run.sh 側で作られている想定だが、retrospect 単独実行も許容)
if [ ! -e "${WORKTREE_PATH}/.git" ]; then
  {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] worktree 未作成 → setup-cron-worktree.sh を実行"
    "${PROJECT_ROOT}/scripts/setup-cron-worktree.sh"
  } >> "${LOG_FILE}" 2>> "${ERR_FILE}" || {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] setup-cron-worktree.sh 失敗" >> "${ERR_FILE}"
    exit 1
  }
fi

cd "${WORKTREE_PATH}" || {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] cd 失敗: ${WORKTREE_PATH}" >> "${ERR_FILE}"
  exit 1
}

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === pre-run: fetch + reset to origin/main ==="
  git fetch origin main
  git reset --hard origin/main
  git clean -fd dist/ 2>/dev/null || true
  npm ci --silent --no-audit --no-fund
  npm run build
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === pre-run 完了 (HEAD: $(git rev-parse --short HEAD)) ==="
} >> "${LOG_FILE}" 2>> "${ERR_FILE}" || {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === pre-run 失敗 ===" >> "${ERR_FILE}"
  exit 1
}

if [ -f "${WORKTREE_PATH}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${WORKTREE_PATH}/.env"
  set +a
fi

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === retrospect 起動 (worktree: ${WORKTREE_PATH}) ==="
  node dist/retrospect.js
  EXIT_CODE=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === 終了コード: ${EXIT_CODE} ==="
  exit "${EXIT_CODE}"
} >> "${LOG_FILE}" 2>> "${ERR_FILE}"

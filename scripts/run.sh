#!/bin/bash
# launchd から起動されるラッパースクリプト
# - プロジェクトディレクトリへ移動
# - .env を読み込み
# - PATH に node / claude / gh を追加
# - node dist/index.js を実行し、ログを ~/Library/Logs/dailyClaudeNews/ に出力

set -u

PROJECT_ROOT="/Users/shuichi/git/aisuman198/dailyClaudeNews"
LOG_DIR="${HOME}/Library/Logs/dailyClaudeNews"
mkdir -p "${LOG_DIR}"

LOG_FILE="${LOG_DIR}/run.log"
ERR_FILE="${LOG_DIR}/run.error.log"

cd "${PROJECT_ROOT}" || {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] cd 失敗: ${PROJECT_ROOT}" >> "${ERR_FILE}"
  exit 1
}

# .env があれば読み込む（存在しなくてもエラーにしない）
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${PROJECT_ROOT}/.env"
  set +a
fi

# launchd は最小限の PATH しか持たないので明示する
export PATH="/Users/shuichi/.nodenv/shims:/Users/shuichi/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="ja_JP.UTF-8"
export LC_ALL="ja_JP.UTF-8"

# Claude CLI の認証情報を含むホームディレクトリの参照を保証
export HOME="/Users/shuichi"

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === dailyClaudeNews 起動 ==="
  node dist/index.js
  EXIT_CODE=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === 終了コード: ${EXIT_CODE} ==="
  exit "${EXIT_CODE}"
} >> "${LOG_FILE}" 2>> "${ERR_FILE}"

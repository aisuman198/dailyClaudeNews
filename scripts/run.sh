#!/bin/bash
# launchd から起動されるラッパースクリプト
# - プロジェクトディレクトリへ移動
# - .env を読み込み
# - PATH に node / claude / gh を追加
# - node dist/index.js を実行し、ログを ~/Library/Logs/dailyClaudeNews/ に出力
#
# ハードコードしない方針:
# - PROJECT_ROOT は本スクリプトの実体パスから導出
# - HOME は launchd（gui ドメイン）が user account から渡してくれる前提
#   念のため未設定なら起動失敗にする

set -u

: "${HOME:?HOME が未設定です。launchd が gui ドメインで起動していることを確認してください}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

# launchd は最小限の PATH しか持たないので明示する。
# nodenv / pyenv / homebrew のうち存在するものだけが利いて、無いパスは PATH 検索で
# 自然にスキップされる。Apple Silicon の Homebrew (/opt/homebrew) も含める。
export PATH="${HOME}/.nodenv/shims:${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="ja_JP.UTF-8"
export LC_ALL="ja_JP.UTF-8"

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === dailyClaudeNews 起動 ==="
  node dist/index.js
  EXIT_CODE=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === 終了コード: ${EXIT_CODE} ==="
  exit "${EXIT_CODE}"
} >> "${LOG_FILE}" 2>> "${ERR_FILE}"

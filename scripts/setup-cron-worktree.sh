#!/bin/bash
# cron 専用の git worktree をセットアップ / 同期する idempotent スクリプト。
#
# 開発用 repo と cron が同じ working tree を共有していると、開発作業中に
# ブランチを切り替えたまま戻し忘れた状態で cron が走り、生成物が feature ブランチに
# 乗ってしまう silent miss が複数回発生したため、cron 専用の worktree を分離する。
#
# 配置:
#   - 開発用 repo:   このスクリプトのある場所 (PROJECT_ROOT)
#   - cron worktree: ~/Library/Application Support/dailyClaudeNews/worktree
#   - cron 専用ブランチ: cron-runner (常に origin/main へ reset --hard される)
#
# 何回実行しても同じ最終状態に収束する設計:
#   - worktree が無ければ作る
#   - worktree が既にあれば fetch + reset --hard origin/main
#   - .env は開発用 repo のものを symlink で共有 (秘密値を複製しない)
#   - npm ci で node_modules を揃え、npm run build で dist/ を最新化

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${HOME:?HOME が未設定です (cron 環境では launchd 起動時に明示が必要)}"

WORKTREE_PATH="${HOME}/Library/Application Support/dailyClaudeNews/worktree"
WORKTREE_BRANCH="cron-runner"

echo "[setup-cron-worktree] PROJECT_ROOT=${PROJECT_ROOT}"
echo "[setup-cron-worktree] WORKTREE_PATH=${WORKTREE_PATH}"

mkdir -p "$(dirname "${WORKTREE_PATH}")"

cd "${PROJECT_ROOT}"
git fetch origin main

if [ -e "${WORKTREE_PATH}/.git" ]; then
  echo "[setup-cron-worktree] 既存 worktree を最新化"
  git -C "${WORKTREE_PATH}" fetch origin main
  git -C "${WORKTREE_PATH}" reset --hard origin/main
else
  echo "[setup-cron-worktree] worktree を新規作成"
  if git show-ref --verify --quiet "refs/heads/${WORKTREE_BRANCH}"; then
    # cron-runner ブランチは既に存在する (過去に作ったが worktree だけ消えた)
    git worktree add "${WORKTREE_PATH}" "${WORKTREE_BRANCH}"
    git -C "${WORKTREE_PATH}" reset --hard origin/main
  else
    git worktree add -b "${WORKTREE_BRANCH}" "${WORKTREE_PATH}" origin/main
  fi
fi

# .env は開発側 repo のものを symlink で共有する (worktree 側にコピーすると同期漏れの元)。
# 接続ロジックは run.sh からも毎回呼ぶため link-env.sh に一本化してある。
# この時点で開発側に .env が無くても異常ではない (後から作れば run.sh が接続する)。
"${PROJECT_ROOT}/scripts/link-env.sh" "${PROJECT_ROOT}" "${WORKTREE_PATH}" || true

echo "[setup-cron-worktree] npm ci (worktree)"
( cd "${WORKTREE_PATH}" && npm ci --silent --no-audit --no-fund )

echo "[setup-cron-worktree] npm run build (worktree)"
( cd "${WORKTREE_PATH}" && npm run build )

echo "[setup-cron-worktree] 完了"

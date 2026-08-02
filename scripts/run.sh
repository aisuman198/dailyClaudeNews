#!/bin/bash
# launchd から起動されるラッパースクリプト
#
# 設計:
#  - 開発側 working tree (PROJECT_ROOT) とは完全に分離した cron 専用 worktree で動く
#  - 毎回 origin/main へ reset --hard してクリーン状態から開始する
#    → 開発者が main 以外のブランチに切り替えたまま忘れていても影響ゼロ
#  - npm ci で依存を揃え、npm run build で dist/ を最新化
#  - .env は開発側 repo のものを worktree に symlink (秘密値を複製しない)

set -u

: "${HOME:?HOME が未設定です。launchd が gui ドメインで起動していることを確認してください}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_PATH="${HOME}/Library/Application Support/dailyClaudeNews/worktree"
LOG_DIR="${HOME}/Library/Logs/dailyClaudeNews"
mkdir -p "${LOG_DIR}"

LOG_FILE="${LOG_DIR}/run.log"
ERR_FILE="${LOG_DIR}/run.error.log"

# launchd は最小限の PATH しか持たないので明示する。
# nodenv / pyenv / homebrew のうち存在するものだけが利いて、無いパスは PATH 検索で
# 自然にスキップされる。Apple Silicon の Homebrew (/opt/homebrew) も含める。
export PATH="${HOME}/.nodenv/shims:${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="ja_JP.UTF-8"
export LC_ALL="ja_JP.UTF-8"

# worktree が無ければ自動で作る (初回 / 何らかの理由で消えた場合)
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

# 開発側で何していようと毎回 origin/main の状態から始める
{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === pre-run: fetch + reset to origin/main ==="
  git fetch origin main
  git reset --hard origin/main
  git clean -fd dist/ 2>/dev/null || true
  rm -f state/draft-*.md 2>/dev/null || true
  npm ci --silent --no-audit --no-fund
  npm run build
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === pre-run 完了 (HEAD: $(git rev-parse --short HEAD)) ==="
} >> "${LOG_FILE}" 2>> "${ERR_FILE}" || {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === pre-run 失敗 ===" >> "${ERR_FILE}"
  exit 1
}

# .env は開発側 repo のものを worktree へ symlink して共有する。
# worktree 作成後に .env を新規作成した場合、セットアップ時には symlink を張れていないため
# 毎回ここで接続状態を確認して張り直す。張られていないと全設定が既定値のまま実行され、
# Discord 通知などが「未設定」として黙ってスキップされる。
"${PROJECT_ROOT}/scripts/link-env.sh" "${PROJECT_ROOT}" "${WORKTREE_PATH}" \
  >> "${LOG_FILE}" 2>> "${ERR_FILE}" || true

if [ -f "${WORKTREE_PATH}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${WORKTREE_PATH}/.env"
  set +a
else
  # 致命的ではない (既定値で動く) が、意図しない設定で走り続けるのを防ぐため必ず記録する。
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] 警告: .env を読み込めませんでした。全設定を既定値で実行します" \
    | tee -a "${ERR_FILE}" >> "${LOG_FILE}"
fi

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === dailyClaudeNews 起動 (worktree: ${WORKTREE_PATH}) ==="
  node dist/index.js
  EXIT_CODE=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] === 終了コード: ${EXIT_CODE} ==="
  exit "${EXIT_CODE}"
} >> "${LOG_FILE}" 2>> "${ERR_FILE}"

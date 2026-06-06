#!/bin/bash
# マージ済みローカルブランチの自動 cleanup
#
# - gh CLI で自分が author の merged PR を直近 14 日分取得
# - 各 head ブランチについて、ローカルに同名ブランチがあり origin/main に
#   取り込み済 (merge-base --is-ancestor が真) なら削除する
# - 削除後に `git worktree prune` と `git remote prune origin` を実行
# - 現在 checkout 中のブランチ・main は対象外 (安全のため main 自動 pull もしない)
# - launchd から定期実行されることを想定 (詳細は launchd/*.cleanup.plist.template)
#
# 使い方:
#   ./scripts/cleanup-merged.sh             # ログを表示しつつ実行
#   ./scripts/cleanup-merged.sh --dry-run   # 削除予定だけ表示

set -u

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}" || exit 1

# launchd 環境では PATH が最小限なので Homebrew / nodenv を明示
export PATH="${HOME}/.nodenv/shims:${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if ! command -v gh >/dev/null 2>&1; then
  echo "[cleanup-merged] gh CLI が見つかりません" >&2
  exit 1
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [cleanup-merged] $*"
}

# 直近 14 日以内に merged された自分の PR の head ブランチ名を取得
# (頻度低いポーリングでも取りこぼさないようマージンを取る)
SINCE_EPOCH=$(($(date +%s) - 14 * 86400))
SINCE_ISO=$(date -u -r "${SINCE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@${SINCE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)

MERGED_JSON=$(gh pr list \
  --author "@me" \
  --state merged \
  --limit 50 \
  --json headRefName,mergedAt,number 2>/dev/null || echo '[]')

# jq でフィルタ (since 以降にマージされたもの)
if ! command -v jq >/dev/null 2>&1; then
  echo "[cleanup-merged] jq が見つかりません" >&2
  exit 1
fi

MERGED_BRANCHES=$(echo "${MERGED_JSON}" \
  | jq -r --arg since "${SINCE_ISO}" \
      '.[] | select(.mergedAt > $since) | "\(.number)\t\(.headRefName)"')

if [ -z "${MERGED_BRANCHES}" ]; then
  log "対象なし (直近 14 日以内に merged な自分の PR が無い)"
  exit 0
fi

# fetch しないと origin/main が古く、is-ancestor 判定が誤る可能性がある
git fetch --quiet origin main 2>/dev/null || true

CURRENT_BRANCH=$(git symbolic-ref --short -q HEAD || echo '')

CLEANED=0
SKIPPED=0
while IFS=$'\t' read -r pr_num branch; do
  [ -z "${branch}" ] && continue

  # main は触らない
  if [ "${branch}" = "main" ]; then
    continue
  fi

  # ローカルに同名ブランチが無ければスキップ
  if ! git show-ref --verify --quiet "refs/heads/${branch}"; then
    continue
  fi

  # 現在 checkout 中のブランチは消せない (HEAD が浮く)
  if [ "${CURRENT_BRANCH}" = "${branch}" ]; then
    log "PR #${pr_num} (${branch}): 現在 checkout 中のため skip"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # origin/main に取り込み済か確認 (force-delete を安全に行うための保証)
  if ! git merge-base --is-ancestor "${branch}" origin/main 2>/dev/null; then
    log "PR #${pr_num} (${branch}): origin/main に未取り込みのため skip (手動確認が必要)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "${DRY_RUN}" = "1" ]; then
    log "PR #${pr_num} (${branch}): [dry-run] 削除対象"
    continue
  fi

  if git branch -D "${branch}" >/dev/null 2>&1; then
    log "PR #${pr_num} (${branch}): 削除"
    CLEANED=$((CLEANED + 1))
  else
    log "PR #${pr_num} (${branch}): 削除失敗" >&2
  fi
done <<< "${MERGED_BRANCHES}"

# stale な worktree 参照を掃除 (worktree ディレクトリ実体は触らない)
git worktree prune
# origin で削除済の remote-tracking branch も掃除
git remote prune origin >/dev/null 2>&1 || true

log "完了 (削除 ${CLEANED} / skip ${SKIPPED})"

#!/bin/bash
# 開発用 repo の .env を cron worktree へ symlink で接続する idempotent スクリプト。
#
# なぜ独立したスクリプトなのか:
#   worktree の作成時 (setup-cron-worktree.sh) にしか symlink を張っていなかったため、
#   「worktree を作った後に .env を新規作成した」ケースで symlink が永久に張られず、
#   cron が全設定を既定値のまま実行する silent miss が発生した (Discord 通知が
#   Webhook URL 未設定として黙ってスキップされていた)。
#   毎回の実行 (run.sh) と worktree セットアップの双方から呼べるよう切り出してある。
#
# 使い方:
#   link-env.sh <PROJECT_ROOT> <WORKTREE_PATH>
#
# 終了コード:
#   0 = worktree 側に .env が存在する (接続済み or 元から存在)
#   1 = 開発側に .env が無く接続できなかった
#   2 = 引数不正

set -u

# 空文字を通すと DEST が "/.env" のようなルート直下を指してしまうため、個数と中身の両方を検査する。
if [ "$#" -ne 2 ] || [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
  echo "[link-env] 使い方: $(basename "$0") <PROJECT_ROOT> <WORKTREE_PATH>" >&2
  exit 2
fi

SRC="$1/.env"
DEST="$2/.env"

# リンク先が消えた壊れた symlink は張り直す。
# 放置すると -e が false のまま ln も失敗し続け、接続不能な状態が固定化する。
if [ -L "${DEST}" ] && [ ! -e "${DEST}" ]; then
  rm -f "${DEST}"
  echo "[link-env] 壊れた symlink を除去: ${DEST}"
fi

# 既に接続済み、または worktree 側に実体の .env が置かれている場合は触らない。
if [ -e "${DEST}" ]; then
  exit 0
fi

if [ ! -f "${SRC}" ]; then
  echo "[link-env] 開発側に .env がありません: ${SRC}" >&2
  exit 1
fi

ln -s "${SRC}" "${DEST}" || {
  echo "[link-env] symlink の作成に失敗: ${DEST} -> ${SRC}" >&2
  exit 1
}
echo "[link-env] .env を symlink で接続: ${DEST} -> ${SRC}"

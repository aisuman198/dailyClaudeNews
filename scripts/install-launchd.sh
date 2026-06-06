#!/bin/bash
# launchd plist のインストーラ
#
# - launchd/*.plist.template のプレースホルダ {{HOME}} / {{PROJECT_ROOT}} を
#   実環境の絶対パスに置換し、~/Library/LaunchAgents/ にレンダリングする。
# - 同 Label が既に bootstrap 済みの場合は一旦 bootout してから再 bootstrap する。
# - 生成された .plist には各人の HOME / PROJECT_ROOT が含まれるため版管理対象外
#   (launchd/*.plist は .gitignore)。
#
# 使い方:
#   ./scripts/install-launchd.sh

set -euo pipefail

: "${HOME:?HOME が未設定です}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="${PROJECT_ROOT}/launchd"
TARGET_DIR="${HOME}/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

mkdir -p "${TARGET_DIR}"

# cron 専用 worktree を先に bootstrap しておく (run.sh も初回 fallback で呼ぶが、
# install 時点で揃えておけば初回 cron 実行が高速・確実になる)
echo "[install-launchd] cron 専用 worktree をセットアップ"
"${PROJECT_ROOT}/scripts/setup-cron-worktree.sh"
echo

shopt -s nullglob
templates=("${TEMPLATE_DIR}"/*.plist.template)
if [ ${#templates[@]} -eq 0 ]; then
  echo "[install-launchd] テンプレートが見つかりません: ${TEMPLATE_DIR}/*.plist.template" >&2
  exit 1
fi

# sed の区切り文字に | を使うので、HOME や PROJECT_ROOT に | が含まれないことだけ防御
case "${HOME}${PROJECT_ROOT}" in
  *"|"*)
    echo "[install-launchd] HOME / PROJECT_ROOT に '|' が含まれています。sed の区切り文字と衝突します。" >&2
    exit 1
    ;;
esac

for tpl in "${templates[@]}"; do
  base="$(basename "${tpl}" .template)"   # .plist.template → .plist
  target="${TARGET_DIR}/${base}"
  label="$(basename "${target}" .plist)"

  echo "[install-launchd] レンダリング: $(basename "${tpl}")"
  # 既存ターゲットが symlink だとシェルの `>` リダイレクトがリンク先 (repo 内など)
  # へ書き込んでしまい個人パス入りファイルが repo に作られる。先に必ず削除し、
  # 実体ファイルとして作成する。
  rm -f "${target}"
  sed -e "s|{{HOME}}|${HOME}|g" \
      -e "s|{{PROJECT_ROOT}}|${PROJECT_ROOT}|g" \
      "${tpl}" > "${target}"
  echo "                 → ${target}"

  if launchctl print "${DOMAIN}/${label}" >/dev/null 2>&1; then
    echo "[install-launchd] ${label} は既に bootstrap 済 → 再 bootstrap"
    launchctl bootout "${DOMAIN}/${label}" 2>/dev/null || true
  fi
  launchctl bootstrap "${DOMAIN}" "${target}"
  echo "[install-launchd] ${label} bootstrap 完了"
done

echo
echo "[install-launchd] すべて完了。状態確認:"
echo "  launchctl list | grep -i dailyclaudenews"

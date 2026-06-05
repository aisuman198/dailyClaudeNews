# dailyClaudeNews

Mac launchd で毎朝 9:00 JST に起動し、Anthropic 公式サイトと Hacker News から AI 業界ニュースを取得して、Claude Code CLI（Max サブスクリプション）で日本語にまとめ、`docs/daily/YYYY-MM-DD.md` として GitHub にコミットする自動化システム。

## セットアップ

### 1. 前提

- macOS（Apple Silicon / Intel どちらも可）
- Node.js 20+
- Claude Code CLI（Max プランで認証済み）
- `gh` CLI（OAuth 認証済み、`repo` スコープ）
- リポジトリへの SSH push 権限

### 2. 依存インストール

```bash
npm install
npm run build
```

### 3. 環境変数

`.env.example` をコピーして `.env` を作成し、必要に応じて値を調整する。

```bash
cp .env.example .env
```

主な調整ポイント:

| 変数 | 用途 |
|------|------|
| `CLAUDE_MODEL` | 主モデル |
| `REVIEWER_MODEL` | レビュー担当モデル |
| `REVIEW_ENABLED` | レビューフェーズを有効にするか（デフォルト `true`） |
| `CLAUDE_TIMEOUT_MS` | summarize / review の各 CLI タイムアウト（デフォルト 20分） |
| `HN_KEYWORDS` | HN から拾うキーワード（カンマ区切り） |
| `HISTORY_RETENTION_DAYS` | 継続話題として参照する日数（デフォルト 14） |
| `DEDUP_TITLE_SIMILARITY` | 同run内重複判定の閾値（0.0〜1.0、デフォルト 0.85） |
| `MACOS_NOTIFICATION` | 失敗時に macOS 通知を出すか（true/false） |
| `SKIP_GIT_PUSH` | true なら git commit/push をスキップ（dry-run 用） |
| `SAVE_DRAFT` | true なら summarize 直後の draft を `state/draft-YYYY-MM-DD.md` に保存（debug 用、git 管理対象外） |
| `E2E_MAX_ARTICLES` | 1以上なら新規＋継続の合計件数をその数に絞る（E2E 動作確認用） |
| `VERIFY_DEPLOYMENT_ENABLED` | push 後に GitHub Pages 上で本日記事の公開を確認するか（デフォルト `true`） |
| `PAGES_BASE_URL` | 公開確認に使う Pages の URL（デフォルト `https://aisuman198.github.io/dailyClaudeNews`） |
| `VERIFY_DEPLOYMENT_INITIAL_DELAY_MS` | push 後の初期待機（デフォルト 60_000） |
| `VERIFY_DEPLOYMENT_INTERVAL_MS` | ポーリング間隔（デフォルト 30_000） |
| `VERIFY_DEPLOYMENT_TIMEOUT_MS` | 公開確認の最大待機時間（デフォルト 600_000 = 10 分） |

### 4. 手動で動作確認

本番設定で実行:
```bash
node dist/index.js
```

**E2E 動作確認** — 少件数・git push 無し（数分で完了）:
```bash
SKIP_GIT_PUSH=true SAVE_DRAFT=true E2E_MAX_ARTICLES=2 node dist/index.js
```

`docs/daily/YYYY-MM-DD.md` が生成され、`state/seen.json` と `state/cautions.json` が更新される。

### 5. launchd への登録

`launchd/` 配下の plist を `~/Library/LaunchAgents/` にシンボリックリンクで配置し、`launchctl bootstrap` で有効化する。plist 内の `Label` / `ProgramArguments` / 各種パスは自身の環境に合わせて事前に書き換えること。

```bash
# シンボリックリンクを LaunchAgents に張る + bootstrap
for plist in launchd/*.plist; do
  ln -sf "$(pwd)/$plist" "$HOME/Library/LaunchAgents/$(basename "$plist")"
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$(basename "$plist")"
done

# 状態確認
launchctl list | grep -i dailyclaudenews
```

アンロード:
```bash
for plist in "$HOME"/Library/LaunchAgents/*dailyClaudeNews*.plist; do
  launchctl bootout "gui/$(id -u)/$(basename "$plist" .plist)"
done
```

## ログ

| ログ | パス |
|------|------|
| メインアプリ標準出力 | `~/Library/Logs/dailyClaudeNews/run.log` |
| メインアプリ標準エラー | `~/Library/Logs/dailyClaudeNews/run.error.log` |
| Retrospect 標準出力 | `~/Library/Logs/dailyClaudeNews/retrospect.log` |
| Retrospect 標準エラー | `~/Library/Logs/dailyClaudeNews/retrospect.error.log` |
| launchd（メイン） | `~/Library/Logs/dailyClaudeNews/launchd.{out,err}.log` |
| launchd（retrospect） | `~/Library/Logs/dailyClaudeNews/launchd.retrospect.{out,err}.log` |

## トラブルシュート

| 症状 | 確認事項 |
|------|----------|
| 起動しない | `launchctl list \| grep -i dailyclaudenews` で登録確認 |
| `claude: command not found` | `scripts/run.sh` の `PATH` を確認。`which claude` のパスを反映 |
| `claude` が API キーを要求 | Max 認証が切れている。`claude auth status` で確認、必要なら `claude` を一度対話起動して再認証 |
| `git push` 失敗 | SSH 鍵の登録、`gh auth status`、リモートが進んでいないか確認 |
| Anthropic ソースが 0 件 | sitemap の構造変更の可能性。`curl -s $ANTHROPIC_SITEMAP \| head` で確認 |
| HN フィルタが多すぎ/少なすぎ | `HN_KEYWORDS` を調整（カンマ区切り、単語境界一致） |
| Max の 5h 上限到達 | `state/seen.json` を温存したまま翌日リトライ。GitHub Issue が起票されているはず |

## ライセンス

Private（個人運用）

# dailyClaudeNews

Mac launchd で毎朝 8:00 JST に起動し、Anthropic 公式サイトと Hacker News から AI 業界ニュースを取得して、Claude Code CLI（Max サブスクリプション）で日本語にまとめ、`docs/daily/YYYY-MM-DD.md` として GitHub にコミットする自動化システム。

## セットアップ

### 1. 前提

- macOS（Apple Silicon / Intel どちらも可）
- Node.js 24+（`.node-version` は 24.18.0 を指定）
- Claude Code CLI（Max プランで認証済み）
- `gh` CLI（OAuth 認証済み、`repo` スコープ — PR 作成・マージで必須）
- リポジトリへの SSH push 権限（daily ブランチへの push のみで OK）
- リポジトリの **admin 権限**（PR squash merge を毎朝実行するため。
  main の ruleset が「PR 必須・必須 review 1+」の場合は `gh pr merge --admin` でのバイパスを行う）

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
| `ARTICLE_BODY_MAX_CHARS` | 1記事あたりの本文取得上限（デフォルト 20_000 文字）。超えた分は文の区切りまで戻して切り、打ち切り注記を付ける |
| `SUMMARIZE_BODY_BUDGET_CHARS` | summarize プロンプトに載せる本文の合計上限（デフォルト 150_000 文字）。超過時は長い記事だけを削る |
| `HN_KEYWORDS` | HN から拾うキーワード（カンマ区切り） |
| `HISTORY_RETENTION_DAYS` | 継続話題として参照する日数（デフォルト 14） |
| `DEDUP_TITLE_SIMILARITY` | 同run内重複判定の閾値（0.0〜1.0、デフォルト 0.85） |
| `MACOS_NOTIFICATION` | 失敗時に macOS 通知を出すか（true/false） |
| `DISCORD_NOTIFICATION` | Discord への投稿全体の ON/OFF（デフォルト `true`） |
| `DISCORD_ERROR_WEBHOOK_URL` | **失敗時**に「エラーが出た旨 + GitHub issue のリンク」を投稿する Webhook |
| `DISCORD_NEWS_WEBHOOK_URL` | **成功時**に「公開した記事の URL」を投稿する Webhook（エラーとは別チャンネル） |
| `DISCORD_TIMEOUT_MS` | Webhook 送信のタイムアウト（デフォルト 15_000） |
| `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` | 自動コミット時の Author（`.env.example` のプレースホルダを自分の値に置き換える。省略時は git config のグローバル値） |
| `SKIP_GIT_PUSH` | true なら git commit/push をスキップ（dry-run 用） |
| `SAVE_DRAFT` | true なら summarize 直後の draft を `state/draft-YYYY-MM-DD.md` に保存（debug 用、git 管理対象外） |
| `E2E_MAX_ARTICLES` | 1以上なら新規＋継続の合計件数をその数に絞る（E2E 動作確認用） |
| `VERIFY_DEPLOYMENT_ENABLED` | push 後に GitHub Pages 上で本日記事の公開を確認するか（デフォルト `true`） |
| `PAGES_BASE_URL` | 公開確認に使う Pages の URL（デフォルト `https://aisuman198.github.io/dailyClaudeNews`） |
| `VERIFY_DEPLOYMENT_INITIAL_DELAY_MS` | push 後の初期待機（デフォルト 60_000） |
| `VERIFY_DEPLOYMENT_INTERVAL_MS` | ポーリング間隔（デフォルト 30_000） |
| `VERIFY_DEPLOYMENT_TIMEOUT_MS` | 公開確認の最大待機時間（デフォルト 600_000 = 10 分） |

### 4. Git hooks (任意・推奨)

`npm install` 時に `prepare` スクリプトが `git config core.hooksPath scripts/hooks` を自動設定する。これにより `scripts/hooks/` 配下の hook (現在は `post-merge` のみ) が有効になる。

- **post-merge**: `git pull` で main に新しいマージコミットが入ったタイミングで、main にマージ済みのローカル feature ブランチを自動削除し、`git worktree prune` / `git remote prune origin` を実行する。`main` / `cron-runner` / 未マージの作業ブランチは常に対象外。

確認:
```bash
git config --get core.hooksPath
# → scripts/hooks
```

### 5. 手動で動作確認

本番設定で実行:
```bash
node dist/index.js
```

**E2E 動作確認** — 少件数・git push 無し（数分で完了）:
```bash
SKIP_GIT_PUSH=true SAVE_DRAFT=true E2E_MAX_ARTICLES=2 node dist/index.js
```

`docs/daily/YYYY-MM-DD.md` が生成され、`state/seen.json` と `state/cautions.json` が更新される。

### 6. launchd への登録

`launchd/*.plist.template` のプレースホルダ (`{{HOME}}` / `{{PROJECT_ROOT}}`) を実環境の絶対パスに置換して `~/Library/LaunchAgents/` に配置し、`launchctl bootstrap` するインストーラを用意してある。テンプレ方式により個人パスを版管理に含めない。同時に **cron 専用 git worktree** も自動的にセットアップされる。

```bash
./scripts/install-launchd.sh

# 状態確認
launchctl list | grep -i dailyclaudenews
```

アンインストール (worktree は残す):
```bash
./scripts/uninstall-launchd.sh
# cron 専用 worktree も含めて完全に消す場合:
./scripts/uninstall-launchd.sh --purge-worktree
```

#### cron 専用 worktree の仕組み

開発用 working tree (`PROJECT_ROOT`) と cron が同じディレクトリを共有していると、開発作業中に main 以外のブランチに切り替えたまま忘れた状態で cron が走り、生成物が feature ブランチに乗ってしまう silent miss が発生しうる (実際に 2026-06-05 / 06 に観測)。これを構造的に防ぐため、cron は **専用の git worktree** で動く。

```
PROJECT_ROOT                                            # 開発用 (自由に branch / 編集 OK)
~/Library/Application Support/dailyClaudeNews/worktree  # cron 専用 (ブランチ: cron-runner)
```

cron は毎回起動時に worktree で:

1. `git fetch origin main`
2. `git reset --hard origin/main` (開発側で何していようと完全クリーン)
3. `npm ci && npm run build`
4. `node dist/index.js`

を実行する。worktree が存在しなければ `scripts/setup-cron-worktree.sh` が自動で作成する。`.env` は開発用 repo のものを worktree に symlink するため、秘密値は複製されない。

symlink の接続は `scripts/link-env.sh` が担当し、worktree セットアップ時だけでなく **毎回の実行前にも** 呼ばれる。worktree を作った後に `.env` を新規作成した場合でも次回実行時に自動で接続されるため、`.env` が読まれないまま全設定が既定値で走る事故は起きない。それでも `.env` を読めなかった場合は `run.error.log` に警告を残す。

#### main 保護下での PR 経由 push

main の ruleset により直接 push が禁じられているため、`commitAndPush`
(`src/git.ts`) は **daily ブランチ + PR + auto-merge** で更新を反映する:

1. cron-runner で commit
2. `git push origin HEAD:refs/heads/daily/YYYY-MM-DD` — 通常は plain push。
   同日 retry で残骸ブランチがあれば `--force` でフォールバック (daily ブランチは
   cron 専有なので上書きしてよい)。`--force-with-lease` は使わない: 直前の merge で
   remote 側が消えた直後の再 push が "stale info" で拒否されるため。
3. open PR があれば再利用、無ければ `gh pr create --base main --head daily/...`
4. `gh pr merge <#> --squash --delete-branch` — 失敗時は `--admin` で再試行
   (`viewerPermission=ADMIN` 前提)

PR は squash merge され、daily ブランチは自動削除される。次回起動時の
`git reset --hard origin/main` でローカルは origin/main に同期される。

## Discord 通知

定期実行の結果を Discord に投稿する。**エラー通知と記事共有は別チャンネル**（別 Webhook URL）。

| タイミング | 投稿先 | 内容 |
|-----------|--------|------|
| 失敗時 | `DISCORD_ERROR_WEBHOOK_URL` | エラーが発生した旨・失敗フェーズ・カテゴリ・エラーメッセージ + **GitHub issue のリンク** |
| 成功時 | `DISCORD_NEWS_WEBHOOK_URL` | 公開した記事の URL（`PAGES_BASE_URL/daily/YYYY-MM-DD.html`）と新規/継続の件数 |

- 失敗通知のリンク先は notifier が起票（または再発コメント）した issue。同じ失敗が続く場合は
  既存 issue にコメントが付き、通知には**その既存 issue の URL**が載る。issue 起票自体に失敗した
  場合も「起票できませんでした」と明記して通知だけは飛ばす。
- 成功通知は `verify-deploy`（GitHub Pages 上での公開確認）の後に投稿するので、リンクは必ず踏める。
  `SKIP_GIT_PUSH=true` の dry-run ではスキップされる。
- **Discord への投稿失敗で実行全体を失敗扱いにはしない。** 記事の公開自体は成功しているのに
  通知失敗で終了コード 1 → 誤検知の error issue、という事故を防ぐため。結果は run.log に残る。
- Webhook URL 未設定 / `DISCORD_NOTIFICATION=false` なら投稿はスキップされる（他の動作は変わらない）。

Webhook は Discord のチャンネル設定 → 連携サービス → ウェブフック から発行し、`.env` に置く
（URL は秘密情報。コミットしないこと）。

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

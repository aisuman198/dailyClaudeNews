# dailyClaudeNews

Mac launchd で毎朝 9:00 JST に起動し、Anthropic 公式サイトと Hacker News から AI 業界ニュースを取得して、Claude Code CLI（Max サブスクリプション）で日本語にまとめ、`docs/daily/YYYY-MM-DD.md` として GitHub にコミットする自動化システム。

## 構成

```
launchd (毎朝 9:00 JST)
  → scripts/run.sh
    → node dist/index.js
      → fetcher          (Anthropic sitemap + HN API)
      → deduper          (URL正規化 + 3-gram Jaccard)
      → historyFilter    (state/seen.json と照合)
      → articleFetcher   (各記事を並列 fetch → 本文抽出)
      → summarizer       (claude -p, 既知の cautions.json も参照)
      → reviewer         (別人格の claude -p で推敲、構造変更禁止)
      → writer           (docs/daily/YYYY-MM-DD.md)
      → cautionStore     (新規発見した固有名詞ルール等を state/cautions.json に追加)
      → git commit & push
```

詳細は [docs/design/architecture.md](docs/design/architecture.md) を参照。

## セットアップ

### 1. 前提

- macOS（Apple Silicon / Intel どちらも可）
- Node.js 20+（`nodenv` 等で管理）
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
| `CLAUDE_MODEL` | 主モデル（デフォルト `claude-sonnet-4-6`） |
| `REVIEWER_MODEL` | レビュー担当モデル（デフォルト `claude-sonnet-4-6`） |
| `REVIEW_ENABLED` | レビューフェーズを有効にするか（デフォルト `true`） |
| `CLAUDE_TIMEOUT_MS` | summarize / review の各 CLI タイムアウト（デフォルト 20分） |
| `HN_KEYWORDS` | HN から拾うキーワード（カンマ区切り） |
| `HISTORY_RETENTION_DAYS` | 継続話題として参照する日数（デフォルト 14） |
| `DEDUP_TITLE_SIMILARITY` | 同run内重複判定の閾値（0.0〜1.0、デフォルト 0.85） |
| `MACOS_NOTIFICATION` | 失敗時に macOS 通知を出すか（true/false） |
| `SKIP_GIT_PUSH` | true なら git commit/push をスキップ（dry-run 用） |
| `SAVE_DRAFT` | true なら summarize 直後の draft を `state/draft-YYYY-MM-DD.md` に保存（debug 用、git 管理対象外） |
| `E2E_MAX_ARTICLES` | 1以上なら新規＋継続の合計件数をその数に絞る（E2E 動作確認用） |

### 4. 手動で動作確認

本番設定で実行（24件＋reviewで約20分・Max を 2セッション消費）:
```bash
node dist/index.js
```

**E2E 動作確認** — 2 件だけ・git push 無し（数分で完了）:
```bash
SKIP_GIT_PUSH=true SAVE_DRAFT=true E2E_MAX_ARTICLES=2 node dist/index.js
```

`docs/daily/YYYY-MM-DD.md` が生成され、`state/seen.json` と `state/cautions.json` が更新される。

### 5. launchd への登録

2つのジョブを登録する:
- **9:00 JST**: ニュースまとめ生成 (`com.aisuman198.dailyClaudeNews`)
- **10:00 JST**: その日の Issue を振り返り、新規パターンには draft PR を作成 (`com.aisuman198.dailyClaudeNews-retrospect`)

```bash
# シンボリックリンクを LaunchAgents に張る
ln -sf "$(pwd)/launchd/com.aisuman198.dailyClaudeNews.plist" \
       ~/Library/LaunchAgents/com.aisuman198.dailyClaudeNews.plist
ln -sf "$(pwd)/launchd/com.aisuman198.dailyClaudeNews-retrospect.plist" \
       ~/Library/LaunchAgents/com.aisuman198.dailyClaudeNews-retrospect.plist

# bootstrap
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.aisuman198.dailyClaudeNews.plist
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.aisuman198.dailyClaudeNews-retrospect.plist

# 状態確認
launchctl list | grep dailyClaudeNews

# 即時起動して試す
launchctl start com.aisuman198.dailyClaudeNews
launchctl start com.aisuman198.dailyClaudeNews-retrospect
```

アンロード:
```bash
launchctl bootout "gui/$(id -u)/com.aisuman198.dailyClaudeNews"
launchctl bootout "gui/$(id -u)/com.aisuman198.dailyClaudeNews-retrospect"
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

## Issue / PR 自動運用

| 種別 | 起票タイミング | 内容 |
|------|--------------|------|
| Issue（失敗時） | 9:00 のメインジョブ失敗時 | `notifier` がエラーをカテゴリ分類（timeout / fetch / git / rate-limit / unknown）し、**同タイトルの open issue があれば「再発」コメントを追加、無ければ新規起票**。タイムアウトは `[dailyClaudeNews] timeout: <phase>` で統一されるので何度発生しても 1 件に集約される |
| Draft PR（10:00 振り返り） | 当日に作成された Issue が過去にパターンが無く、かつ修正対象（timeout/rate-limit 以外）の場合 | `retrospect` がワークツリーを使い `auto/retrospect-<date>-issue-<N>` ブランチを切って空コミットを置き、Issue 内容を本文にコピーした **draft PR を自動作成**。macOS 通知でユーザーに伝える |

## トラブルシュート

| 症状 | 確認事項 |
|------|----------|
| 起動しない | `launchctl list \| grep dailyClaudeNews` で登録確認、`launchctl print gui/$(id -u)/com.aisuman198.dailyClaudeNews` で詳細 |
| `claude: command not found` | `scripts/run.sh` の `PATH` を確認。`which claude` のパスを反映 |
| `claude` が API キーを要求 | Max 認証が切れている。`claude auth status` で確認、必要なら `claude` を一度対話起動して再認証 |
| `git push` 失敗 | SSH 鍵の登録、`gh auth status`、リモートが進んでいないか確認 |
| Anthropic ソースが 0 件 | sitemap の構造変更の可能性。`curl -s $ANTHROPIC_SITEMAP \| head` で確認 |
| HN フィルタが多すぎ/少なすぎ | `HN_KEYWORDS` を調整（カンマ区切り、単語境界一致） |
| Max の 5h 上限到達 | `state/seen.json` を温存したまま翌日リトライ。GitHub Issue が起票されているはず |

## テスト

```bash
npm test           # vitest を 1 回実行
npm run test:watch # ウォッチモード
```

`fetcher`（ネットワーク）、`summarizer`（CLI 子プロセス）、`notifier`（外部コマンド）、`git` 操作はテスト対象外。`deduper` / `historyFilter` / `writer` / `summarizer.buildPrompt` をユニットテストでカバー。

## 既知の仕様

- **Anthropic 公式 RSS は提供されていない**ため、sitemap.xml から `/news/` `/research/` `/engineering/` 配下の URL を `lastmod` で抽出している。タイトルは URL slug を整形した暫定値。
- **Mac がシャットダウン/スリープ中は launchd の cron 起動が発火しない**（StartCalendarInterval は復帰なし）。確実に動かしたい場合は `pmset` で起動スケジュールを併用するか、別途クラウド実行を検討する。
- **Claude Code Max の 5 時間ローリング上限**を超えた場合、当日の実行は失敗し GitHub Issue が起票される。翌日再試行で復旧する。
- **記事本文取得**は Node 側で並列実行（max 8 並列、各 12 秒タイムアウト、HTML 限定、上限 3,500 文字）。fetch 失敗した記事は要約に「（本文取得失敗）」と明示される。
- **推敲レビュー** は別人格の `claude -p` 呼び出しで実施される。観点は (1)不自然な日本語、(2)英語タイトルの訳、(3)固有名詞の翻訳ミス。発見した注意事項は `state/cautions.json` に蓄積され、翌日以降の summarize と review にフィードバックされる。
- **本番1日あたりの Claude 使用量**: summarize ~12分・review ~6分。Max の 5 時間枠で十分カバーされる。

## ライセンス

Private（個人運用）

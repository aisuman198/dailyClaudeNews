# dailyClaudeNews

Mac launchd で毎朝 9:00 JST に起動し、Anthropic 公式サイトと Hacker News から AI 業界ニュースを取得して、Claude Code CLI（Max サブスクリプション）で日本語にまとめ、`docs/daily/YYYY-MM-DD.md` として GitHub にコミットする自動化システム。

## 構成

```
launchd (毎朝 9:00 JST)
  → scripts/run.sh
    → node dist/index.js
      → fetcher (Anthropic sitemap + HN API)
      → deduper (URL正規化 + タイトル類似度)
      → historyFilter (state/seen.json と照合)
      → summarizer (claude -p)
      → writer (docs/daily/YYYY-MM-DD.md)
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
| `HN_KEYWORDS` | HN から拾うキーワード（カンマ区切り） |
| `HISTORY_RETENTION_DAYS` | 継続話題として参照する日数（デフォルト 14） |
| `DEDUP_TITLE_SIMILARITY` | 同run内重複判定の閾値（0.0〜1.0、デフォルト 0.85） |
| `MACOS_NOTIFICATION` | 失敗時に macOS 通知を出すか（true/false） |

### 4. 手動で動作確認

```bash
npm run dev        # tsx で src/index.ts を直接実行
# または
node dist/index.js
```

`docs/daily/YYYY-MM-DD.md` が生成され、`state/seen.json` が更新され、`git push` まで実行される。

### 5. launchd への登録

```bash
# plist を LaunchAgents にシンボリックリンク
ln -sf "$(pwd)/launchd/com.aisuman198.dailyClaudeNews.plist" \
       ~/Library/LaunchAgents/com.aisuman198.dailyClaudeNews.plist

# ロード（次回 9:00 JST から自動起動）
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.aisuman198.dailyClaudeNews.plist

# 状態確認
launchctl list | grep dailyClaudeNews

# 即時起動して試す
launchctl start com.aisuman198.dailyClaudeNews
```

アンロード:
```bash
launchctl bootout "gui/$(id -u)/com.aisuman198.dailyClaudeNews"
```

## ログ

| ログ | パス |
|------|------|
| アプリ標準出力 | `~/Library/Logs/dailyClaudeNews/run.log` |
| アプリ標準エラー | `~/Library/Logs/dailyClaudeNews/run.error.log` |
| launchd 標準出力 | `~/Library/Logs/dailyClaudeNews/launchd.out.log` |
| launchd 標準エラー | `~/Library/Logs/dailyClaudeNews/launchd.err.log` |

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

- **Anthropic 公式 RSS は提供されていない**ため、sitemap.xml から `/news/` `/research/` `/engineering/` 配下の URL を `lastmod` で抽出している。タイトルは URL slug を整形した暫定値。より正確なタイトルが欲しい場合は各記事ページを fetch して `<title>` を読む実装に差し替える。
- **Mac がシャットダウン/スリープ中は launchd の cron 起動が発火しない**（StartCalendarInterval は復帰なし）。確実に動かしたい場合は `pmset` で起動スケジュールを併用するか、別途クラウド実行を検討する。
- **Claude Code Max の 5 時間ローリング上限**を超えた場合、当日の実行は失敗し GitHub Issue が起票される。翌日再試行で復旧する。

## ライセンス

Private（個人運用）

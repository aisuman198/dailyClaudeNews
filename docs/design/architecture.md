# T005: アーキテクチャ設計

**作成日**: 2026-06-01
**対象**: dailyClaudeNews v0.1
**前提**: [Claude CLI ヘッドレス仕様調査](./claude-cli-headless-spec.md)

---

## 1. システム全体図

```
┌────────────────────────────────────────────────────────────────────┐
│ macOS launchd                                                      │
│  ~/Library/LaunchAgents/com.aisuman198.dailyClaudeNews.plist       │
│  StartCalendarInterval: { Hour: 9, Minute: 0 }                     │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ scripts/run.sh   (シェルラッパー)                                   │
│  ├─ cd <project root>                                              │
│  ├─ source .env                                                    │
│  ├─ PATH に Node.js / claude を追加                                 │
│  ├─ exec node dist/index.js                                        │
│  └─ stdout/stderr を ~/Library/Logs/dailyClaudeNews/ にリダイレクト │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Node.js: src/index.ts   (orchestrator)                             │
│                                                                    │
│  1. fetcher.fetchAll()         → NewsItem[]                        │
│  2. summarizer.summarize(items) → Markdown string                  │
│  3. writer.write(md, date)     → ファイルパス                       │
│  4. git add / commit / push                                        │
│  ─ 失敗時 ─                                                         │
│  5. notifier.notifyFailure(err)  → GitHub Issue + macOS 通知       │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. モジュール設計

### 2.1 `src/types.ts`

共通型定義。

```ts
export type NewsItem = {
  source: 'anthropic-blog' | 'hacker-news'
  title: string
  url: string
  publishedAt: Date
  summary?: string  // RSS の description 等、ある場合
  score?: number    // HN のスコア
}

export type SummarizeResult = {
  markdown: string
  modelUsed: string
}
```

### 2.2 `src/fetcher.ts`

責務: ニュース取得。複数ソースを並列フェッチし `NewsItem[]` に正規化して返す。

公開関数:
- `fetchAnthropicBlog(): Promise<NewsItem[]>`
- `fetchHackerNews(keywords: string[], maxItems: number): Promise<NewsItem[]>`
- `fetchAll(): Promise<NewsItem[]>` ← 上記2つを `Promise.all` で並列実行し結合

実装方針:
- Node 20 標準の `fetch` を使用（追加依存なし）。
- RSS パースは `fast-xml-parser`（軽量、依存ほぼなし）。
- HN は `topstories.json` → 各 ID を `item/<id>.json` で取得（並列、上限 30 件）。`HN_KEYWORDS` のいずれかをタイトル/URL に含むものだけフィルタ。
- 各 source のフェッチ失敗は他を巻き込まない（`Promise.allSettled` 相当の扱い）。

### 2.3 `src/summarizer.ts`

責務: `NewsItem[]` を受け取り、Claude CLI を子プロセスで起動して日本語マークダウンを生成する。

公開関数:
- `summarize(items: NewsItem[]): Promise<SummarizeResult>`

実装方針:
- `child_process.spawn('claude', [...])` を Promise でラップ。
- フラグ:
  - `-p`
  - `--output-format text`
  - `--no-session-persistence`
  - `--tools ""` （安全のため全ツール無効）
  - `--model ${CLAUDE_MODEL}`
  - `--fallback-model ${CLAUDE_FALLBACK_MODEL}`
  - `--append-system-prompt <ロール定義>`
- stdin にプロンプト本文を流し、stdout を集約して返す。
- 終了コード ≠ 0 は `Error` として throw。
- `CLAUDE_TIMEOUT_MS` を超えたら子プロセスを SIGKILL。

プロンプト構造（stdin に流す本文）:
```
以下の {N} 本の AI 業界ニュースを、日本語で読みやすくまとめてください。

# 出力フォーマット（厳守）
- 冒頭に「## 本日のハイライト」見出しで3行サマリ（箇条書き）
- 各ニュースは「### 元タイトル」「- ソース: ...」「- URL: ...」「- 要約: 2〜4行で日本語」の順
- 末尾に「## 編集後記」見出しで1段落（任意の所感）

# 入力データ
{各 NewsItem を JSON で列挙}
```

### 2.4 `src/writer.ts`

責務: マークダウン本文を `docs/daily/YYYY-MM-DD.md` に書き込む。

公開関数:
- `write(markdown: string, date: Date): Promise<string>` （戻り値は書き込んだ絶対パス）

実装方針:
- フロントマターを自動で付与:
  ```yaml
  ---
  date: 2026-06-01
  generated_by: dailyClaudeNews v0.1
  model: claude-sonnet-4-6
  ---
  ```
- 既存ファイルがあれば上書き（冪等性確保）。

### 2.5 `src/notifier.ts`

責務: 失敗時の通知。

公開関数:
- `notifyFailure(error: Error, context: { phase: string }): Promise<void>`

実装方針:
- `gh issue create --repo $ERROR_ISSUE_REPO --title ... --body ...` を子プロセス実行。
- `osascript -e 'display notification "..." with title "..."'` で macOS 通知。
- どちらも失敗しても無視（通知の失敗で本体を二次失敗させない）。

### 2.6 `src/index.ts`

責務: エントリーポイント。全フェーズを順次実行し、各フェーズの失敗を notifier に集約する。

擬似コード:
```ts
async function main() {
  const phase = { current: 'init' as string }
  try {
    phase.current = 'fetch'
    const items = await fetcher.fetchAll()
    if (items.length === 0) throw new Error('ニュースが取得できませんでした')

    phase.current = 'summarize'
    const { markdown, modelUsed } = await summarizer.summarize(items)

    phase.current = 'write'
    const filePath = await writer.write(markdown, new Date())

    phase.current = 'git'
    await gitCommitAndPush(filePath)

    console.log(`✅ 完了: ${filePath} (model: ${modelUsed})`)
  } catch (err) {
    console.error(`❌ ${phase.current} で失敗:`, err)
    await notifier.notifyFailure(err as Error, { phase: phase.current })
    process.exit(1)
  }
}
```

### 2.7 Git 操作

`src/index.ts` 内のローカル関数（モジュール分けるほどでもない）:
```ts
async function gitCommitAndPush(filePath: string) {
  await exec('git add', [filePath])
  await exec('git commit', ['-m', `chore(daily): ${date} のまとめ`])
  await exec('git push', ['origin', 'main'])
}
```
SSH 認証で push されるため秘密情報を環境変数で持つ必要はない。

---

## 3. データフロー

```
[Anthropic RSS]──┐
                 ├──► fetcher ──► NewsItem[] (~30件) ──► summarizer (claude -p)
[HN API] ────────┘                                            │
                                                              ▼
                                              docs/daily/YYYY-MM-DD.md
                                                              │
                                                              ▼
                                                       git commit & push
                                                              │
                              ┌───────────────────────────────┴─── 失敗時
                              ▼
                     notifier.notifyFailure()
                       ├─ gh issue create
                       └─ osascript display notification
```

---

## 4. エラーハンドリング方針

| フェーズ | 失敗時の挙動 |
|----------|--------------|
| fetch  | 片方のソースが失敗しても、もう片方が成功すれば続行。両方失敗時のみ throw |
| summarize | リトライしない（Max 上限超過の可能性があり、即時再試行は無意味）。throw → 通知 |
| write | ディスク書き込み失敗は即 throw |
| git | push 競合（リモートが進んでいた場合）は `git pull --rebase` してから再 push を1回だけ試行 |
| notifier | 失敗してもメインフローには影響させない |

---

## 5. ログ出力

- `console.log` / `console.error` をそのまま使用。
- `scripts/run.sh` で `>> ~/Library/Logs/dailyClaudeNews/run.log 2>> ~/Library/Logs/dailyClaudeNews/run.error.log` にリダイレクト。
- 各ログ行には `[ISO8601 timestamp] [phase] message` 形式のプレフィックスを `src/index.ts` 内のラッパー関数で付与する。

---

## 6. テスト方針

| モジュール | テスト戦略 |
|------------|------------|
| fetcher | fixtures に保存した RSS XML / HN JSON でモック。ネットワークは叩かない |
| summarizer | `claude` CLI 呼び出しは `child_process.spawn` をモック（vitest の `vi.mock`）。実 CLI 呼び出しは E2E でのみ |
| writer | tmp ディレクトリに書き込み、内容を検証 |
| notifier | `gh` / `osascript` の呼び出しをモックして引数を検証 |
| index | フェーズ毎の throw が正しく notifier に渡るかをモックで検証 |

ユニットテストは外部依存ゼロで実行可能にする（CI 不要・ローカルのみ）。

---

## 7. 将来の拡張余地

- 追加ソース: arXiv、Anthropic Discord、X/Twitter（API 課金が必要）
- 出力形式: GitHub Pages 化（`docs/` を Pages のソースに設定）
- 差分検出: 前日のまとめと類似していたら通知のみ送り push しないオプション
- Slack 通知: 成功時にチャンネル投稿（Webhook URL を `.env` に追加するだけ）

---

## 8. 後続タスクへの引き継ぎ

| 後続タスク | このドキュメントから取り込むべき内容 |
|------------|-------------------------------------|
| T006 fetcher 実装 | §2.2 のインターフェース、HN フィルタ仕様 |
| T007 summarizer 実装 | §2.3 のフラグ一覧、プロンプト構造、タイムアウト処理 |
| T008 writer 実装 | §2.4 のフロントマター形式 |
| T009 notifier 実装 | §2.5 の gh / osascript コマンド |
| T010 index 実装 | §2.6 / §2.7 / §4 のフェーズ管理とエラー方針 |
| T011 run.sh | §1 のラッパー責務（PATH 設定、ログリダイレクト） |
| T012 launchd plist | §1 の StartCalendarInterval 設定 |
| T014 テスト | §6 のモック方針 |

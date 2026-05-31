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
│  1. fetcher.fetchAll()              → NewsItem[]                   │
│  2. deduper.dedupe(items)           → NewsItem[] (重複排除済)      │
│  3. historyFilter.split(items, seen)→ { fresh, recurring }         │
│  4. summarizer.summarize(fresh, recurring) → Markdown              │
│  5. writer.write(md, date)          → ファイルパス                  │
│  6. historyFilter.persist(items)    → state/seen.json 更新         │
│  7. git add / commit / push                                        │
│  ─ 失敗時 ─                                                         │
│  8. notifier.notifyFailure(err)  → GitHub Issue + macOS 通知       │
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
  summary?: string         // RSS の description 等、ある場合
  score?: number           // HN のスコア
  mergedFrom?: string[]    // deduper でマージされた他ソースの URL
  firstSeenDate?: string   // historyFilter が継続話題に付与（YYYY-MM-DD）
  occurrences?: number     // historyFilter が継続話題に付与（過去何回登場したか）
}

export type SeenEntry = {
  normalizedUrl: string
  normalizedTitle: string
  firstSeenDate: string  // YYYY-MM-DD
  lastSeenDate: string   // YYYY-MM-DD
  occurrences: number
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

### 2.3 `src/deduper.ts` 【同run内重複排除】

責務: 同一 run 内の `NewsItem[]` から、ソース間/同ソース内の重複を機械的に排除する。

公開関数:
- `normalizeUrl(url: string): string`
- `normalizeTitle(title: string): string`
- `dedupe(items: NewsItem[]): NewsItem[]`

判定基準（上から順に評価し、いずれか一致でマージ）:
1. **URL 正規化一致**: `https://` 統一、`www.` 削除、末尾 `/` 削除、`utm_*` / `ref` / `fbclid` 等トラッキングパラメータを削除した結果が完全一致
2. **タイトル正規化一致**: 小文字化、全/半角統一、記号除去、連続空白の単一化後に完全一致
3. **タイトル 3-gram Jaccard 類似度 ≧ 0.85**: 表記揺れ（「Claude 4 launched」 vs 「Anthropic launches Claude 4」）の吸収

マージ時の残し方:
- **ソース優先度**: `anthropic-blog` > `hacker-news`（一次情報源優先）
- 同ソース内なら **`publishedAt` が新しい方** を残す（HN は同じ話題が時間差で複数ポストされる）
- 残されなかった項目の `url` は、残された項目の `mergedFrom: string[]` に記録（プロンプトで「関連リンク」として参照可能にする）

### 2.4 `src/historyFilter.ts` 【過去N日重複フィルタ】

責務: 過去 N 日（デフォルト 14 日）の出力履歴 `state/seen.json` と照合し、新規話題と継続話題に分類する。

公開関数:
- `loadSeen(): Promise<SeenEntry[]>`
- `split(items: NewsItem[], seen: SeenEntry[]): { fresh: NewsItem[]; recurring: NewsItem[] }`
- `persist(allItems: NewsItem[]): Promise<void>` （今日の分を追加し、N 日より古いものを削除して保存）

`SeenEntry` 型:
```ts
type SeenEntry = {
  normalizedUrl: string
  normalizedTitle: string
  firstSeenDate: string  // YYYY-MM-DD
  lastSeenDate: string   // YYYY-MM-DD
  occurrences: number
}
```

判定基準:
- `normalizedUrl` 一致 → 継続話題
- `normalizedTitle` 3-gram Jaccard ≧ 0.85 → 継続話題
- それ以外 → 新規

state 保存場所: `state/seen.json`（プロジェクトルート直下）。Git 管理する（差分で「いつから話題になっているか」も追跡可能、複数 PC 運用時の同期にも有用）。

### 2.5 `src/summarizer.ts`

責務: `NewsItem[]` を受け取り、Claude CLI を子プロセスで起動して日本語マークダウンを生成する。

公開関数:
- `summarize(fresh: NewsItem[], recurring: NewsItem[]): Promise<SummarizeResult>`

実装方針:
- `child_process.spawn('claude', [...])` を Promise でラップ。
- `fresh`（新規話題）と `recurring`（継続話題）を別セクションとして渡し、プロンプトで「継続話題は短く触れる、新規話題は厚く要約」と指示する。
- `NewsItem.mergedFrom` が存在する場合は、プロンプトに「関連リンク」として併記する（重複排除でマージされた元 URL を失わない）。
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
以下の AI 業界ニュース一覧を、カテゴリ別に章立ててまとめてください。

# 重複の最終判断（重要）
入力データは事前に機械的な重複排除を行っていますが、見出しや切り口が異なるだけで実質的に同じ話題のものが残っている可能性があります。同一の事実・発表・出来事を扱っていると判断したものは、最も情報量の多い1件にまとめ、他は「- 関連リンク: <URL>」として URL のみを併記してください。新規話題と継続話題の境界をまたぐ重複も同様に統合してください。

# 推論の禁止（重要）
各記事の要約は、入力に含まれる事実（タイトル・URL・ソース・publishedAt・score）のみを根拠にしてください。記事本文は読めないため、本文に書かれていそうな内容を推測・補完してはいけません。「とみられる」「示唆」「期待される」「示している」等の解釈表現は禁止です。

# カテゴリの選び方
推奨カテゴリ（該当無しは見出しを作らない、不足時は追加可）:
- プロダクト・モデルリリース
- 開発者ツール・SDK・インフラ
- 資金調達・買収・事業展開
- 研究発表・論文
- 安全性・倫理・規制・社会影響
- 開発者・利用者の声
- その他

# 出力フォーマット（厳守）
- 冒頭に「## 本日のハイライト」見出しで、事実のみを3行で箇条書き（所感・解釈は含めない）
- 続けて「## カテゴリ別まとめ」見出しを置き、その下に「### カテゴリ名（N件）」見出しを並べる
  - 各ニュースは「#### 元タイトル」「- ソース: ...」「- URL: ...」「- 公開日: YYYY-MM-DD」「- 要約: タイトルから読み取れる事実のみ 1〜3 行」
  - 継続話題は「- 状態: 継続話題（初出: YYYY-MM-DD, 言及 N 回目）」を追加
  - `mergedFrom` がある場合は「- 関連リンク: <他ソースのURL>」を追加
  - カテゴリ内ではスコア降順 → 公開日降順
- 編集後記・所感など主観的セクションは作らない

# 入力データ
## 新規話題（{Nf}件）
{fresh 配列を JSON で列挙}

## 継続話題（{Nr}件）
{recurring 配列を JSON で列挙、各エントリには `firstSeenDate` と `occurrences` を含める}
```

### 2.6 `src/writer.ts`

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

### 2.7 `src/notifier.ts`

責務: 失敗時の通知。

公開関数:
- `notifyFailure(error: Error, context: { phase: string }): Promise<void>`

実装方針:
- `gh issue create --repo $ERROR_ISSUE_REPO --title ... --body ...` を子プロセス実行。
- `osascript -e 'display notification "..." with title "..."'` で macOS 通知。
- どちらも失敗しても無視（通知の失敗で本体を二次失敗させない）。

### 2.8 `src/index.ts`

責務: エントリーポイント。全フェーズを順次実行し、各フェーズの失敗を notifier に集約する。

擬似コード:
```ts
async function main() {
  const phase = { current: 'init' as string }
  try {
    phase.current = 'fetch'
    const raw = await fetcher.fetchAll()
    if (raw.length === 0) throw new Error('ニュースが取得できませんでした')

    phase.current = 'dedupe'
    const items = deduper.dedupe(raw)

    phase.current = 'history-filter'
    const seen = await historyFilter.loadSeen()
    const { fresh, recurring } = historyFilter.split(items, seen)
    console.log(`新規 ${fresh.length} 件 / 継続 ${recurring.length} 件`)

    phase.current = 'summarize'
    const { markdown, modelUsed } = await summarizer.summarize(fresh, recurring)

    phase.current = 'write'
    const filePath = await writer.write(markdown, new Date())

    phase.current = 'persist-history'
    await historyFilter.persist(items)  // state/seen.json 更新

    phase.current = 'git'
    await gitCommitAndPush([filePath, 'state/seen.json'])

    console.log(`✅ 完了: ${filePath} (model: ${modelUsed})`)
  } catch (err) {
    console.error(`❌ ${phase.current} で失敗:`, err)
    await notifier.notifyFailure(err as Error, { phase: phase.current })
    process.exit(1)
  }
}
```

### 2.9 Git 操作

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
                 ├──► fetcher ──► NewsItem[] (~30件)
[HN API] ────────┘                      │
                                        ▼
                                    deduper           ◄── 同run内の重複排除
                                        │              （URL正規化, タイトル類似度0.85）
                                        ▼
                                  historyFilter       ◄── state/seen.json と照合
                                  ├─ fresh[]              （過去14日と比較）
                                  └─ recurring[]
                                        │
                                        ▼
                                  summarizer (claude -p)
                                        │
                                        ▼
                              docs/daily/YYYY-MM-DD.md
                                        │
                              state/seen.json 更新
                                        │
                                        ▼
                                git commit & push
                                        │
                  ┌─────────────────────┴─── 失敗時
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
| dedupe | 純粋関数。失敗ケースは想定しない（バグなら throw して通知） |
| history-filter | `state/seen.json` 読み込み失敗時は空配列で続行（初回実行を想定）。書き込み失敗は throw |
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
| deduper | 純粋関数。ケース表（同一URL/類似タイトル/異なる/トラッキングパラメータ違いなど）で網羅検証 |
| historyFilter | tmp ディレクトリ上の `seen.json` で `loadSeen` / `split` / `persist` のラウンドトリップを検証。N日経過した古いエントリの削除も確認 |
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
| T006a deduper 実装【新規】 | §2.3 の正規化規則と類似度判定 |
| T006b historyFilter 実装【新規】 | §2.4 の SeenEntry スキーマと N 日ローテーション |
| T007 summarizer 実装 | §2.5 のフラグ一覧、プロンプト構造、`fresh`/`recurring` の扱い |
| T008 writer 実装 | §2.6 のフロントマター形式 |
| T009 notifier 実装 | §2.7 の gh / osascript コマンド |
| T010 index 実装 | §2.8 / §2.9 / §4 のフェーズ管理とエラー方針 |
| T011 run.sh | §1 のラッパー責務（PATH 設定、ログリダイレクト） |
| T012 launchd plist | §1 の StartCalendarInterval 設定 |
| T014 テスト | §6 のモック方針 |

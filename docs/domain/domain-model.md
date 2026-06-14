# ドメインモデル設計書

**作成日**: 2026-06-14  
**対象**: dailyClaudeNews v0.1  
**関連**: [アーキテクチャ設計](./architecture.md)

---

## 1. ドメインの目的

「毎朝、日本語でAI業界ニュースを読める状態をユーザーに届ける」

このシステムは次の3つの責務を持つ。

1. **収集**: 複数ソースから記事を取得・重複排除・優先度付け
2. **生成**: LLMで日本語要約・ハイライト・カテゴリ分類
3. **配信**: GitHub Pagesに公開し、視覚的に読みやすいページをレンダリング

---

## 2. ドメインエンティティ

### 2-1. NewsItem（記事）

パイプラインを通じて情報が付加されていく中心エンティティ。

```typescript
type NewsItem = {
  // --- アイデンティティ（fetch時に確定）---
  source: 'anthropic-blog' | 'hacker-news' | 'zenn' | 'qiita'
  title: string
  url: string
  publishedAt: Date

  // --- スコア/メタ（fetch時に付加）---
  summary?: string        // RSS要約
  score?: number          // HNポイント等
  mergedFrom?: string[]   // 重複マージ元URL（deduper）

  // --- 継続話題メタ（history-filter時に付加）---
  firstSeenDate?: string
  occurrences?: number
  bodyChanged?: boolean

  // --- エンリッチ情報（enrich-bodies時に付加）---
  bodyText?: string       // 本文テキスト（3500字上限）
  ogImage?: string        // og:image URL
}
```

**設計上の注意**: `NewsItem` はパイプラインを通じて「状態が付加される」データ転送オブジェクトであり、不変ではない。`bodyText`未設定のまま後工程に渡った場合の挙動をフェーズごとに意識する必要がある。

---

### 2-2. SeenEntry（観測履歴）

```typescript
type SeenEntry = {
  normalizedUrl: string
  normalizedTitle: string
  firstSeenDate: string
  lastSeenDate: string
  occurrences: number
  bodyHash?: string    // SHA-256 prefix 16字
  bodyLength?: number
}
```

`state/seen.json` に永続化。14日間 retention。

---

### 2-3. Caution（用語注意事項）

```typescript
type Caution = {
  term: string
  rule: string
  examples: string[]
  firstSeen: string
  lastSeen: string
  occurrences: number
}
```

LLMが発見した固有名詞の表記ルールを蓄積し、次回以降のプロンプトに注入する。

---

### 2-4. HeroMatch（ハイライト-記事対応）

ハイライト1行と記事の対応関係を表す明示的なエンティティ。

```typescript
type HeroMatch = {
  highlight: string          // ハイライトテキスト
  articleUrl: string | null  // マッチした記事URL（マッチなしは null）
  ogImage: string | null     // マッチした記事の og:image
}
```

```
highlight[i] ←→ NewsItem  （1対1、最大3ペア）
```

対応関係は `pick-hero` フェーズが確定し、`heroMatcher.ts` の `pickHeroMatches()` が `HeroMatch[]` を生成する。`writer.ts` がこれを frontmatter の `hero_matches` として保存し、クライアント（`daily.js`）は `article_url` でカードを特定する。これによりマッチングロジックがサーバー1箇所に集約される。

> **背景**: かつて `HeroMatch` は型として存在せず、frontmatter には `ogImage` URL のみが渡り、対応関係がクライアントで再計算されていた。これが 2026-06-14 のヒーローマッチングバグの根本原因だった。当時の分析・修正案の比較・採用判断（案A採用）の経緯はフロー情報
> [ヒーローマッチング設計問題と修正案（2026-06-14）](../flow/hero-matching-design-issue.md)
> を参照。

---

## 3. パイプラインフェーズと責務

```
fetch → dedupe → prioritize → history-filter
  → enrich-bodies → summarize → review
  → pick-hero → write
  → persist-history → persist-cautions
  → git → verify-deploy
```

| フェーズ | 入力 | 出力 | 責務 |
|---------|------|------|------|
| fetch | — | `NewsItem[]` | 4ソースから並行取得（Promise.allSettled） |
| dedupe | raw[] | deduped[] | URL正規化＋タイトルJaccard（閾値0.85）で重複統合 |
| prioritize | deduped[] | items[] | キーワードマッチ→補充（最大10件） |
| history-filter | items[] | fresh[], recurring[] | seen.json照合→新規/継続分類 |
| enrich-bodies | fresh[], recurring[] | +bodyText, +ogImage | 本文取得・og:image取得（並行8件, 3リトライ） |
| summarize | fresh[], recurring[] | markdown | LLM（Sonnet）で日本語要約＋ハイライト3行生成 |
| review | markdown | correctedMarkdown, newCautions | LLM（Sonnet）で固有名詞訂正＋注意事項抽出 |
| pick-hero | markdown, allEnriched[] | `ogImage[]` (3件) | ハイライト3行と記事のマッチング → OGP画像選択 |
| write | markdown, meta | `.md` file | Jekyll frontmatter＋記事本文をファイル出力 |
| persist-history | items | seen.json | bodyHash計算して履歴永続化 |
| persist-cautions | newCautions | cautions.json | 用語ルール蓄積 |
| git | filePaths | GitHub Pages反映 | daily/ブランチ→squash merge→main |
| verify-deploy | dateStr | — | GitHub Pages公開確認（polling） |

---

## 4. レンダリング層（ブラウザ側）

Jekyll が生成したHTMLを `daily.js` がDOMパースして再構成する。

```
docs/daily/YYYY-MM-DD.md
  ├─ frontmatter: hero_images[3]  ← pick-heroフェーズが書き込む
  └─ content: markdown本文
        ├─ ## 本日のハイライト（3行）
        └─ ## カテゴリ別まとめ
              └─ ### カテゴリ名
                    └─ #### [記事タイトル](URL)
```

`daily.js` の処理：
1. `parseDocument()`: HTML → `{ highlights: string[], categories: Category[] }` に変換
2. `findArticleForHighlight()`: highlightテキストと記事カードをクライアント側でマッチング
3. `renderHero()`: `window.HERO_IMAGES`（サーバー側が書いたog:image）と`findArticleForHighlight`の結果を組み合わせてTop3カードを描画

---

## 5. 関連ファイル

| ファイル | 役割 |
|---------|------|
| `src/heroMatcher.ts` | サーバー側マッチング（HeroMatch計算） |
| `src/writer.ts` | frontmatter生成（hero_images書き込み） |
| `docs/assets/js/daily.js` | クライアント側マッチング・Top3レンダリング |
| `docs/_layouts/daily.html` | `window.HERO_IMAGES` を注入するレイアウト |
| `src/types.ts` | NewsItem等の型定義 |

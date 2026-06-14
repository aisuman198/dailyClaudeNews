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

**現状は明示的な型が存在しない**。これが今回のバグの根本原因の一つ（後述）。

概念的には次の対応関係を表す：

```
highlight[i] ←→ NewsItem  （1対1、最大3ペア）
```

この対応関係が確定するのは `pick-hero` フェーズだが、その結果（`ogImage` のURLのみ）しかフロントエンドに渡っておらず、「どのhighlightがどのNewsItemに対応するか」という情報は失われる。

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

## 5. ヒーローマッチングの設計問題（バグの根本原因）

### 5-1. 二重マッチング問題

「highlightとNewsItemの対応関係」を求める処理が **2箇所に独立して存在** する。

| | heroMatcher.ts（サーバー） | daily.js（クライアント） |
|---|---|---|
| **用途** | og:image URLの選択 | カードへのリンク先（アンカー）の選択 |
| **アルゴリズム** | 英数トークン(≥4字) + CJKバイグラム | 英数ワード(>3字, 空白分割)のみ |
| **CJK対応** | ✅ | ❌ |
| **実行タイミング** | ビルド時（サーバー） | ページロード時（ブラウザ） |

この2つが異なる結果を返した場合、**「OGP画像がAの記事」なのに「リンクはBの記事へ」** という状態が発生する。

### 5-2. HeroMatchを型として表現していない

`pick-hero` フェーズが確定した「highlight[i] ↔ NewsItem」の対応関係が、`frontmatter` には `ogImage` URL のみとして保存され、対応するNewsItemのIDや記事URLが捨てられる。

その結果：
- クライアントは対応関係を独自に再計算する必要がある
- サーバーとクライアントのアルゴリズムが乖離しやすい

### 5-3. スコアリングのソース非依存問題

`score()` 関数はソース（anthropic-blog / qiita 等）を区別しない。  
Qiita/Zennのような「AI技術解説記事」は「Claude」「Anthropic」等の英語キーワードを含みやすく、ハイライトの本来対象記事（anthropic-blog）とスコアで競合する。

**今回のバグ（2026-06-14）の具体的な発生メカニズム**:

```
highlight[0]: "米国政府が輸出規制指令を発令し、Anthropicは Claude Fable 5・Mythos 5 への..."
              ↓ 英数トークンのみでスコアリング（修正前）
  anthropic.com/news/fable-mythos-access  → score=2 (fable, mythos)
  qiita.com/lhjjjk4/...（AIダイジェスト） → score=3 (anthropic, fable, mythos)
              ↓ Qiita記事が勝利 → Qiita OGP画像が表示される
```

CJKバイグラムを追加した修正後:

```
  anthropic.com/news/fable-mythos-access  → score=14 (fable, mythos + 米国,国政,政府,輸出...)
  qiita.com/lhjjjk4/...（AIダイジェスト） → score=4  (anthropic, fable, mythos + 停止)
              ↓ Anthropic記事が正しく選ばれる
```

---

## 6. 再発防止のためのドメイン設計修正案

### 案A: HeroMatchを明示的な型にしfrontmatterに含める（推奨）

**概念**:

```typescript
type HeroMatch = {
  highlight: string        // ハイライトテキスト
  articleUrl: string       // マッチした記事URL
  ogImage: string | null   // マッチした記事のog:image
}
```

`frontmatter` に `hero_matches` として保存:

```yaml
hero_matches:
  - highlight: "..."
    article_url: "https://www.anthropic.com/news/fable-mythos-access"
    og_image: "https://cdn.sanity.io/..."
  - ...
```

**クライアント側の変更**:
- `findArticleForHighlight()` を使わず、`window.HERO_MATCHES` から `article_url` でカードを検索する
- マッチングアルゴリズムをサーバー1箇所に集約

**メリット**:
- 「どのhighlightがどの記事か」という対応関係が単一の真実（frontmatter）に集約される
- クライアント側のアルゴリズム乖離問題が原理的に発生しない
- `articleUrl` でカードを確実に特定できる（スコアリングに依存しない）

**デメリット**:
- frontmatterの変更でJekyllレイアウト・daily.jsの改修が必要
- 後方互換性（既存の .md ファイル）の考慮が必要

---

### 案B: daily.jsのマッチングアルゴリズムをサーバー側と統一する

`findArticleForHighlight()` にCJKバイグラムを追加し、heroMatcher.tsと同じロジックにする。

**メリット**: 改修範囲が小さい（daily.jsのみ）

**デメリット**:
- 二重マッチング問題（同じ計算を2箇所でする）は解消されない
- アルゴリズムを変更するたびに2箇所を同期する必要がある
- 将来的に再度乖離するリスクが残る

---

### 案C: ソース優先度をスコアに組み込む

`score()` にソース優先度ボーナスを追加:

```typescript
const SOURCE_BONUS = {
  'anthropic-blog': 100,
  'hacker-news': 10,
  'zenn': 5,
  'qiita': 5,
}

function score(item: NewsItem, highlight: string): number {
  // ... 既存ロジック ...
  return s + SOURCE_BONUS[item.source]
}
```

**メリット**: anthropic-blog記事が常に優先される

**デメリット**:
- QiitaやZennの記事が正しいマッチ対象の場合（例：highlight[2]のClaude Codeバージョン記事）でも負けてしまう
- ソース優先度という「非意味論的な」要素をマッチングに混入させる

---

## 7. 今後の設計方針（決定事項）

**2026-06-14 レビュー結果: 案A を採用**（実装: [feat/hero-matches-frontmatter](https://github.com/aisuman198/dailyClaudeNews/pull/45)）

| 観点 | 採用案 | 理由 |
|-----|--------|------|
| HeroMatch設計 | **案A**: `HeroMatch` を型として定義し、frontmatter に `hero_matches` を保存 | 対応関係の単一の真実をサーバー側に集約し、クライアント側のアルゴリズム乖離を原理的に排除する |
| クライアント実装 | `daily.js` は `window.HERO_MATCHES` の `article_url` でカードを特定。`findArticleForHighlight()` はフォールバック専用に縮退 | スコアリングに依存しない確実な対応付け |
| 既存ページの扱い | 既存の `.md`（`hero_images` のみ）は再ラン不要。`daily.js` は `hero_matches` 不在時に旧ロジックへフォールバック | 過去ページを壊さない |
| 後方互換性 | `writer.ts` は `hero_matches` と `hero_images` の両方を出力する | レイアウト・JS の段階的移行を可能にする |

### 案A の実装方針

```typescript
type HeroMatch = {
  highlight: string          // ハイライトテキスト
  articleUrl: string | null  // マッチした記事URL（マッチなしは null）
  ogImage: string | null     // マッチした記事の og:image
}
```

- `heroMatcher.ts`: `pickHeroMatches(markdown, items): HeroMatch[]` を追加（既存の `pickHeroArticles` を再利用）
- `writer.ts`: frontmatter に `hero_matches`（互換のため `hero_images` も）を書き込む
- `daily.html`: `window.HERO_MATCHES` を注入
- `daily.js`: `HERO_MATCHES` があれば `article_url` でカードを特定。なければ旧 `findArticleForHighlight()` にフォールバック

---

## 8. 関連ファイル

| ファイル | 役割 |
|---------|------|
| `src/heroMatcher.ts` | サーバー側マッチング（HeroMatch計算） |
| `src/writer.ts` | frontmatter生成（hero_images書き込み） |
| `docs/assets/js/daily.js` | クライアント側マッチング・Top3レンダリング |
| `docs/_layouts/daily.html` | `window.HERO_IMAGES` を注入するレイアウト |
| `src/types.ts` | NewsItem等の型定義 |

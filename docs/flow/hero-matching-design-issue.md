# フロー情報: ヒーローマッチング設計問題と修正案（2026-06-14）

**種別**: フロー情報（修正時の一時情報・検討中の設計判断）
**発生日**: 2026-06-14
**抽出元**: [ドメイン情報: ドメインモデル設計書](../domain/domain-model.md)（§2-4 HeroMatch）

> ドメインの恒久的な定義（NewsItem / SeenEntry / パイプラインフェーズ等）は
> [ドメインモデル設計書](../domain/domain-model.md) を参照。本書は 2026-06-14 の
> ヒーローマッチングバグに紐づく一時的な分析・修正案・未決事項を扱う。

---

## 1. ヒーローマッチングの設計問題（バグの根本原因）

### 1-1. 二重マッチング問題

「highlightとNewsItemの対応関係」を求める処理が **2箇所に独立して存在** する。

| | heroMatcher.ts（サーバー） | daily.js（クライアント） |
|---|---|---|
| **用途** | og:image URLの選択 | カードへのリンク先（アンカー）の選択 |
| **アルゴリズム** | 英数トークン(≥4字) + CJKバイグラム | 英数ワード(>3字, 空白分割)のみ |
| **CJK対応** | ✅ | ❌ |
| **実行タイミング** | ビルド時（サーバー） | ページロード時（ブラウザ） |

この2つが異なる結果を返した場合、**「OGP画像がAの記事」なのに「リンクはBの記事へ」** という状態が発生する。

### 1-2. HeroMatchを型として表現していない

`pick-hero` フェーズが確定した「highlight[i] ↔ NewsItem」の対応関係が、`frontmatter` には `ogImage` URL のみとして保存され、対応するNewsItemのIDや記事URLが捨てられる。

その結果：
- クライアントは対応関係を独自に再計算する必要がある
- サーバーとクライアントのアルゴリズムが乖離しやすい

### 1-3. スコアリングのソース非依存問題

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

## 2. 再発防止のためのドメイン設計修正案

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

## 3. 今後の設計方針（決定事項）

**2026-06-14 レビュー結果: 案A を採用**（実装: [feat/hero-matches-frontmatter (#45)](https://github.com/aisuman198/dailyClaudeNews/pull/45)）

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

> 確定した HeroMatch のエンティティ定義は、マスタ情報
> [ドメインモデル設計書 §2-4](../domain/domain-model.md) に反映済み。

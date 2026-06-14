import type { NewsItem } from './types.js'

/**
 * summarizer 出力マークダウンから「## 本日のハイライト」直下の箇条書きを最大 3 件抽出する。
 */
export function extractHighlights(markdown: string): string[] {
  const m = markdown.match(/^##\s+本日のハイライト[ \t]*\n([\s\S]*?)(?=^##\s|\Z)/m)
  if (!m) return []
  const body = m[1] ?? ''
  const out: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const t = line.replace(/^\s*[-*•]\s+/, '').trim()
    if (!t) continue
    out.push(t)
    if (out.length >= 3) break
  }
  return out
}

/**
 * ハイライト 1 文に対する記事のスコアを計算する。
 * 記事タイトルに含まれる長さ 4 以上の英数字トークンが、ハイライト本文に何個含まれるかを数える。
 * 例: "Dynamic Workflows in Claude Code" → ["dynamic","workflows","claude","code"]
 *     ハイライトに "Dynamic Workflows" "Claude Code" が含まれれば 4 点。
 */
function score(item: NewsItem, highlight: string): number {
  const h = highlight.toLowerCase()
  const title = item.title.toLowerCase()
  let s = 0

  // English alphanumeric tokens (≥4 chars)
  const tokens = (title.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 4)
  for (const w of tokens) {
    if (h.includes(w)) s++
  }

  // CJK bigrams — Japanese highlights can't be differentiated by English tokens alone
  // when multiple articles share common terms like "claude" or "anthropic".
  // Extract consecutive CJK character pairs from the title and check if they appear in the highlight.
  const cjkSegments = title.match(/[぀-鿿＀-￯]+/g) ?? []
  for (const seg of cjkSegments) {
    for (let i = 0; i < seg.length - 1; i++) {
      if (h.includes(seg.slice(i, i + 2))) s++
    }
  }

  return s
}

/**
 * ハイライト 3 本それぞれに最も合致する記事 (上位スコア) を返す。
 * - 同じ記事を 2 度ピックしない (used set で除外)
 * - 合致しないハイライト (スコア 0) はスキップし、結果配列の長さは <= 3
 */
export function pickHeroArticles(markdown: string, items: NewsItem[]): NewsItem[] {
  const highlights = extractHighlights(markdown)
  const picked: NewsItem[] = []
  const usedUrls = new Set<string>()
  for (const h of highlights) {
    let best: NewsItem | null = null
    let bestScore = 0
    for (const it of items) {
      if (usedUrls.has(it.url)) continue
      const s = score(it, h)
      if (s > bestScore) {
        bestScore = s
        best = it
      }
    }
    if (best && bestScore > 0) {
      picked.push(best)
      usedUrls.add(best.url)
    }
  }
  return picked
}

/**
 * 3 本のハイライトに対応する og:image URL の配列を返す (長さは常に 3)。
 * 該当記事なし or og:image 未取得は null になる。
 */
export function pickHeroImages(markdown: string, items: NewsItem[]): (string | null)[] {
  const articles = pickHeroArticles(markdown, items)
  const out: (string | null)[] = [null, null, null]
  for (let i = 0; i < 3; i++) {
    out[i] = articles[i]?.ogImage ?? null
  }
  return out
}

/**
 * ハイライトと記事の対応関係 (HeroMatch)。
 * 「どの highlight がどの記事に対応するか」を単一の真実としてサーバー側で確定し、
 * frontmatter (hero_matches) 経由でクライアントに渡す。
 * これによりクライアント側 (daily.js) が独自にマッチングを再計算する必要がなくなり、
 * サーバー/クライアント間のアルゴリズム乖離 (OGP画像とリンク先の不一致) を防ぐ。
 *
 * 設計: docs/design/domain-model.md 第7節「案A」
 */
export type HeroMatch = {
  /** ハイライト本文 */
  highlight: string
  /** マッチした記事 URL。マッチなしは null */
  articleUrl: string | null
  /** マッチした記事の og:image。マッチなし or 未取得は null */
  ogImage: string | null
}

/**
 * ハイライトごとの HeroMatch を返す。
 * - highlights の順序を保持し、各 highlight に対応する記事 (or マッチなし) を 1 件ずつ対応させる。
 * - pickHeroArticles と同じスコアリング・重複排除ロジックを共有する。
 */
export function pickHeroMatches(markdown: string, items: NewsItem[]): HeroMatch[] {
  const highlights = extractHighlights(markdown)
  const usedUrls = new Set<string>()
  const matches: HeroMatch[] = []
  for (const h of highlights) {
    let best: NewsItem | null = null
    let bestScore = 0
    for (const it of items) {
      if (usedUrls.has(it.url)) continue
      const s = score(it, h)
      if (s > bestScore) {
        bestScore = s
        best = it
      }
    }
    if (best && bestScore > 0) {
      usedUrls.add(best.url)
      matches.push({ highlight: h, articleUrl: best.url, ogImage: best.ogImage ?? null })
    } else {
      matches.push({ highlight: h, articleUrl: null, ogImage: null })
    }
  }
  return matches
}

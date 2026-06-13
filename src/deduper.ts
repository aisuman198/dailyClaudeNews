import { config } from './config.js'
import type { NewsItem, NewsSource } from './types.js'

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ref', 'ref_src', 'ref_url', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
])

const SOURCE_PRIORITY: Record<NewsSource, number> = {
  'anthropic-blog': 100,
  'zenn': 50,
  'qiita': 50,
  'hacker-news': 10,
}

export function normalizeUrl(input: string): string {
  try {
    const u = new URL(input.trim())
    u.protocol = 'https:'
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase()
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k)
    }
    u.hash = ''
    let out = u.toString()
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1)
    return out
  } catch {
    return input.trim().toLowerCase()
  }
}

export function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ngrams(s: string, n: number): Set<string> {
  if (s.length < n) return new Set([s])
  const out = new Set<string>()
  for (let i = 0; i <= s.length - n; i++) out.add(s.slice(i, i + n))
  return out
}

export function jaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const A = ngrams(a, 3)
  const B = ngrams(b, 3)
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

function pickWinner(a: NewsItem, b: NewsItem): { winner: NewsItem; loser: NewsItem } {
  const pa = SOURCE_PRIORITY[a.source]
  const pb = SOURCE_PRIORITY[b.source]
  if (pa !== pb) {
    return pa > pb ? { winner: a, loser: b } : { winner: b, loser: a }
  }
  return a.publishedAt.getTime() >= b.publishedAt.getTime()
    ? { winner: a, loser: b }
    : { winner: b, loser: a }
}

function mergeInto(winner: NewsItem, loser: NewsItem): NewsItem {
  const merged = new Set(winner.mergedFrom ?? [])
  merged.add(loser.url)
  for (const u of loser.mergedFrom ?? []) merged.add(u)
  return { ...winner, mergedFrom: [...merged] }
}

export function dedupe(items: NewsItem[]): NewsItem[] {
  const threshold = config.dedupTitleSimilarity
  const kept: { item: NewsItem; nUrl: string; nTitle: string }[] = []

  for (const cur of items) {
    const nUrl = normalizeUrl(cur.url)
    const nTitle = normalizeTitle(cur.title)

    let matchIndex = -1
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i]!
      if (k.nUrl === nUrl) { matchIndex = i; break }
      if (k.nTitle && nTitle && k.nTitle === nTitle) { matchIndex = i; break }
      if (k.nTitle && nTitle && jaccardSimilarity(k.nTitle, nTitle) >= threshold) {
        matchIndex = i
        break
      }
    }

    if (matchIndex === -1) {
      kept.push({ item: cur, nUrl, nTitle })
      continue
    }

    const existing = kept[matchIndex]!
    const { winner, loser } = pickWinner(existing.item, cur)
    const merged = mergeInto(winner, loser)
    kept[matchIndex] = {
      item: merged,
      nUrl: normalizeUrl(merged.url),
      nTitle: normalizeTitle(merged.title),
    }
  }

  return kept.map((k) => k.item)
}

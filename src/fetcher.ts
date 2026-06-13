import { XMLParser } from 'fast-xml-parser'
import { config } from './config.js'
import { redact } from './redact.js'
import type { NewsItem } from './types.js'

const RSS_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
})

const FETCH_TIMEOUT_MS = 15_000

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'dailyClaudeNews/0.1' } })
  } finally {
    clearTimeout(timer)
  }
}

const ANTHROPIC_NEWS_PATH_RE = /\/(news|research|engineering)\//

function slugToTitle(url: string): string {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim()
  } catch {
    return url
  }
}

// anthropic.com は RSS を提供していないため、sitemap.xml から
// /news/ /research/ /engineering/ パス配下の最近の URL を抽出する。
export async function fetchAnthropicBlog(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout(config.anthropicSitemap, FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(`Anthropic sitemap HTTP ${res.status}`)
  const xml = await res.text()
  const parsed = RSS_PARSER.parse(xml) as {
    urlset?: { url?: unknown }
  }
  const rawUrls = parsed.urlset?.url
  const urls = Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : []

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - config.anthropicLookbackDays)

  return urls
    .map((raw): NewsItem | null => {
      const r = raw as { loc?: string; lastmod?: string }
      const loc = String(r.loc ?? '').trim()
      if (!loc || !ANTHROPIC_NEWS_PATH_RE.test(loc)) return null
      const lastmod = r.lastmod ? new Date(String(r.lastmod)) : null
      if (!lastmod || Number.isNaN(lastmod.getTime()) || lastmod < cutoff) return null
      return {
        source: 'anthropic-blog',
        title: slugToTitle(loc),
        url: loc,
        publishedAt: lastmod,
      }
    })
    .filter((i): i is NewsItem => i !== null)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, config.anthropicMaxItems)
}

type HnItem = {
  id: number
  title?: string
  url?: string
  time?: number
  score?: number
  type?: string
}

export async function fetchHackerNews(keywords: string[], maxItems: number): Promise<NewsItem[]> {
  const topRes = await fetchWithTimeout(config.hnTopStoriesApi, FETCH_TIMEOUT_MS)
  if (!topRes.ok) throw new Error(`HN topstories HTTP ${topRes.status}`)
  const ids = (await topRes.json()) as number[]
  const targetIds = ids.slice(0, maxItems)

  const items = await Promise.all(
    targetIds.map(async (id): Promise<HnItem | null> => {
      try {
        const r = await fetchWithTimeout(`${config.hnItemApi}/${id}.json`, FETCH_TIMEOUT_MS)
        if (!r.ok) return null
        return (await r.json()) as HnItem
      } catch {
        return null
      }
    }),
  )

  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const keywordRes = keywords.map((k) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(k)}(?:[^\\p{L}\\p{N}]|$)`, 'iu'))
  return items
    .filter((i): i is HnItem => i !== null && i.type === 'story' && !!i.title && !!i.url)
    .filter((i) => keywordRes.some((re) => re.test(i.title!) || re.test(i.url!)))
    .map((i): NewsItem => ({
      source: 'hacker-news',
      title: i.title!.trim(),
      url: i.url!.trim(),
      publishedAt: i.time ? new Date(i.time * 1000) : new Date(),
      score: i.score,
    }))
}

export async function fetchZenn(): Promise<NewsItem[]> {
  const allItems: NewsItem[] = []
  for (const topic of config.zennTopics) {
    const url = `https://zenn.dev/topics/${topic}/feed`
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
    if (!res.ok) throw new Error(`Zenn RSS HTTP ${res.status} (topic=${topic})`)
    const xml = await res.text()
    const parsed = RSS_PARSER.parse(xml) as { feed?: { entry?: unknown } }
    const rawEntries = parsed.feed?.entry
    const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : []
    for (const e of entries) {
      const entry = e as { title?: unknown; link?: unknown; published?: string; updated?: string }
      const titleRaw = entry.title
      const title = typeof titleRaw === 'object' && titleRaw !== null
        ? String((titleRaw as Record<string, unknown>)['#text'] ?? '')
        : String(titleRaw ?? '').trim()
      const linkRaw = entry.link
      const link = typeof linkRaw === 'object' && linkRaw !== null
        ? String((linkRaw as Record<string, unknown>)['href'] ?? '')
        : String(linkRaw ?? '').trim()
      if (!title || !link) continue
      const dateStr = entry.published ?? entry.updated ?? ''
      const publishedAt = dateStr ? new Date(dateStr) : new Date()
      allItems.push({ source: 'zenn', title, url: link, publishedAt })
    }
  }
  // dedupe by URL within Zenn results, sort by date, cap
  const seen = new Set<string>()
  return allItems
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .slice(0, config.zennMaxItems)
}

type QiitaItem = {
  title?: string
  url?: string
  created_at?: string
  likes_count?: number
}

export async function fetchQiita(): Promise<NewsItem[]> {
  const allItems: NewsItem[] = []
  for (const tag of config.qiitaTags) {
    const url = `https://qiita.com/api/v2/tags/${encodeURIComponent(tag)}/items?sort=stock&per_page=${config.qiitaMaxItems}`
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
    if (!res.ok) throw new Error(`Qiita API HTTP ${res.status} (tag=${tag})`)
    const items = (await res.json()) as QiitaItem[]
    for (const item of items) {
      if (!item.title || !item.url) continue
      const publishedAt = item.created_at ? new Date(item.created_at) : new Date()
      allItems.push({ source: 'qiita', title: item.title.trim(), url: item.url.trim(), publishedAt, score: item.likes_count })
    }
  }
  // dedupe by URL within Qiita results, sort by score desc, cap
  const seen = new Set<string>()
  return allItems
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .slice(0, config.qiitaMaxItems)
}

export async function fetchAll(): Promise<NewsItem[]> {
  const results = await Promise.allSettled([
    fetchAnthropicBlog(),
    fetchHackerNews(config.hnKeywords, config.hnMaxItems),
    fetchZenn(),
    fetchQiita(),
  ])

  const labels = ['anthropic-blog', 'hacker-news', 'zenn', 'qiita']
  const items: NewsItem[] = []
  const errors: string[] = []
  for (const [idx, r] of results.entries()) {
    const label = labels[idx] ?? String(idx)
    if (r.status === 'fulfilled') {
      items.push(...r.value)
    } else {
      errors.push(`${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    }
  }

  if (items.length === 0) {
    throw new Error(`全ソースの取得に失敗しました: ${errors.join(' / ')}`)
  }
  if (errors.length > 0 && config.verbose) {
    console.warn(redact(`一部のソース取得に失敗: ${errors.join(' / ')}`))
  }
  return items
}

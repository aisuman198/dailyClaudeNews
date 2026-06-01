import { config } from './config.js'
import { redact } from './redact.js'
import type { NewsItem } from './types.js'

const FETCH_TIMEOUT_MS = 12_000
const MAX_CONCURRENT = 8
const MAX_BODY_CHARS = 3_500

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 dailyClaudeNews/0.1'

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
}

// U+FFFD（REPLACEMENT CHARACTER）と、その前後にある可能性の高い不完全な部分を含めて
// クリーンアップする。bodyText に文字化けが残ると Claude が出力に転写してしまうため。
function stripMojibake(s: string): string {
  // 連続する U+FFFD と、各 U+FFFD の隣にある単一文字も削る（破損部分の救済）
  return s
    .replace(/[\s\S]?�+[\s\S]?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// 記事 HTML から og:image または twitter:image の URL を抽出する。
// 相対 URL は記事 URL を基準に絶対 URL 化する。見つからなければ null。
export function extractOgImageFromHtml(html: string, baseUrl: string): string | null {
  const patterns: RegExp[] = [
    /<meta\s+[^>]*property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i,
    /<meta\s+[^>]*name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) {
      const raw = decodeEntities(m[1].trim())
      try {
        return new URL(raw, baseUrl).toString()
      } catch {
        // 不正 URL は無視して次へ
      }
    }
  }
  return null
}

export function extractTextFromHtml(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')

  const text = stripMojibake(
    decodeEntities(stripped.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim(),
  )
  return text.slice(0, MAX_BODY_CHARS)
}

type FetchedArticle = { text: string | null; ogImage: string | null }

async function fetchOne(url: string): Promise<FetchedArticle> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT, 'accept': 'text/html,application/xhtml+xml' },
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return { text: null, ogImage: null }
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!ct.includes('html')) return { text: null, ogImage: null }
    const html = await res.text()
    const text = extractTextFromHtml(html)
    const ogImage = extractOgImageFromHtml(html, url)
    return { text: text.length >= 100 ? text : null, ogImage }
  } catch {
    return { text: null, ogImage: null }
  }
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  })
  await Promise.all(workers)
  return results
}

export async function enrichWithBodies(items: NewsItem[]): Promise<NewsItem[]> {
  const fetched = await withConcurrency(items, MAX_CONCURRENT, async (it) => fetchOne(it.url))
  let bodyOk = 0
  let imgOk = 0
  const enriched = items.map((it, idx): NewsItem => {
    const r = fetched[idx]
    const next: NewsItem = { ...it }
    if (r?.text) {
      bodyOk++
      next.bodyText = r.text
    }
    if (r?.ogImage) {
      imgOk++
      next.ogImage = r.ogImage
    }
    return next
  })
  if (config.verbose || true) {
    console.log(redact(`[enrich] 本文取得成功 ${bodyOk}/${items.length} 件 / og:image ${imgOk}/${items.length} 件`))
  }
  return enriched
}

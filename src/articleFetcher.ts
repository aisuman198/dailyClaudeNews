import { truncateBody } from './bodyText.js'
import { config } from './config.js'
import { redact } from './redact.js'
import type { NewsItem } from './types.js'

const FETCH_TIMEOUT_MS = 12_000
const MAX_CONCURRENT = 8
const MAX_RETRIES = 2 // initial 1 + retry 2 = 計 3 試行
const RETRY_BASE_DELAY_MS = Number(process.env.FETCH_RETRY_BASE_DELAY_MS ?? 500)

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

// 記事末尾に付く定型 UI 文言。1記事の上限を 3,500 → 12,000 文字へ広げたことで
// これらがプロンプトに載るようになったため、本文の後ろから切り落とす。
// 誤爆で本文を削らないよう、本文の後半に現れた場合だけ有効にする。
const TRAILING_BOILERPLATE = [
  'Register as a new user and use Qiita more conveniently',
  'Go to list of users who liked',
  'Deleted articles cannot be recovered',
]

/** 記事末尾の定型 UI 文言を落とす。見つからなければそのまま返す。 */
export function stripTrailingBoilerplate(text: string): string {
  // 同じ文言はページ上部 (いいねボタン等) にも出るため、後半に現れた分だけを探す。
  const from = Math.floor(text.length * 0.5)
  let cut = text.length
  for (const marker of TRAILING_BOILERPLATE) {
    const idx = text.indexOf(marker, from)
    if (idx !== -1 && idx < cut) cut = idx
  }
  return cut === text.length ? text : text.slice(0, cut).trimEnd()
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
  // 上限は ARTICLE_BODY_MAX_CHARS。ここで削った分は要約にも載らないため、
  // 削る場合は文の区切りまで戻し、切ったことが分かる注記を付ける (bodyText.ts)。
  return truncateBody(stripTrailingBoilerplate(text), config.articleBodyMaxChars)
}

type FetchedArticle = { text: string | null; ogImage: string | null }

type AttemptResult =
  | { ok: true; text: string; ogImage: string | null }
  | { ok: false; error: string; retryable: boolean; ogImage: string | null }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchAttempt(url: string): Promise<AttemptResult> {
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
    if (!res.ok) {
      // 5xx は一時的とみなしリトライ、4xx は永続失敗
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        retryable: res.status >= 500,
        ogImage: null,
      }
    }
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!ct.includes('html')) {
      return {
        ok: false,
        error: `non-html content-type: ${ct || 'empty'}`,
        retryable: false,
        ogImage: null,
      }
    }
    const html = await res.text()
    const text = extractTextFromHtml(html)
    const ogImage = extractOgImageFromHtml(html, url)
    if (text.length < 100) {
      // 本文が短すぎる場合はリトライしても同じ結果になる。ogImage は保持。
      return {
        ok: false,
        error: `extracted text too short (${text.length} chars)`,
        retryable: false,
        ogImage,
      }
    }
    return { ok: true, text, ogImage }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    return { ok: false, error: e.message || String(e), retryable: true, ogImage: null }
  }
}

/**
 * 記事 URL の本文と og:image を取得する。
 * - リトライ可能なエラー (ネットワーク失敗 / HTTP 5xx) は最大 {@link MAX_RETRIES} 回までリトライ
 * - リトライ不可なエラー (HTTP 4xx / 非 HTML / 本文短すぎ) は即時諦める
 * - 各失敗は console.warn、最終失敗は console.error に出力
 * - 本文取得失敗時でも og:image が取れていれば保持して返す
 */
export async function fetchArticle(url: string): Promise<FetchedArticle> {
  let bestOgImage: string | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = await fetchAttempt(url)
    if (r.ok) {
      return { text: r.text, ogImage: r.ogImage ?? bestOgImage }
    }
    if (r.ogImage) bestOgImage = r.ogImage

    const tag = `(attempt ${attempt + 1}/${MAX_RETRIES + 1})`
    const isLast = attempt === MAX_RETRIES
    if (!r.retryable) {
      console.error(`[enrich] fetch 失敗 ${tag} ${url} - ${r.error} (リトライ不可)`)
      return { text: null, ogImage: bestOgImage }
    }
    if (isLast) {
      console.error(`[enrich] fetch 失敗 ${tag} ${url} - ${r.error} (リトライ上限)`)
      return { text: null, ogImage: bestOgImage }
    }
    console.warn(`[enrich] fetch 失敗 ${tag} ${url} - ${r.error} → リトライ`)
    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
  }
  return { text: null, ogImage: bestOgImage }
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
  const fetched = await withConcurrency(items, MAX_CONCURRENT, async (it) => fetchArticle(it.url))
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAnthropicBlog, fetchZenn, fetchQiita } from './fetcher.js'

// lookback 期間 (既定 7 日) の内側に入るよう、実行時刻からの相対で日付を作る
function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

const ANTHROPIC_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.anthropic.com/news/claude-next-model</loc>
    <lastmod>${daysAgoIso(1)}</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/research/interpretability-update</loc>
    <lastmod>${daysAgoIso(2)}</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/pricing</loc>
    <lastmod>${daysAgoIso(1)}</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/news/very-old-post</loc>
    <lastmod>${daysAgoIso(365)}</lastmod>
  </url>
</urlset>`

const ZENN_ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Claude Code 入門</title>
    <link href="https://zenn.dev/user/articles/abc123" rel="alternate" type="text/html"/>
    <published>2026-06-10T00:00:00Z</published>
  </entry>
  <entry>
    <title type="html">Anthropic の新モデル解説</title>
    <link href="https://zenn.dev/user/articles/def456" rel="alternate" type="text/html"/>
    <published>2026-06-09T00:00:00Z</published>
  </entry>
</feed>`

const QIITA_RESPONSE = [
  { title: 'Claude API 完全ガイド', url: 'https://qiita.com/user/items/aaa', created_at: '2026-06-10T00:00:00+09:00', likes_count: 120 },
  { title: 'Anthropic SDK 入門', url: 'https://qiita.com/user/items/bbb', created_at: '2026-06-09T00:00:00+09:00', likes_count: 80 },
]

describe('fetchAnthropicBlog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ANTHROPIC_SITEMAP,
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sitemap の loc / lastmod をパースして NewsItem にする', async () => {
    const items = await fetchAnthropicBlog()
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]!.source).toBe('anthropic-blog')
    expect(items[0]!.url).toBe('https://www.anthropic.com/news/claude-next-model')
    expect(items[0]!.title).toBe('Claude Next Model')
    expect(Number.isNaN(items[0]!.publishedAt.getTime())).toBe(false)
  })

  it('news / research / engineering 以外のパスを除外する', async () => {
    const items = await fetchAnthropicBlog()
    expect(items.map((i) => i.url)).not.toContain('https://www.anthropic.com/pricing')
  })

  it('lookback 期間より古い記事を除外する', async () => {
    const items = await fetchAnthropicBlog()
    expect(items.map((i) => i.url)).not.toContain('https://www.anthropic.com/news/very-old-post')
  })

  it('url ノードが 1 件だけでも配列として扱う', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<urlset><url><loc>https://www.anthropic.com/news/solo</loc><lastmod>${daysAgoIso(1)}</lastmod></url></urlset>`,
    }))
    const items = await fetchAnthropicBlog()
    expect(items).toHaveLength(1)
    expect(items[0]!.url).toBe('https://www.anthropic.com/news/solo')
  })

  it('throws when HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(fetchAnthropicBlog()).rejects.toThrow('500')
  })
})

describe('fetchZenn', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ZENN_ATOM_FEED,
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns NewsItems with source=zenn', async () => {
    const items = await fetchZenn()
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]!.source).toBe('zenn')
  })

  it('parses title and url correctly', async () => {
    const items = await fetchZenn()
    expect(items[0]!.title).toBe('Claude Code 入門')
    expect(items[0]!.url).toBe('https://zenn.dev/user/articles/abc123')
  })

  it('sorts by publishedAt descending', async () => {
    const items = await fetchZenn()
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.publishedAt.getTime()).toBeGreaterThanOrEqual(items[i]!.publishedAt.getTime())
    }
  })

  it('throws when HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(fetchZenn()).rejects.toThrow('503')
  })
})

describe('fetchQiita', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => QIITA_RESPONSE,
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns NewsItems with source=qiita', async () => {
    const items = await fetchQiita()
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]!.source).toBe('qiita')
  })

  it('parses title and url correctly', async () => {
    const items = await fetchQiita()
    const titles = items.map((i) => i.title)
    expect(titles).toContain('Claude API 完全ガイド')
  })

  it('sorts by score descending', async () => {
    const items = await fetchQiita()
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.score ?? 0).toBeGreaterThanOrEqual(items[i]!.score ?? 0)
    }
  })

  it('deduplicates by URL across tags', async () => {
    const dupeResponse = [...QIITA_RESPONSE, QIITA_RESPONSE[0]!]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => dupeResponse,
    }))
    const items = await fetchQiita()
    const urls = items.map((i) => i.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('throws when HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(fetchQiita()).rejects.toThrow('429')
  })
})

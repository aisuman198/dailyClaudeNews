import { describe, expect, it } from 'vitest'
import { dedupe, jaccardSimilarity, normalizeTitle, normalizeUrl } from './deduper.js'
import type { NewsItem } from './types.js'

const item = (over: Partial<NewsItem> = {}): NewsItem => ({
  source: 'hacker-news',
  title: 'sample',
  url: 'https://example.com/a',
  publishedAt: new Date('2026-06-01T00:00:00Z'),
  ...over,
})

describe('normalizeUrl', () => {
  it('strips www and trailing slash, drops tracking params', () => {
    expect(normalizeUrl('https://www.Example.com/path/?utm_source=x&id=1#frag'))
      .toBe('https://example.com/path/?id=1')
  })

  it('keeps path-only slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('upgrades http to https', () => {
    expect(normalizeUrl('http://example.com/a')).toBe('https://example.com/a')
  })

  it('returns lowercased input on parse failure', () => {
    expect(normalizeUrl('not a url')).toBe('not a url')
  })
})

describe('normalizeTitle', () => {
  it('lowercases and collapses spaces and removes symbols', () => {
    expect(normalizeTitle('  Claude 4!! launched -- Anthropic  '))
      .toBe('claude 4 launched anthropic')
  })

  it('handles full-width and half-width unification (NFKC)', () => {
    expect(normalizeTitle('ＡＩ ニュース')).toBe('ai ニュース')
  })
})

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(jaccardSimilarity('hello world', 'hello world')).toBe(1)
  })

  it('returns 0 for empty input', () => {
    expect(jaccardSimilarity('', 'hello')).toBe(0)
  })

  it('detects similar phrasing above threshold', () => {
    const a = normalizeTitle('Claude 4 launched by Anthropic')
    const b = normalizeTitle('Anthropic launches Claude 4')
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.3)
  })
})

describe('dedupe', () => {
  it('merges items with identical normalized URL, preferring anthropic-blog', () => {
    const items: NewsItem[] = [
      item({ source: 'hacker-news', title: 'HN repost', url: 'https://www.example.com/news?utm_source=hn' }),
      item({ source: 'anthropic-blog', title: 'Official', url: 'https://example.com/news' }),
    ]
    const out = dedupe(items)
    expect(out).toHaveLength(1)
    expect(out[0]!.source).toBe('anthropic-blog')
    expect(out[0]!.title).toBe('Official')
    expect(out[0]!.mergedFrom).toContain('https://www.example.com/news?utm_source=hn')
  })

  it('keeps the newer of two same-source duplicates', () => {
    const older = item({ source: 'hacker-news', title: 'Same exact title', url: 'https://a.test/1', publishedAt: new Date('2026-05-01') })
    const newer = item({ source: 'hacker-news', title: 'Same exact title', url: 'https://b.test/2', publishedAt: new Date('2026-06-01') })
    const out = dedupe([older, newer])
    expect(out).toHaveLength(1)
    expect(out[0]!.url).toBe('https://b.test/2')
    expect(out[0]!.mergedFrom).toEqual(['https://a.test/1'])
  })

  it('treats unrelated titles as distinct', () => {
    const a = item({ title: 'OpenAI ships GPT-5', url: 'https://a.test/1' })
    const b = item({ title: 'Gemini Ultra updates', url: 'https://b.test/2' })
    const out = dedupe([a, b])
    expect(out).toHaveLength(2)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsItem } from './types.js'

const mk = (over: Partial<NewsItem> = {}): NewsItem => ({
  source: 'hacker-news',
  title: 'sample',
  url: 'https://example.com/x',
  publishedAt: new Date('2026-06-01T00:00:00Z'),
  score: 0,
  ...over,
})

beforeEach(() => {
  process.env.PRIORITY_KEYWORDS = 'Anthropic,Claude,Codex'
  process.env.PRIORITY_MIN_NO_PAD = '5'
  process.env.PRIORITY_PAD_TARGET = '10'
  vi.resetModules()
})

afterEach(() => {
  delete process.env.PRIORITY_KEYWORDS
  delete process.env.PRIORITY_MIN_NO_PAD
  delete process.env.PRIORITY_PAD_TARGET
})

async function load() {
  return (await import('./priorityFilter.js')) as typeof import('./priorityFilter.js')
}

describe('isPriorityItem', () => {
  it('matches Anthropic in title', async () => {
    const { isPriorityItem } = await load()
    expect(isPriorityItem(mk({ title: 'Anthropic raises Series H' }), ['Anthropic'])).toBe(true)
  })

  it('matches Claude as whole word, not as substring', async () => {
    const { isPriorityItem } = await load()
    expect(isPriorityItem(mk({ title: 'Claude Opus 4.8' }), ['Claude'])).toBe(true)
    expect(isPriorityItem(mk({ title: 'cloud computing news' }), ['Claude'])).toBe(false)
  })

  it('matches Codex in URL path', async () => {
    const { isPriorityItem } = await load()
    expect(isPriorityItem(mk({ url: 'https://openai.com/codex/release' }), ['Codex'])).toBe(true)
  })

  it('returns false when no keyword matches', async () => {
    const { isPriorityItem } = await load()
    expect(isPriorityItem(mk({ title: 'Gemini Ultra updates' }), ['Anthropic', 'Claude', 'Codex'])).toBe(false)
  })

  it('is case-insensitive', async () => {
    const { isPriorityItem } = await load()
    expect(isPriorityItem(mk({ title: 'ANTHROPIC news' }), ['anthropic'])).toBe(true)
  })
})

describe('prioritizeAndPad', () => {
  it('returns priority items only when count > minNoPad (5)', async () => {
    const { prioritizeAndPad } = await load()
    const items = [
      ...Array.from({ length: 6 }, (_, i) => mk({ title: `Claude #${i}`, url: `https://a.test/${i}`, score: i + 1 })),
      mk({ title: 'Unrelated 1', url: 'https://u.test/1', score: 999 }),
      mk({ title: 'Unrelated 2', url: 'https://u.test/2', score: 1000 }),
    ]
    const { items: result, stats } = prioritizeAndPad(items)
    expect(stats.priorityCount).toBe(6)
    expect(stats.paddedCount).toBe(0)
    expect(result).toHaveLength(6)
    expect(result.every((i) => i.title.includes('Claude'))).toBe(true)
  })

  it('pads with non-priority items when priority count <= 5, reaching padTarget (10)', async () => {
    const { prioritizeAndPad } = await load()
    const items = [
      ...Array.from({ length: 3 }, (_, i) => mk({ title: `Anthropic #${i}`, url: `https://a.test/${i}`, score: i + 1 })),
      ...Array.from({ length: 15 }, (_, i) => mk({ title: `Other #${i}`, url: `https://o.test/${i}`, score: 100 - i })),
    ]
    const { items: result, stats } = prioritizeAndPad(items)
    expect(stats.priorityCount).toBe(3)
    expect(stats.paddedCount).toBe(7)
    expect(stats.total).toBe(10)
    expect(result).toHaveLength(10)
  })

  it('handles priority count == 5 (edge of "5以下") by padding', async () => {
    const { prioritizeAndPad } = await load()
    const items = [
      ...Array.from({ length: 5 }, (_, i) => mk({ title: `Claude #${i}`, url: `https://c.test/${i}`, score: 10 })),
      ...Array.from({ length: 20 }, (_, i) => mk({ title: `Misc #${i}`, url: `https://m.test/${i}`, score: 1 })),
    ]
    const { items: result, stats } = prioritizeAndPad(items)
    expect(stats.priorityCount).toBe(5)
    expect(stats.paddedCount).toBe(5)
    expect(result).toHaveLength(10)
  })

  it('returns all items if total less than padTarget', async () => {
    const { prioritizeAndPad } = await load()
    const items = [
      mk({ title: 'Anthropic news', url: 'https://a.test/1', score: 5 }),
      mk({ title: 'Other 1', url: 'https://o.test/1', score: 3 }),
    ]
    const { items: result, stats } = prioritizeAndPad(items)
    expect(stats.priorityCount).toBe(1)
    expect(stats.paddedCount).toBe(1)
    expect(result).toHaveLength(2)
  })

  it('selects filler in score descending order', async () => {
    const { prioritizeAndPad } = await load()
    const items = [
      mk({ title: 'Anthropic A', url: 'https://a.test/1', score: 10 }),
      mk({ title: 'Other low', url: 'https://o.test/low', score: 1 }),
      mk({ title: 'Other mid', url: 'https://o.test/mid', score: 50 }),
      mk({ title: 'Other high', url: 'https://o.test/high', score: 100 }),
    ]
    const { items: result, stats } = prioritizeAndPad(items)
    expect(stats.total).toBe(4)
    // result is sorted by importance, but the filler set should include the 3 highest-scored "others"
    const urls = result.map((i) => i.url)
    expect(urls).toContain('https://o.test/high')
    expect(urls).toContain('https://o.test/mid')
    expect(urls).toContain('https://o.test/low')
  })

  it('returns items untouched when priorityKeywords is empty', async () => {
    process.env.PRIORITY_KEYWORDS = ''
    vi.resetModules()
    const { prioritizeAndPad } = await load()
    const items = [mk({ title: 'A' }), mk({ title: 'B' })]
    const { items: result, stats } = prioritizeAndPad(items)
    expect(result).toEqual(items)
    expect(stats.paddedCount).toBe(0)
  })
})

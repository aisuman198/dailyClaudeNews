import { describe, expect, it } from 'vitest'
import { buildPrompt } from './summarizer.js'
import type { NewsItem } from './types.js'

const it1: NewsItem = {
  source: 'anthropic-blog',
  title: 'Anthropic releases X',
  url: 'https://example.com/x',
  publishedAt: new Date('2026-06-01T00:00:00Z'),
  summary: 'desc',
}

const it2: NewsItem = {
  source: 'hacker-news',
  title: 'Old recurring',
  url: 'https://example.com/old',
  publishedAt: new Date('2026-05-25T00:00:00Z'),
  firstSeenDate: '2026-05-25',
  occurrences: 5,
}

describe('summarizer.buildPrompt', () => {
  it('includes the dedup-final-judgment instruction', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('# 重複の最終判断')
    expect(p).toContain('関連リンク')
  })

  it('forbids inference and speculative phrasing', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('# 推論の禁止')
    expect(p).toContain('とみられる')
    expect(p).toContain('解釈表現は禁止')
  })

  it('asks for category-based chapters', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('## カテゴリ別まとめ')
    expect(p).toContain('### カテゴリ名')
    expect(p).toContain('プロダクト・モデルリリース')
  })

  it('embeds fresh and recurring input section counts', () => {
    const p = buildPrompt([it1, it1], [it2])
    expect(p).toContain('新規話題（2件）')
    expect(p).toContain('継続話題（1件）')
  })

  it('serializes items as JSON sections', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('"title": "Anthropic releases X"')
    expect(p).toContain('"firstSeenDate": "2026-05-25"')
    expect(p).toContain('"occurrences": 5')
  })

  it('does not request an editor note section', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).not.toContain('## 編集後記')
    expect(p).toContain('主観的セクションは作らない')
  })
})

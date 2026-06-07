import { describe, expect, it } from 'vitest'
import type { Caution } from './cautionStore.js'
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
    expect(p).toContain('# 出典の取得')
    expect(p).toContain('bodyText')
    expect(p).toContain('とみられる')
  })

  it('forbids escape phrases like "詳細は原文参照"', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('詳細は原文参照')
    expect(p).toContain('逃げ文句')
    expect(p).toContain('禁止')
  })

  it('imposes no upper bound on summary length and uses pre-fetched bodyText', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).not.toContain('約3行')
    expect(p).toContain('上限はありません')
    expect(p).toContain('bodyText')
    expect(p).toContain('本文取得失敗')
  })

  it('puts Japanese translation in the title link and original as a subtitle for English titles', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('# 英語記事の表記')
    expect(p).toContain('日本語で読めることを最優先')
    expect(p).toContain('原題')
    expect(p).toContain('<sub>**原題**:')
    expect(p).not.toContain('- 訳:')
  })

  it('asks for category-based chapters', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('## カテゴリ別まとめ')
    expect(p).toContain('### カテゴリ名')
    expect(p).toContain('プロダクト・モデルリリース')
  })

  it('requests card-style output (title link, sub meta, paragraph summary)', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('カード形式')
    expect(p).toContain('[タイトル](URL)')
    expect(p).toContain('<sub>')
    expect(p).toContain('段落として')
    expect(p).toContain('箇条書きにしない')
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

  it('includes known caution rules when provided', () => {
    const caution: Caution = {
      term: 'OpenRouter',
      rule: '原文ママで表記',
      firstSeenDate: '2026-06-01',
      lastSeenDate: '2026-06-01',
      occurrences: 1,
      examples: [],
    }
    const p = buildPrompt([it1], [it2], [caution])
    expect(p).toContain('# 既知の用語表記ルール')
    expect(p).toContain('OpenRouter')
    expect(p).toContain('原文ママで表記')
  })

  it('omits the known cautions section when list is empty', () => {
    const p = buildPrompt([it1], [it2], [])
    expect(p).not.toContain('# 既知の用語表記ルール')
  })
})

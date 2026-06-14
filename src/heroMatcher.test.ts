import { describe, expect, it } from 'vitest'
import {
  extractHighlights,
  pickHeroArticles,
  pickHeroImages,
  pickHeroMatches,
} from './heroMatcher.js'
import type { NewsItem } from './types.js'

const sampleMd = `## 本日のハイライト
- Anthropic が Series H で 650 億ドルを調達、評価額 9,650 億ドル突破
- Claude Code に Dynamic Workflows 機能が research preview として公開
- Anthropic Labs の新製品 Claude Design が research preview 公開

## カテゴリ別まとめ

### プロダクト・モデルリリース（3件）

#### [Dynamic Workflows in Claude Code](https://claude.com/blog/dynamic-workflows)
本文...
`

function mkItem(p: Partial<NewsItem> & { title: string; url: string }): NewsItem {
  return {
    source: 'anthropic-blog',
    publishedAt: new Date('2026-05-28'),
    ...p,
  }
}

describe('heroMatcher.extractHighlights', () => {
  it('extracts up to 3 bullet lines under "## 本日のハイライト"', () => {
    expect(extractHighlights(sampleMd)).toEqual([
      'Anthropic が Series H で 650 億ドルを調達、評価額 9,650 億ドル突破',
      'Claude Code に Dynamic Workflows 機能が research preview として公開',
      'Anthropic Labs の新製品 Claude Design が research preview 公開',
    ])
  })

  it('stops at the next ## heading', () => {
    const md = '## 本日のハイライト\n- one\n- two\n\n## カテゴリ別まとめ\n- not a highlight\n'
    expect(extractHighlights(md)).toEqual(['one', 'two'])
  })

  it('caps at 3 bullets even if more exist', () => {
    const md = '## 本日のハイライト\n- a\n- b\n- c\n- d\n- e\n\n## next\n'
    expect(extractHighlights(md)).toEqual(['a', 'b', 'c'])
  })

  it('returns empty when heading missing', () => {
    expect(extractHighlights('## カテゴリ別まとめ\n- foo\n')).toEqual([])
  })

  it('handles asterisk bullets too', () => {
    const md = '## 本日のハイライト\n* foo\n* bar\n\n## next\n'
    expect(extractHighlights(md)).toEqual(['foo', 'bar'])
  })
})

describe('heroMatcher.pickHeroArticles', () => {
  const items = [
    mkItem({
      title: 'Series H',
      url: 'https://www.anthropic.com/news/series-h',
    }),
    mkItem({
      title: 'Dynamic Workflows in Claude Code',
      url: 'https://claude.com/blog/dynamic-workflows',
    }),
    mkItem({
      title: 'Claude Design Anthropic Labs',
      url: 'https://www.anthropic.com/news/claude-design-anthropic-labs',
    }),
    mkItem({
      title: 'Coding Agents Social Sciences',
      url: 'https://www.anthropic.com/research/coding-agents',
    }),
  ]

  it('picks the best-matching article per highlight', () => {
    const picked = pickHeroArticles(sampleMd, items)
    expect(picked.map((p) => p.url)).toEqual([
      'https://www.anthropic.com/news/series-h',
      'https://claude.com/blog/dynamic-workflows',
      'https://www.anthropic.com/news/claude-design-anthropic-labs',
    ])
  })

  it('does not pick the same article twice', () => {
    // 3 つすべてが同じ記事にマッチしてもピックは 1 回だけ
    const dupItems = [
      mkItem({ title: 'Dynamic Workflows in Claude Code', url: 'https://x/a' }),
    ]
    const md = '## 本日のハイライト\n- Dynamic Workflows update\n- More Dynamic Workflows news\n- Another Dynamic Workflows note\n\n## カテゴリ別まとめ\n'
    expect(pickHeroArticles(md, dupItems)).toHaveLength(1)
  })

  it('skips highlights with no matching article (score 0)', () => {
    const md = '## 本日のハイライト\n- 完全に関係ない話\n- Series H で 650 億ドル\n- これも無関係\n\n## カテゴリ別まとめ\n'
    const picked = pickHeroArticles(md, items)
    expect(picked).toHaveLength(1)
    expect(picked[0]!.url).toBe('https://www.anthropic.com/news/series-h')
  })

  it('returns empty when no highlights', () => {
    expect(pickHeroArticles('## カテゴリ別まとめ\n', items)).toEqual([])
  })

  it('prefers Japanese title match over same-score English-only article (regression: TCS vs Fable)', () => {
    // 2026-06-13 のバグ再現: highlight[0] が TCS提携なのに Fable記事が選ばれていた。
    // 英語トークン "anthropic","claude" で両者が同点になるが、
    // 日本語バイグラムで TCS 記事（提携・発表・規制産業向け）が高スコアになるべき。
    const tcsArticle = mkItem({
      title: 'TCSとAnthropicが規制産業向けにClaudeを提供する提携を発表',
      url: 'https://www.anthropic.com/news/tcs',
    })
    const fableArticle = mkItem({
      title: 'Anthropicが Claude Fable の不可視ガードレールについて謝罪',
      url: 'https://www.theverge.com/fable',
    })
    const md = `## 本日のハイライト
- AnthropicがTCS（タタ・コンサルタンシー）との提携を発表。TCS社員5万人（56カ国）へのClaude提供と、金融・医療・公共セクター等の規制産業向け製品構築を開始する

## カテゴリ別まとめ
`
    const picked = pickHeroArticles(md, [fableArticle, tcsArticle])
    expect(picked[0]?.url).toBe('https://www.anthropic.com/news/tcs')
  })
})

describe('heroMatcher.pickHeroImages', () => {
  it('returns always length-3 array of og:image or null', () => {
    const items = [
      mkItem({
        title: 'Series H',
        url: 'https://www.anthropic.com/news/series-h',
        ogImage: 'https://cdn.anthropic.com/series-h.png',
      }),
      mkItem({
        title: 'Dynamic Workflows in Claude Code',
        url: 'https://claude.com/blog/dynamic-workflows',
        // no ogImage
      }),
      mkItem({
        title: 'Claude Design Anthropic Labs',
        url: 'https://www.anthropic.com/news/claude-design-anthropic-labs',
        ogImage: 'https://cdn.anthropic.com/design.png',
      }),
    ]
    expect(pickHeroImages(sampleMd, items)).toEqual([
      'https://cdn.anthropic.com/series-h.png',
      null,
      'https://cdn.anthropic.com/design.png',
    ])
  })

  it('returns [null, null, null] when no highlights', () => {
    expect(pickHeroImages('', [])).toEqual([null, null, null])
  })
})

describe('heroMatcher.pickHeroMatches', () => {
  const items = [
    mkItem({
      title: 'Series H',
      url: 'https://www.anthropic.com/news/series-h',
      ogImage: 'https://cdn.anthropic.com/series-h.png',
    }),
    mkItem({
      title: 'Dynamic Workflows in Claude Code',
      url: 'https://claude.com/blog/dynamic-workflows',
      // no ogImage
    }),
    mkItem({
      title: 'Claude Design Anthropic Labs',
      url: 'https://www.anthropic.com/news/claude-design-anthropic-labs',
      ogImage: 'https://cdn.anthropic.com/design.png',
    }),
  ]

  it('returns one HeroMatch per highlight in order, with article_url + og_image', () => {
    expect(pickHeroMatches(sampleMd, items)).toEqual([
      {
        highlight: 'Anthropic が Series H で 650 億ドルを調達、評価額 9,650 億ドル突破',
        articleUrl: 'https://www.anthropic.com/news/series-h',
        ogImage: 'https://cdn.anthropic.com/series-h.png',
      },
      {
        highlight: 'Claude Code に Dynamic Workflows 機能が research preview として公開',
        articleUrl: 'https://claude.com/blog/dynamic-workflows',
        ogImage: null,
      },
      {
        highlight: 'Anthropic Labs の新製品 Claude Design が research preview 公開',
        articleUrl: 'https://www.anthropic.com/news/claude-design-anthropic-labs',
        ogImage: 'https://cdn.anthropic.com/design.png',
      },
    ])
  })

  it('keeps highlight with null article when no article matches (score 0)', () => {
    const md = '## 本日のハイライト\n- 完全に無関係な話題\n\n## カテゴリ別まとめ\n'
    expect(pickHeroMatches(md, items)).toEqual([
      { highlight: '完全に無関係な話題', articleUrl: null, ogImage: null },
    ])
  })

  it('does not assign the same article to two highlights', () => {
    const dupItems = [
      mkItem({ title: 'Dynamic Workflows in Claude Code', url: 'https://x/a', ogImage: 'https://x/a.png' }),
    ]
    const md =
      '## 本日のハイライト\n- Dynamic Workflows news\n- More Dynamic Workflows update\n\n## カテゴリ別まとめ\n'
    const matches = pickHeroMatches(md, dupItems)
    expect(matches[0]!.articleUrl).toBe('https://x/a')
    expect(matches[1]!.articleUrl).toBeNull()
  })

  it('returns empty array when no highlights', () => {
    expect(pickHeroMatches('## カテゴリ別まとめ\n', items)).toEqual([])
  })
})

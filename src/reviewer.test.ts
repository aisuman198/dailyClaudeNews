import { describe, expect, it } from 'vitest'
import type { Caution } from './cautionStore.js'
import { buildReviewPrompt, CAUTIONS_BEGIN, CAUTIONS_END, parseReviewOutput } from './reviewer.js'

const sampleMd = '## 本日のハイライト\n\n- foo\n\n## カテゴリ別まとめ\n'
const knownCaution: Caution = {
  term: 'OpenRouter',
  rule: '原文ママで表記',
  firstSeenDate: '2026-06-01',
  lastSeenDate: '2026-06-01',
  occurrences: 1,
  examples: [],
}

describe('reviewer.buildReviewPrompt', () => {
  it('includes review criteria and forbids content changes', () => {
    const p = buildReviewPrompt(sampleMd, [])
    expect(p).toContain('# レビュー観点')
    expect(p).toContain('不自然な日本語')
    expect(p).toContain('固有名詞')
    expect(p).toContain('オープンルーター')
    expect(p).toContain('事実の追加削除')
  })

  it('shows existing cautions when provided', () => {
    const p = buildReviewPrompt(sampleMd, [knownCaution])
    expect(p).toContain('# 既知の用語表記ルール')
    expect(p).toContain('OpenRouter')
    expect(p).toContain('原文ママで表記')
  })

  it('shows "初回" marker when no known cautions', () => {
    const p = buildReviewPrompt(sampleMd, [])
    expect(p).toContain('初回のレビュー')
  })

  it('includes delimiter format and input markdown', () => {
    const p = buildReviewPrompt(sampleMd, [])
    expect(p).toContain(CAUTIONS_BEGIN)
    expect(p).toContain(CAUTIONS_END)
    expect(p).toContain(sampleMd)
  })
})

describe('reviewer.parseReviewOutput', () => {
  it('splits markdown and JSON correctly', () => {
    const raw = `## 本日のハイライト\n\n本文...\n\n${CAUTIONS_BEGIN}\n{"cautions":[{"term":"OpenRouter","rule":"原文ママで表記","context":"訳されていた"}]}\n${CAUTIONS_END}\n`
    const result = parseReviewOutput(raw)
    expect(result.correctedMarkdown).toBe('## 本日のハイライト\n\n本文...')
    expect(result.newCautions).toHaveLength(1)
    expect(result.newCautions[0]!.term).toBe('OpenRouter')
    expect(result.newCautions[0]!.context).toBe('訳されていた')
  })

  it('returns empty cautions on empty array', () => {
    const raw = `## 本日のハイライト\n\n本文...\n\n${CAUTIONS_BEGIN}{"cautions":[]}${CAUTIONS_END}`
    const result = parseReviewOutput(raw)
    expect(result.newCautions).toEqual([])
  })

  it('falls back to whole-output as markdown when delimiters missing', () => {
    const raw = '## 本日のハイライト\n\n本文だけ\n'
    const result = parseReviewOutput(raw)
    expect(result.correctedMarkdown).toBe('## 本日のハイライト\n\n本文だけ')
    expect(result.newCautions).toEqual([])
  })

  it('strips reviewer preamble before "## 本日のハイライト"', () => {
    const raw = `修正前に内容を精査します。\n\n主な発見:\n1. 誤訳1\n2. 誤訳2\n\n---\n\n## 本日のハイライト\n\n- foo\n\n${CAUTIONS_BEGIN}{"cautions":[]}${CAUTIONS_END}`
    const result = parseReviewOutput(raw)
    expect(result.correctedMarkdown).toBe('## 本日のハイライト\n\n- foo')
    expect(result.correctedMarkdown).not.toContain('修正前に内容を精査')
  })

  it('falls back to empty cautions when JSON is malformed', () => {
    const raw = `## 本日のハイライト\n\n本文\n${CAUTIONS_BEGIN}\nnot a json\n${CAUTIONS_END}`
    const result = parseReviewOutput(raw)
    expect(result.correctedMarkdown).toBe('## 本日のハイライト\n\n本文')
    expect(result.newCautions).toEqual([])
  })

  it('filters out entries with empty term', () => {
    const raw = `MD\n${CAUTIONS_BEGIN}{"cautions":[{"term":"","rule":"x"},{"term":"OK","rule":"r"}]}${CAUTIONS_END}`
    const result = parseReviewOutput(raw)
    expect(result.newCautions).toHaveLength(1)
    expect(result.newCautions[0]!.term).toBe('OK')
  })

  it('defaults rule to 原文ママで表記 when missing', () => {
    const raw = `MD\n${CAUTIONS_BEGIN}{"cautions":[{"term":"Foo"}]}${CAUTIONS_END}`
    const result = parseReviewOutput(raw)
    expect(result.newCautions[0]!.rule).toBe('原文ママで表記')
  })
})

import { describe, expect, it } from 'vitest'
import { categorize } from './errorCategory.js'

describe('categorize', () => {
  it('classifies summarize timeout as category:timeout with stable title', () => {
    const c = categorize(new Error('claude タイムアウト (1200000ms)'), 'summarize')
    expect(c.category).toBe('timeout')
    expect(c.title).toBe('[dailyClaudeNews] timeout: summarize')
    expect(c.labels).toContain('category:timeout')
    expect(c.labels).toContain('phase:summarize')
  })

  it('classifies review timeout with the review phase', () => {
    const c = categorize(new Error('claude (reviewer) タイムアウト (1200000ms)'), 'review')
    expect(c.category).toBe('timeout')
    expect(c.title).toBe('[dailyClaudeNews] timeout: review')
  })

  it('classifies English "timeout" messages too', () => {
    const c = categorize(new Error('Request timed out after 30s'), 'fetch')
    expect(c.category).toBe('timeout')
    expect(c.title).toBe('[dailyClaudeNews] timeout: fetch')
  })

  it('classifies rate-limit messages distinctly from timeout', () => {
    const c = categorize(new Error('Max usage limit exceeded (5h window)'), 'summarize')
    expect(c.category).toBe('rate-limit')
    expect(c.title).toBe('[dailyClaudeNews] rate-limit: summarize')
  })

  it('classifies fetch phase non-timeout failures as fetch with stable title', () => {
    const c = categorize(new Error('全ソースの取得に失敗しました'), 'fetch')
    expect(c.category).toBe('fetch')
    expect(c.title).toBe('[dailyClaudeNews] fetch 失敗')
  })

  it('classifies git phase non-timeout failures as git', () => {
    const c = categorize(new Error('git push origin main failed (1)'), 'git')
    expect(c.category).toBe('git')
    expect(c.title).toBe('[dailyClaudeNews] git push 失敗')
  })

  it('falls back to unknown for other errors', () => {
    const c = categorize(new Error('something weird'), 'write')
    expect(c.category).toBe('unknown')
    expect(c.title).toBe('[dailyClaudeNews] write エラー')
  })
})

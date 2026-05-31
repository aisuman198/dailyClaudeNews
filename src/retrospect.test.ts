import { describe, expect, it } from 'vitest'
import { fingerprint, isFixable } from './retrospect.js'

describe('fingerprint', () => {
  it('strips date strings so day-to-day occurrences match', () => {
    expect(fingerprint('[dailyClaudeNews] 2026-06-01 summarize で失敗'))
      .toBe(fingerprint('[dailyClaudeNews] 2026-06-02 summarize で失敗'))
  })

  it('strips the [dailyClaudeNews] prefix', () => {
    expect(fingerprint('[dailyClaudeNews] git push 失敗'))
      .toBe(fingerprint('git push 失敗'))
  })

  it('normalizes whitespace and is case-insensitive', () => {
    expect(fingerprint('  GIT  PUSH   失敗  '))
      .toBe(fingerprint('git push 失敗'))
  })

  it('distinguishes substantively different titles', () => {
    expect(fingerprint('[dailyClaudeNews] timeout: summarize'))
      .not.toBe(fingerprint('[dailyClaudeNews] timeout: review'))
  })
})

describe('isFixable', () => {
  it('returns false for timeout titles', () => {
    expect(isFixable('[dailyClaudeNews] timeout: summarize', ['dailyClaudeNews', 'category:timeout'])).toBe(false)
  })

  it('returns false when category:timeout label is present', () => {
    expect(isFixable('[dailyClaudeNews] summarize エラー', ['dailyClaudeNews', 'category:timeout'])).toBe(false)
  })

  it('returns false for rate-limit titles', () => {
    expect(isFixable('[dailyClaudeNews] rate-limit: review', ['dailyClaudeNews', 'category:rate-limit'])).toBe(false)
  })

  it('returns false for "5時間" / "quota" mentions', () => {
    expect(isFixable('[dailyClaudeNews] 5時間枠を超過しました', ['dailyClaudeNews'])).toBe(false)
    expect(isFixable('[dailyClaudeNews] quota exceeded', ['dailyClaudeNews'])).toBe(false)
  })

  it('returns true for novel code-shaped errors', () => {
    expect(isFixable('[dailyClaudeNews] write エラー', ['dailyClaudeNews', 'category:unknown'])).toBe(true)
    expect(isFixable('[dailyClaudeNews] git push 失敗', ['dailyClaudeNews', 'category:git'])).toBe(true)
  })

  it('returns false for article-fetch category (timeouts on URL fetching)', () => {
    expect(isFixable('[dailyClaudeNews] 記事取得タイムアウト', ['dailyClaudeNews', 'category:article-fetch'])).toBe(false)
    expect(isFixable('[dailyClaudeNews] 記事取得失敗', ['dailyClaudeNews', 'category:article-fetch'])).toBe(false)
  })
})

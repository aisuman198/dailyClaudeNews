import { describe, expect, it } from 'vitest'
import { fingerprint, isFixable, todayJst, todaysIssueSearch } from './retrospect.js'

describe('todayJst', () => {
  it('returns the JST calendar date (UTC + 9h)', () => {
    // JST 09:00 (= retrospect の起動時刻) は同日
    expect(todayJst(new Date('2026-06-23T00:00:00Z'))).toBe('2026-06-23')
  })

  it('rolls the date forward at the JST midnight boundary (UTC 15:00)', () => {
    expect(todayJst(new Date('2026-06-22T14:59:59Z'))).toBe('2026-06-22')
    expect(todayJst(new Date('2026-06-22T15:00:00Z'))).toBe('2026-06-23')
  })
})

describe('todaysIssueSearch', () => {
  it('uses a JST-timezone-aware lower bound (not a bare UTC date)', () => {
    expect(todaysIssueSearch(new Date('2026-06-23T00:00:00Z')))
      .toBe('created:>=2026-06-23T00:00:00+09:00')
  })

  it('matches an issue created by the run job at JST 08:00 (= prev-day 23:00Z)', () => {
    // 回帰テスト: issue #58 は createdAt=2026-06-22T23:00:29Z (= JST 06-23 08:00)。
    // retrospect は JST 06-23 09:00 (= 2026-06-23T00:00Z) に走る。
    const query = todaysIssueSearch(new Date('2026-06-23T00:00:00Z'))
    const lowerBound = new Date(query.replace('created:>=', ''))
    const issue58CreatedAt = new Date('2026-06-22T23:00:29Z')
    // 旧実装 (created:>=2026-06-23 = UTC 00:00) では取りこぼしていた issue が
    // 新しい下限 (JST 00:00 = 2026-06-22T15:00Z) ではヒットする。
    expect(issue58CreatedAt.getTime()).toBeGreaterThanOrEqual(lowerBound.getTime())
    expect(new Date('2026-06-23T00:00:00Z')).not.toEqual(lowerBound)
  })
})

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

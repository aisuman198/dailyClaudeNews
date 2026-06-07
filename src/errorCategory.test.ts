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

  it('article fetch timeout collapses to a single title regardless of URL', () => {
    const a = categorize(new Error('Request timed out at https://example.com/a'), 'enrich-bodies')
    const b = categorize(new Error('タイムアウト fetching https://other.test/very/different/path'), 'enrich-bodies')
    expect(a.title).toBe('[dailyClaudeNews] 記事取得タイムアウト')
    expect(b.title).toBe(a.title)
    expect(a.category).toBe('article-fetch')
    expect(a.labels).toContain('category:article-fetch')
  })

  it('article fetch non-timeout failure uses the article-fetch failure title', () => {
    const c = categorize(new Error('socket hang up'), 'enrich-bodies')
    expect(c.category).toBe('article-fetch')
    expect(c.title).toBe('[dailyClaudeNews] 記事取得失敗')
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

  it('classifies git push failures as "git push 失敗"', () => {
    const c = categorize(new Error('git push origin main failed (1)'), 'git')
    expect(c.category).toBe('git')
    expect(c.title).toBe('[dailyClaudeNews] git push 失敗')
  })

  it('classifies PR create failures (gh pr create) as "PR 作成失敗"', () => {
    const c = categorize(
      new Error('gh pr create --base main --head daily/2026-06-07 failed (1): could not create pull request'),
      'git',
    )
    expect(c.category).toBe('git')
    expect(c.title).toBe('[dailyClaudeNews] PR 作成失敗')
  })

  it('classifies PR-number-parse failures as "PR 作成失敗"', () => {
    const c = categorize(
      new Error('PR 作成の出力から PR 番号を取得できませんでした: <unexpected output>'),
      'git',
    )
    expect(c.title).toBe('[dailyClaudeNews] PR 作成失敗')
  })

  it('classifies PR merge failures as "PR merge 失敗"', () => {
    const c = categorize(
      new Error('gh pr merge 42 --squash --delete-branch failed (1): mergeable state is blocked'),
      'git',
    )
    expect(c.category).toBe('git')
    expect(c.title).toBe('[dailyClaudeNews] PR merge 失敗')
  })

  it('classifies verify-deploy phase failures with stable title', () => {
    const c = categorize(
      new Error('verify-deploy: https://example.test/daily/2026-06-06.html がタイムアウト...'),
      'verify-deploy',
    )
    expect(c.category).toBe('verify-deploy')
    expect(c.title).toBe('[dailyClaudeNews] verify-deploy 失敗 (GitHub Pages 公開未確認)')
    expect(c.labels).toContain('category:verify-deploy')
    expect(c.labels).toContain('phase:verify-deploy')
  })

  it('falls back to unknown for other errors', () => {
    const c = categorize(new Error('something weird'), 'write')
    expect(c.category).toBe('unknown')
    expect(c.title).toBe('[dailyClaudeNews] write エラー')
  })
})

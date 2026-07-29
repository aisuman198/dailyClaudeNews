import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpHome: string

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dcn-notifier-'))
  process.env.HOME = tmpHome
  vi.resetModules()
})

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true })
})

async function loadNotifier() {
  return (await import('./notifier.js')) as typeof import('./notifier.js')
}

describe('notifier internals', () => {
  it('buildIssueBody wraps stack and run log in <details> blocks, summary outside', async () => {
    const logDir = path.join(tmpHome, 'Library/Logs/dailyClaudeNews')
    await fs.mkdir(logDir, { recursive: true })
    await fs.writeFile(
      path.join(logDir, 'run.log'),
      Array.from({ length: 35 }, (_, i) => `LINE-${i + 1}`).join('\n'),
      'utf8',
    )

    const { __test__ } = await loadNotifier()
    const body = __test__.buildIssueBody({
      date: '2026-06-01',
      phase: 'summarize',
      error: Object.assign(new Error('claude タイムアウト (1200000ms)'), {
        stack: 'Error: claude タイムアウト\n    at runClaude\n    at summarize',
      }),
      category: 'timeout',
    })

    // サマリーは details の外
    expect(body).toContain('## 概要')
    expect(body).toContain('**失敗フェーズ**: `summarize`')
    expect(body).toContain('**カテゴリ**: `timeout`')
    expect(body).toContain('claude タイムアウト (1200000ms)')

    // スタックトレースは details ブロック内
    expect(body).toContain('<details>')
    expect(body).toContain('<summary>スタックトレース</summary>')
    expect(body).toContain('at runClaude')

    // run.log 末尾30行が details ブロックで含まれる
    expect(body).toContain('<summary>直近のログ (run.log 末尾 30 行)</summary>')
    expect(body).toContain('LINE-35')
    expect(body).toContain('LINE-6')
    expect(body).not.toContain('LINE-5') // 30行に収まらないので除外
  })

  it('buildRecurrenceComment includes summary outside details and stack inside', async () => {
    const { __test__ } = await loadNotifier()
    const comment = __test__.buildRecurrenceComment({
      date: '2026-06-02',
      phase: 'review',
      error: Object.assign(new Error('claude (reviewer) タイムアウト (1200000ms)'), {
        stack: 'Error: review timeout\n    at reviewer',
      }),
    })

    expect(comment).toContain('### 再発: 2026-06-02')
    expect(comment).toContain('**フェーズ**: `review`')
    expect(comment).toContain('<details>')
    expect(comment).toContain('<summary>スタックトレース</summary>')
    expect(comment).toContain('at reviewer')
  })

  it('buildIssueBody omits the run log block when no log file exists', async () => {
    const { __test__ } = await loadNotifier()
    const body = __test__.buildIssueBody({
      date: '2026-06-01',
      phase: 'fetch',
      error: new Error('fetch failed'),
      category: 'fetch',
    })
    expect(body).not.toContain('run.log 末尾')
  })
})

describe('notifyFailure: Discord (エラー用チャンネル) への連携', () => {
  beforeEach(() => {
    process.env.MACOS_NOTIFICATION = 'false'
    process.env.ERROR_ISSUE_REPO = 'owner/repo'
  })

  it('新規起票した issue の URL を Discord に渡す', async () => {
    const notifyDiscordFailure = vi.fn(async () => ({ ok: true as const }))
    const issueUrl = 'https://github.com/owner/repo/issues/7'

    vi.doMock('./discord.js', () => ({ notifyDiscordFailure }))
    vi.doMock('./issueClient.js', () => ({
      ensureLabelExists: vi.fn(async () => {}),
      findOpenIssueByTitle: vi.fn(async () => null),
      addIssueComment: vi.fn(async () => {}),
      createIssue: vi.fn(async () => issueUrl),
    }))

    const { notifyFailure } = await loadNotifier()
    await notifyFailure(new Error('claude タイムアウト (1800000ms)'), { phase: 'summarize' })

    expect(notifyDiscordFailure).toHaveBeenCalledTimes(1)
    const ctx = notifyDiscordFailure.mock.calls[0][0] as { issueUrl: string | null; phase: string; category: string }
    expect(ctx.issueUrl).toBe(issueUrl)
    expect(ctx.phase).toBe('summarize')
    expect(ctx.category).toBe('timeout')
  })

  it('再発時は既存 issue の URL を渡す', async () => {
    const notifyDiscordFailure = vi.fn(async () => ({ ok: true as const }))
    const existingUrl = 'https://github.com/owner/repo/issues/3'

    vi.doMock('./discord.js', () => ({ notifyDiscordFailure }))
    vi.doMock('./issueClient.js', () => ({
      ensureLabelExists: vi.fn(async () => {}),
      findOpenIssueByTitle: vi.fn(async () => ({ number: 3, url: existingUrl })),
      addIssueComment: vi.fn(async () => {}),
      createIssue: vi.fn(async () => ''),
    }))

    const { notifyFailure } = await loadNotifier()
    await notifyFailure(new Error('fetch に失敗'), { phase: 'fetch' })

    const ctx = notifyDiscordFailure.mock.calls[0][0] as { issueUrl: string | null }
    expect(ctx.issueUrl).toBe(existingUrl)
  })

  it('issue 起票に失敗しても Discord には issueUrl:null で通知する', async () => {
    const notifyDiscordFailure = vi.fn(async () => ({ ok: true as const }))

    vi.doMock('./discord.js', () => ({ notifyDiscordFailure }))
    vi.doMock('./issueClient.js', () => ({
      ensureLabelExists: vi.fn(async () => {}),
      findOpenIssueByTitle: vi.fn(async () => null),
      addIssueComment: vi.fn(async () => {}),
      createIssue: vi.fn(async () => {
        throw new Error('gh issue create: HTTP 403')
      }),
    }))

    const { notifyFailure } = await loadNotifier()
    await notifyFailure(new Error('git push に失敗'), { phase: 'git' })

    const ctx = notifyDiscordFailure.mock.calls[0][0] as { issueUrl: string | null }
    expect(ctx.issueUrl).toBeNull()
  })

  it('Discord 投稿が失敗しても notifyFailure は例外を投げない', async () => {
    const notifyDiscordFailure = vi.fn(async () => ({ ok: false as const, reason: 'HTTP 500' }))

    vi.doMock('./discord.js', () => ({ notifyDiscordFailure }))
    vi.doMock('./issueClient.js', () => ({
      ensureLabelExists: vi.fn(async () => {}),
      findOpenIssueByTitle: vi.fn(async () => null),
      addIssueComment: vi.fn(async () => {}),
      createIssue: vi.fn(async () => 'https://github.com/owner/repo/issues/9'),
    }))

    const { notifyFailure } = await loadNotifier()
    await expect(notifyFailure(new Error('boom'), { phase: 'write' })).resolves.toBeUndefined()
  })
})


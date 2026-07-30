import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ERROR_HOOK = 'https://discord.com/api/webhooks/111/error-token'
const NEWS_HOOK = 'https://discord.com/api/webhooks/222/news-token'

const ENV_KEYS = [
  'DISCORD_NOTIFICATION',
  'DISCORD_ERROR_WEBHOOK_URL',
  'DISCORD_NEWS_WEBHOOK_URL',
  'DISCORD_TIMEOUT_MS',
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.DISCORD_ERROR_WEBHOOK_URL = ERROR_HOOK
  process.env.DISCORD_NEWS_WEBHOOK_URL = NEWS_HOOK
  delete process.env.DISCORD_NOTIFICATION
  vi.resetModules()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

async function loadDiscord() {
  return (await import('./discord.js')) as typeof import('./discord.js')
}

/** fetch のスタブ。呼び出し引数を記録し、任意のレスポンスを返す。 */
function stubFetch(res: { ok: boolean; status?: number; body?: string } = { ok: true, status: 204 }) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return {
      ok: res.ok,
      status: res.status ?? (res.ok ? 204 : 500),
      text: async () => res.body ?? '',
    } as unknown as Response
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const sampleFailure = (issueUrl: string | null) => ({
  date: '2026-07-29',
  phase: 'summarize' as const,
  category: 'timeout',
  error: new Error('claude タイムアウト (1800000ms)'),
  issueUrl,
})

describe('postToDiscord', () => {
  it('Webhook URL が空なら送信せずスキップを返す', async () => {
    const { postToDiscord } = await loadDiscord()
    const deps = stubFetch()
    const result = await postToDiscord('', { content: 'hi' }, deps)
    expect(result).toEqual({ ok: false, reason: 'Webhook URL が未設定' })
    expect(deps.calls).toHaveLength(0)
  })

  it('JSON ボディを POST し、成功時に ok:true を返す', async () => {
    const { postToDiscord } = await loadDiscord()
    const deps = stubFetch({ ok: true, status: 204 })
    const result = await postToDiscord(ERROR_HOOK, { content: 'テスト' }, deps)

    expect(result).toEqual({ ok: true })
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0].url).toBe(ERROR_HOOK)
    expect(deps.calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(deps.calls[0].init.body))).toEqual({ content: 'テスト' })
  })

  it('非 2xx はエラー理由を返す（例外は投げない）', async () => {
    const { postToDiscord } = await loadDiscord()
    const deps = stubFetch({ ok: false, status: 429, body: '{"retry_after":5}' })
    const result = await postToDiscord(ERROR_HOOK, { content: 'x' }, deps)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('HTTP 429')
  })

  it('ネットワーク例外を握りつぶして理由として返す', async () => {
    const { postToDiscord } = await loadDiscord()
    const failing = {
      fetch: (async () => {
        throw new Error('fetch failed')
      }) as unknown as typeof fetch,
    }
    const result = await postToDiscord(ERROR_HOOK, { content: 'x' }, failing)
    expect(result).toEqual({ ok: false, reason: 'fetch failed' })
  })

  it('例外メッセージに混ざった Webhook URL を伏字化する', async () => {
    const { postToDiscord } = await loadDiscord()
    const leaking = {
      fetch: (async () => {
        throw new Error(`request to ${ERROR_HOOK} failed`)
      }) as unknown as typeof fetch,
    }
    const result = await postToDiscord(ERROR_HOOK, { content: 'x' }, leaking)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).not.toContain('error-token')
    expect(result.ok === false && result.reason).toContain('[REDACTED:DISCORD_WEBHOOK]')
  })

  it('content を Discord の 2000 文字上限に切り詰める', async () => {
    const { postToDiscord } = await loadDiscord()
    const deps = stubFetch()
    await postToDiscord(ERROR_HOOK, { content: 'あ'.repeat(5000) }, deps)
    const sent = JSON.parse(String(deps.calls[0].init.body)) as { content: string }
    expect(sent.content.length).toBe(2000)
    expect(sent.content.endsWith('…(以下省略)')).toBe(true)
  })

  it('embed の各フィールドも上限内に収める', async () => {
    const { postToDiscord } = await loadDiscord()
    const deps = stubFetch()
    await postToDiscord(
      ERROR_HOOK,
      {
        embeds: [
          {
            title: 'T'.repeat(400),
            description: 'D'.repeat(6000),
            fields: [{ name: 'N', value: 'V'.repeat(2000) }],
          },
        ],
      },
      deps,
    )
    const sent = JSON.parse(String(deps.calls[0].init.body)) as {
      embeds: { title: string; description: string; fields: { value: string }[] }[]
    }
    expect(sent.embeds[0].title.length).toBe(256)
    expect(sent.embeds[0].description.length).toBe(4096)
    expect(sent.embeds[0].fields[0].value.length).toBe(1024)
  })
})

describe('buildFailurePayload', () => {
  it('エラーが出た旨と GitHub issue のリンクを含む', async () => {
    const { buildFailurePayload } = await loadDiscord()
    const issueUrl = 'https://github.com/aisuman198/dailyClaudeNews/issues/42'
    const payload = buildFailurePayload(sampleFailure(issueUrl))

    expect(payload.content).toContain('エラーが発生しました')
    // content 側にリンクを置くことで、埋め込みを畳んでいても踏める
    expect(payload.content).toContain(issueUrl)

    const embed = payload.embeds?.[0]
    expect(embed?.url).toBe(issueUrl)
    expect(embed?.title).toContain('summarize')
    expect(embed?.title).toContain('timeout')
    expect(embed?.description).toContain('claude タイムアウト')
    const issueField = embed?.fields?.find((f) => f.name === 'GitHub Issue')
    expect(issueField?.value).toBe(issueUrl)
  })

  it('issue を起票できなかった場合はその旨を出す', async () => {
    const { buildFailurePayload } = await loadDiscord()
    const payload = buildFailurePayload(sampleFailure(null))

    expect(payload.content).toContain('起票にも失敗')
    expect(payload.embeds?.[0].url).toBeUndefined()
    const issueField = payload.embeds?.[0].fields?.find((f) => f.name === 'GitHub Issue')
    expect(issueField?.value).toContain('起票できませんでした')
  })
})

describe('buildSuccessPayload', () => {
  it('公開した記事の URL と件数を日本語で含む', async () => {
    const { buildSuccessPayload } = await loadDiscord()
    const payload = buildSuccessPayload({
      date: '2026-07-29',
      articleUrl: 'https://aisuman198.github.io/dailyClaudeNews/daily/2026-07-29.html',
      freshCount: 7,
      recurringCount: 3,
      model: 'claude-sonnet-4-6',
    })

    expect(payload.content).toContain('https://aisuman198.github.io/dailyClaudeNews/daily/2026-07-29.html')
    expect(payload.content).toContain('2026-07-29')
    expect(payload.content).toContain('新規 7 件 / 継続 3 件')
    // 記事ページを Discord にカード展開させたいので埋め込みは付けない
    expect(payload.embeds).toBeUndefined()
  })
})

describe('通知先チャンネルの振り分け', () => {
  it('失敗はエラー用 Webhook へ送る', async () => {
    const { notifyDiscordFailure } = await loadDiscord()
    const deps = stubFetch()
    const result = await notifyDiscordFailure(sampleFailure('https://example.com/issues/1'), deps)

    expect(result).toEqual({ ok: true })
    expect(deps.calls[0].url).toBe(ERROR_HOOK)
  })

  it('成功は記事共有用の別 Webhook へ送る', async () => {
    const { notifyDiscordSuccess } = await loadDiscord()
    const deps = stubFetch()
    const result = await notifyDiscordSuccess(
      {
        date: '2026-07-29',
        articleUrl: 'https://example.com/daily/2026-07-29.html',
        freshCount: 1,
        recurringCount: 0,
        model: 'claude-sonnet-4-6',
      },
      deps,
    )

    expect(result).toEqual({ ok: true })
    expect(deps.calls[0].url).toBe(NEWS_HOOK)
    expect(deps.calls[0].url).not.toBe(ERROR_HOOK)
  })

  it('DISCORD_NOTIFICATION=false なら両方とも送らない', async () => {
    process.env.DISCORD_NOTIFICATION = 'false'
    vi.resetModules()
    const { notifyDiscordFailure, notifyDiscordSuccess } = await loadDiscord()
    const deps = stubFetch()

    const a = await notifyDiscordFailure(sampleFailure(null), deps)
    const b = await notifyDiscordSuccess(
      { date: '2026-07-29', articleUrl: 'https://example.com/x.html', freshCount: 0, recurringCount: 0, model: 'm' },
      deps,
    )

    expect(a).toEqual({ ok: false, reason: 'DISCORD_NOTIFICATION=false' })
    expect(b).toEqual({ ok: false, reason: 'DISCORD_NOTIFICATION=false' })
    expect(deps.calls).toHaveLength(0)
  })

  it('Webhook URL 未設定なら送信せずスキップする', async () => {
    delete process.env.DISCORD_NEWS_WEBHOOK_URL
    vi.resetModules()
    const { notifyDiscordSuccess } = await loadDiscord()
    const deps = stubFetch()
    const result = await notifyDiscordSuccess(
      { date: '2026-07-29', articleUrl: 'https://example.com/x.html', freshCount: 0, recurringCount: 0, model: 'm' },
      deps,
    )
    expect(result).toEqual({ ok: false, reason: 'Webhook URL が未設定' })
    expect(deps.calls).toHaveLength(0)
  })
})

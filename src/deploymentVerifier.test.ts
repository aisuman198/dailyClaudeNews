import { describe, expect, it } from 'vitest'
import { __test__, verifyDeployment, type VerifyDeps } from './deploymentVerifier.js'

const { buildVerifyUrl } = __test__

type MockResponseInit = {
  ok?: boolean
  status?: number
  body?: string
  throwOnFetch?: Error
  throwOnText?: Error
}

function mockResponse(init: MockResponseInit): Response {
  if (init.throwOnFetch) throw init.throwOnFetch
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => {
      if (init.throwOnText) throw init.throwOnText
      return init.body ?? ''
    },
  } as unknown as Response
}

function makeDeps(responses: MockResponseInit[]): {
  deps: VerifyDeps
  calls: { fetch: number; sleep: number[] }
  logs: string[]
} {
  let i = 0
  let virtualNow = 0
  const sleeps: number[] = []
  const logs: string[] = []
  const deps: VerifyDeps = {
    fetch: async () => {
      const r = responses[Math.min(i, responses.length - 1)]
      i += 1
      if (r.throwOnFetch) throw r.throwOnFetch
      return mockResponse(r)
    },
    sleep: async (ms) => {
      sleeps.push(ms)
      virtualNow += ms
    },
    now: () => virtualNow,
    log: (m) => {
      logs.push(m)
    },
  }
  return { deps, calls: { fetch: i, sleep: sleeps }, logs }
}

describe('buildVerifyUrl', () => {
  it('builds the canonical URL', () => {
    expect(buildVerifyUrl('2026-06-06', 'https://example.test/dailyClaudeNews')).toBe(
      'https://example.test/dailyClaudeNews/daily/2026-06-06.html',
    )
  })

  it('strips trailing slash from base', () => {
    expect(buildVerifyUrl('2026-06-06', 'https://example.test/x/')).toBe(
      'https://example.test/x/daily/2026-06-06.html',
    )
  })
})

describe('verifyDeployment', () => {
  const baseUrl = 'https://example.test/site'
  const opts = { initialDelayMs: 0, intervalMs: 1_000, timeoutMs: 10_000, baseUrl }

  it('resolves immediately on first 200 with matching dateStr', async () => {
    const { deps, logs } = makeDeps([
      { ok: true, status: 200, body: '<html>... 2026-06-06 のニュース ...</html>' },
    ])
    await expect(verifyDeployment('2026-06-06', opts, deps)).resolves.toBeUndefined()
    expect(logs.some((l) => l.includes('OK'))).toBe(true)
  })

  it('retries while body lacks dateStr (stale build), then succeeds', async () => {
    const stale = '<html>... 2026-06-05 のニュース ...</html>' // 古いビルドを 2 回返してから新しいビルド
    const fresh = '<html>... 2026-06-06 のニュース ...</html>'
    const { deps, calls } = makeDeps([
      { ok: true, status: 200, body: stale },
      { ok: true, status: 200, body: stale },
      { ok: true, status: 200, body: fresh },
    ])
    await expect(verifyDeployment('2026-06-06', opts, deps)).resolves.toBeUndefined()
    // 試行 3 回 → sleep は試行間に 2 回挟まる
    expect(calls.sleep.length).toBe(2)
  })

  it('retries on 404 then succeeds when build completes', async () => {
    const fresh = '<html>2026-06-06</html>'
    const { deps } = makeDeps([
      { ok: false, status: 404, body: 'Not Found' },
      { ok: false, status: 404, body: 'Not Found' },
      { ok: true, status: 200, body: fresh },
    ])
    await expect(verifyDeployment('2026-06-06', opts, deps)).resolves.toBeUndefined()
  })

  it('throws after timeout with the final reason', async () => {
    const { deps } = makeDeps([{ ok: false, status: 404, body: 'Not Found' }])
    await expect(
      verifyDeployment('2026-06-06', { ...opts, timeoutMs: 3_500, intervalMs: 1_000 }, deps),
    ).rejects.toThrow(/verify-deploy/)
  })

  it('throws with stale-content reason when 200 but body never includes dateStr', async () => {
    const stale = '<html>2026-06-05</html>'
    const { deps } = makeDeps([{ ok: true, status: 200, body: stale }])
    await expect(
      verifyDeployment('2026-06-06', { ...opts, timeoutMs: 2_500, intervalMs: 1_000 }, deps),
    ).rejects.toThrow(/含まない|stale|古いビルド/)
  })

  it('treats fetch network error as retryable', async () => {
    const networkErr = new Error('ECONNRESET')
    const { deps } = makeDeps([
      { throwOnFetch: networkErr },
      { ok: true, status: 200, body: '2026-06-06' },
    ])
    await expect(verifyDeployment('2026-06-06', opts, deps)).resolves.toBeUndefined()
  })

  it('honors initial delay (sleeps before first attempt)', async () => {
    const { deps, calls } = makeDeps([{ ok: true, status: 200, body: '2026-06-06' }])
    await verifyDeployment(
      '2026-06-06',
      { ...opts, initialDelayMs: 5_000 },
      deps,
    )
    expect(calls.sleep[0]).toBe(5_000)
  })
})

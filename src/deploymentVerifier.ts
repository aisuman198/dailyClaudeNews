import { config } from './config.js'
import { redact } from './redact.js'

// verify-deploy フェーズ: git push したあと GitHub Pages 上で本日の記事ページが
// 期待どおり公開されているかを確認する。Jekyll の build には通常 1〜2 分かかるので、
// 初期待機 → 間隔 polling → 最大時間でタイムアウト、という素直な構造。
//
// 「公開された」と判定する条件:
//   1. HTTP 200 が返る
//   2. レスポンス本文に dateStr (例: 2026-06-05) が含まれる
//      ─ Jekyll が古いビルドのページ(404 → 200 とキャッシュ更新の途中) を
//        返すケースを排除するためのコンテンツチェック。frontmatter の
//        title (`"YYYY-MM-DD のニュース"`) と本文の見出しに必ず日付が出るため、
//        新しく追加された日のページなら必ずヒットする。
//
// 失敗時は通常の throw → main の catch → notifier 経由で issue 起票される。

// テスト容易化のために fetch / sleep を差し替え可能にする。
export type VerifyDeps = {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  log: (message: string) => void
}

const defaultDeps: VerifyDeps = {
  fetch: globalThis.fetch.bind(globalThis),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  log: (m) => console.log(redact(m)),
}

export type VerifyOptions = {
  initialDelayMs?: number
  intervalMs?: number
  timeoutMs?: number
  baseUrl?: string
}

export function buildVerifyUrl(dateStr: string, baseUrl: string = config.pagesBaseUrl): string {
  // baseUrl の末尾 / を許容する
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/daily/${dateStr}.html`
}

type AttemptResult =
  | { ok: true }
  | { ok: false; reason: string }

async function attempt(url: string, dateStr: string, deps: VerifyDeps): Promise<AttemptResult> {
  let res: Response
  try {
    res = await deps.fetch(url, {
      // Cache-busting: GitHub Pages の CDN が古い 404 を返すことがあるので
      // 各試行で no-cache ヘッダを付ける。
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      redirect: 'follow',
    })
  } catch (err) {
    return { ok: false, reason: `fetch error: ${(err as Error).message}` }
  }
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status}` }
  }
  let body: string
  try {
    body = await res.text()
  } catch (err) {
    return { ok: false, reason: `body read error: ${(err as Error).message}` }
  }
  if (!body.includes(dateStr)) {
    return { ok: false, reason: `200 だが本文に ${dateStr} を含まない (古いビルドの可能性)` }
  }
  return { ok: true }
}

export async function verifyDeployment(
  dateStr: string,
  options: VerifyOptions = {},
  deps: VerifyDeps = defaultDeps,
): Promise<void> {
  const baseUrl = options.baseUrl ?? config.pagesBaseUrl
  const initialDelayMs = options.initialDelayMs ?? config.verifyDeploymentInitialDelayMs
  const intervalMs = options.intervalMs ?? config.verifyDeploymentIntervalMs
  const timeoutMs = options.timeoutMs ?? config.verifyDeploymentTimeoutMs
  const url = buildVerifyUrl(dateStr, baseUrl)

  const startedAt = deps.now()
  deps.log(`[verify-deploy] target=${url} initialDelay=${initialDelayMs}ms interval=${intervalMs}ms timeout=${timeoutMs}ms`)

  if (initialDelayMs > 0) {
    await deps.sleep(initialDelayMs)
  }

  let attemptIdx = 0
  let lastReason = '(no attempt)'
  while (deps.now() - startedAt < timeoutMs) {
    attemptIdx += 1
    const result = await attempt(url, dateStr, deps)
    if (result.ok) {
      const elapsed = deps.now() - startedAt
      deps.log(`[verify-deploy] OK (attempt ${attemptIdx}, ${Math.round(elapsed / 1000)}s 経過): ${url}`)
      return
    }
    lastReason = result.reason
    const elapsed = deps.now() - startedAt
    deps.log(`[verify-deploy] attempt ${attemptIdx} 不一致 (${Math.round(elapsed / 1000)}s 経過): ${result.reason}`)
    // 次の試行までの待機。ただし残り時間が無いなら無駄に sleep しない。
    if (deps.now() - startedAt + intervalMs >= timeoutMs) break
    await deps.sleep(intervalMs)
  }
  const elapsedSec = Math.round((deps.now() - startedAt) / 1000)
  throw new Error(
    `verify-deploy: ${url} がタイムアウト時間内 (${Math.round(timeoutMs / 1000)}s) に公開を確認できませんでした` +
      ` (試行 ${attemptIdx} 回, 経過 ${elapsedSec}s, 最終理由: ${lastReason})`,
  )
}

export const __test__ = {
  attempt,
  buildVerifyUrl,
}

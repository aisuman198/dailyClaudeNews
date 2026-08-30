import { spawn } from 'node:child_process'
import { config } from './config.js'
import { isAuthError } from './errorCategory.js'

export type AuthCheckResult = {
  ok: boolean
  // 認証エラー (要再ログイン) かどうか。タイムアウト等の一時的失敗と区別する。
  isAuth: boolean
  detail: string
}

// パイプライン本体に入る前に claude CLI が「実際に」認証できるかを確かめるための
// 最小プローブ。`claude auth status` はキーチェーンをローカルで読むだけで
// loggedIn:true を返すことがある (実呼び出しは 401) ため、status ではなく
// 実際の `claude -p` を 1 回叩いて判定する（[[project_summarize_auth_dependency]]）。
const PROBE_PROMPT = 'ping'

export function checkClaudeAuth(): Promise<AuthCheckResult> {
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--output-format', 'text',
      '--no-session-persistence',
      '--tools', '',
      '--model', config.authCheckModel,
    ]
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    let killedForTimeout = false
    const timer = setTimeout(() => {
      killedForTimeout = true
      child.kill('SIGKILL')
    }, config.authCheckTimeoutMs)

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, isAuth: false, detail: `claude プロセス起動失敗: ${err.message}` })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (killedForTimeout) {
        resolve({ ok: false, isAuth: false, detail: `認証確認タイムアウト (${config.authCheckTimeoutMs}ms)` })
        return
      }
      // claude CLI は認証エラー本文を stdout に出すため、両方を拾って判定する。
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join(' / ').slice(0, 500)
      if (code === 0 && stdout.trim().length > 0) {
        resolve({ ok: true, isAuth: false, detail: '' })
        return
      }
      resolve({ ok: false, isAuth: isAuthError(detail), detail: detail || `claude 終了コード ${code}` })
    })

    child.stdin.end(PROBE_PROMPT)
  })
}

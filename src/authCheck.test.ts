import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkClaudeAuth } from './authCheck.js'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

// spawn の戻り値を模した擬似 child。ハンドラ登録後に stdout/stderr/exit を発火する。
function fakeChild(opts: { stdout?: string; stderr?: string; code?: number }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { end: () => void }
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: () => {} }
  child.kill = () => {}
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout))
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
    child.emit('exit', opts.code ?? 0)
  })
  return child
}

describe('checkClaudeAuth', () => {
  beforeEach(() => spawnMock.mockReset())

  it('exit 0 かつ出力ありなら ok', async () => {
    spawnMock.mockImplementation(() => fakeChild({ stdout: 'pong', code: 0 }))
    const r = await checkClaudeAuth()
    expect(r.ok).toBe(true)
    expect(r.isAuth).toBe(false)
  })

  it('401 認証エラーは ok=false / isAuth=true として検知する', async () => {
    spawnMock.mockImplementation(() =>
      fakeChild({
        stdout: 'Failed to authenticate. API Error: 401 Invalid authentication credentials\n',
        code: 1,
      }),
    )
    const r = await checkClaudeAuth()
    expect(r.ok).toBe(false)
    expect(r.isAuth).toBe(true)
    expect(r.detail).toMatch(/Invalid authentication credentials/)
  })

  it('認証以外の失敗 (exit 1・非認証出力) は isAuth=false', async () => {
    spawnMock.mockImplementation(() => fakeChild({ stderr: 'some transient error', code: 1 }))
    const r = await checkClaudeAuth()
    expect(r.ok).toBe(false)
    expect(r.isAuth).toBe(false)
  })

  it('exit 0 でも出力が空なら ok=false（認証エラー扱いはしない）', async () => {
    spawnMock.mockImplementation(() => fakeChild({ stdout: '', code: 0 }))
    const r = await checkClaudeAuth()
    expect(r.ok).toBe(false)
    expect(r.isAuth).toBe(false)
  })
})

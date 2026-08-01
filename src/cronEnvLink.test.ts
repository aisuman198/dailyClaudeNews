import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// cron 実行では worktree 側の .env が読めないと全設定が既定値になり、
// Discord 通知が「Webhook URL 未設定」として黙ってスキップされる事故が起きた。
// symlink の接続はシェルスクリプト側の責務なので、実際に bash で起動して検証する。
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const linkEnvScript = path.join(repoRoot, 'scripts/link-env.sh')
const runScript = path.join(repoRoot, 'scripts/run.sh')

type Result = { status: number; stdout: string; stderr: string }

function runLinkEnv(...args: string[]): Result {
  try {
    const stdout = execFileSync('bash', [linkEnvScript, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

let tmpRoot: string
let projectRoot: string
let worktreePath: string

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'cron-env-link-'))
  projectRoot = path.join(tmpRoot, 'repo')
  worktreePath = path.join(tmpRoot, 'worktree')
  mkdirSync(projectRoot)
  mkdirSync(worktreePath)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('link-env.sh', () => {
  it('worktree に .env が無ければ開発側の .env を symlink する', () => {
    writeFileSync(path.join(projectRoot, '.env'), 'DISCORD_NEWS_WEBHOOK_URL=https://example.test/hook\n')

    const result = runLinkEnv(projectRoot, worktreePath)

    expect(result.status, result.stderr).toBe(0)
    const dest = path.join(worktreePath, '.env')
    expect(lstatSync(dest).isSymbolicLink()).toBe(true)
    expect(readlinkSync(dest)).toBe(path.join(projectRoot, '.env'))
    // 実際に読めること (リンクが張れても中身が届かなければ意味がない)
    expect(readFileSync(dest, 'utf8')).toContain('DISCORD_NEWS_WEBHOOK_URL')
  })

  it('worktree 作成後に .env を作った場合でも後から接続できる', () => {
    // symlink 未接続のまま worktree が存在する状態 = 今回の不具合そのもの
    expect(runLinkEnv(projectRoot, worktreePath).status).toBe(1)

    writeFileSync(path.join(projectRoot, '.env'), 'VERBOSE=true\n')

    const result = runLinkEnv(projectRoot, worktreePath)
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(path.join(worktreePath, '.env'), 'utf8')).toBe('VERBOSE=true\n')
  })

  it('既に接続済みなら何度実行しても結果が変わらない (idempotent)', () => {
    writeFileSync(path.join(projectRoot, '.env'), 'VERBOSE=true\n')

    expect(runLinkEnv(projectRoot, worktreePath).status).toBe(0)
    const first = readlinkSync(path.join(worktreePath, '.env'))
    expect(runLinkEnv(projectRoot, worktreePath).status).toBe(0)

    expect(readlinkSync(path.join(worktreePath, '.env'))).toBe(first)
  })

  it('リンク先が消えた壊れた symlink は張り直す', () => {
    const src = path.join(projectRoot, '.env')
    symlinkSync(src, path.join(worktreePath, '.env')) // 参照先がまだ無い = 壊れた symlink

    writeFileSync(src, 'VERBOSE=true\n')
    const result = runLinkEnv(projectRoot, worktreePath)

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(path.join(worktreePath, '.env'), 'utf8')).toBe('VERBOSE=true\n')
  })

  it('worktree 側に実体の .env が置かれている場合は上書きしない', () => {
    writeFileSync(path.join(projectRoot, '.env'), 'VERBOSE=true\n')
    writeFileSync(path.join(worktreePath, '.env'), 'VERBOSE=false\n')

    const result = runLinkEnv(projectRoot, worktreePath)

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(path.join(worktreePath, '.env'), 'utf8')).toBe('VERBOSE=false\n')
  })

  it('開発側に .env が無ければ終了コード 1 と理由を返す', () => {
    const result = runLinkEnv(projectRoot, worktreePath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.env')
  })

  it('引数が足りなければ終了コード 2 で使い方を表示する', () => {
    const result = runLinkEnv(projectRoot)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('使い方')
  })

  it('空の引数を渡された場合もルート直下を触らず終了コード 2 で止まる', () => {
    const result = runLinkEnv(projectRoot, '')

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('使い方')
  })
})

describe('run.sh の .env 接続', () => {
  const runSh = readFileSync(runScript, 'utf8')

  it('.env を source する前に link-env.sh を呼んでいる', () => {
    const linkAt = runSh.indexOf('link-env.sh')
    const sourceAt = runSh.indexOf('. "${WORKTREE_PATH}/.env"')

    expect(linkAt, 'run.sh が link-env.sh を呼んでいません').toBeGreaterThanOrEqual(0)
    expect(sourceAt, 'run.sh の .env 読み込み処理が見つかりません').toBeGreaterThanOrEqual(0)
    expect(
      linkAt < sourceAt,
      'link-env.sh の呼び出しが .env の読み込みより後にあります。' +
        '接続前に source すると、初回は必ず既定値で実行されてしまいます。',
    ).toBe(true)
  })

  it('.env を読み込めなかった場合に警告を残す', () => {
    expect(
      runSh.includes('警告: .env を読み込めませんでした'),
      '.env が無いまま実行したことがログに残りません。既定値で走り続ける事故に気づけなくなります。',
    ).toBe(true)
  })
})

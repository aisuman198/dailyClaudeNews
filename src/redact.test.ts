/**
 * プロジェクト側の redact ラッパーは ~/.claude/scripts/redact.cjs に処理を委譲する。
 * 核心の伏字化ロジックは共有モジュール側の node:test (redact.test.cjs) で
 * 網羅的にテストされているので、ここでは以下を確認:
 *   - 共有モジュールに正しく接続できている
 *   - 主な機密パターンが伏字化される (smoke test)
 *   - 各 sink のソースに redact() 呼び出しがある (sink contract)
 *   - CI 用フィクスチャ (fixtures/claude-scripts/redact.cjs) が正本とドリフトしていない
 */
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { containsLikelySecret, redact } from './redact.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('redact wrapper: 共有モジュール (~/.claude/scripts/redact.cjs) 連携', () => {
  it('macOS ホームパスを伏字化できる', () => {
    expect(redact('at foo (/Users/shuichi/git/proj/src/x.ts:1:1)')).not.toContain('shuichi')
    expect(redact('at foo (/Users/shuichi/git/proj/src/x.ts:1:1)')).toContain('/Users/[USER]')
  })

  it('GitHub token を伏字化できる', () => {
    expect(redact('GITHUB_TOKEN=ghp_ABCDEFghijklmnopQRSTUVwxyz0123456789ab'))
      .toContain('[REDACTED:GITHUB_TOKEN]')
  })

  it('冪等 (二度通しても結果が変わらない)', () => {
    const s = '/Users/shuichi/x / token=ghp_ABCDEFGHIJ1234567890abcdefghij012345'
    expect(redact(redact(s))).toBe(redact(s))
  })

  it('containsLikelySecret で機密検出', () => {
    expect(containsLikelySecret('/Users/shuichi/x')).toBe(true)
    expect(containsLikelySecret('safe text')).toBe(false)
  })
})

/**
 * パブリック出力 sink の運用ルール:
 * 「コミット / issue / PR / ログ を出す関数の本体内で redact() を必ず呼ぶ」
 * を静的解析で検査する。新しい sink を増やしたらここに追記すること。
 */
type SinkSpec = { file: string; signature: string; label: string }

const SINKS: SinkSpec[] = [
  { file: 'issueClient.ts', signature: 'export async function createIssue(', label: 'GitHub Issue 起票' },
  { file: 'issueClient.ts', signature: 'export async function addIssueComment(', label: 'GitHub Issue コメント' },
  { file: 'issueClient.ts', signature: 'export async function createDraftPr(', label: 'GitHub Draft PR 作成' },
  { file: 'git.ts',         signature: 'export async function commitAndPush(',  label: 'Git commit + push' },
  { file: 'index.ts',       signature: 'function log(',                          label: 'メインパイプラインのフェーズログ' },
  { file: 'notifier.ts',    signature: 'function readRecentLog(',                label: 'issue body 添付用 run.log 読み出し' },
]

function extractFunctionBody(source: string, signature: string): string {
  const sigStart = source.indexOf(signature)
  if (sigStart === -1) throw new Error(`signature が見つからない: ${signature}`)
  let i = sigStart + signature.length
  let parenDepth = 1
  while (i < source.length && parenDepth > 0) {
    const ch = source[i]
    if (ch === '(') parenDepth++
    else if (ch === ')') parenDepth--
    i++
  }
  while (i < source.length && source[i] !== '{') i++
  if (i >= source.length) throw new Error(`本体の { が見つからない: ${signature}`)
  const bodyStart = i
  let depth = 0
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(bodyStart, i + 1)
    }
  }
  throw new Error(`関数本体の終端 } が見つからない: ${signature}`)
}

describe('sink contract: パブリック出力関数で redact() が呼ばれていること', () => {
  for (const sink of SINKS) {
    it(`${sink.file} :: ${sink.label}`, () => {
      const filePath = path.join(__dirname, sink.file)
      const source = readFileSync(filePath, 'utf8')

      expect(
        source.match(/from\s+['"]\.\/redact\.js['"]/),
        `${sink.file} は ./redact.js をインポートしていない`,
      ).not.toBeNull()

      const body = extractFunctionBody(source, sink.signature)
      expect(
        body.includes('redact('),
        `${sink.file} :: ${sink.signature} 内で redact() が呼ばれていない` +
          ` (パブリック出力 sink は ~/.claude/CLAUDE.md のルールにより必ず redact を通すこと)`,
      ).toBe(true)
    })
  }
})

/**
 * CI 用フィクスチャ (fixtures/claude-scripts/redact.cjs) は
 * 正本 ~/.claude/scripts/redact.cjs のバイト単位ミラー。
 * ローカル環境 (正本が存在する場合) でのみドリフトを検知する。
 * CI 環境には正本が存在しないため、このテストは自動的に skip される。
 */
const globalRedactPath = path.join(os.homedir(), '.claude/scripts/redact.cjs')
const fixtureRedactPath = path.join(__dirname, '..', 'fixtures', 'claude-scripts', 'redact.cjs')
const hasGlobalRedact = existsSync(globalRedactPath)

describe('CI フィクスチャ: fixtures/claude-scripts/redact.cjs のドリフト検知', () => {
  it('フィクスチャファイルが存在する', () => {
    expect(
      existsSync(fixtureRedactPath),
      `fixtures/claude-scripts/redact.cjs が見つからない (${fixtureRedactPath})。` +
        ' CI で sink contract test を動かすためのフィクスチャが消失している可能性がある。',
    ).toBe(true)
  })

  it.runIf(hasGlobalRedact)('正本 ~/.claude/scripts/redact.cjs とフィクスチャの内容が完全一致する', () => {
    const globalContent = readFileSync(globalRedactPath, 'utf8')
    const fixtureContent = readFileSync(fixtureRedactPath, 'utf8')
    expect(
      fixtureContent,
      '正本 ~/.claude/scripts/redact.cjs が更新されています。' +
        ' `npm run sync:redact-fixture` を実行してフィクスチャを同期してください。',
    ).toBe(globalContent)
  })
})

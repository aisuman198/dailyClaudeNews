/**
 * ~/.claude/scripts/redact.cjs (個人共通モジュール) への薄いラッパー。
 *
 * 設計意図:
 * - 機密情報伏字化のロジックは本リポジトリには持たせず、ホームの共有
 *   `~/.claude/scripts/redact.cjs` を参照する。複数プロジェクトが同じ
 *   実装を使うことで、パターン追加・修正を一箇所で管理できる。
 * - 運用ルールは `~/.claude/CLAUDE.md` の「パブリック出力での機密情報
 *   混入防止」セクションを参照。
 *
 * パブリックな出力 sink (issue / commit / PR / 通知 / ログ) に文字列を
 * 送る前に必ず `redact()` を通すこと。
 */
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

type SharedRedact = {
  redact: (s: unknown) => string
  redactDeep: <T>(v: T) => T
  containsLikelySecret: (s: string) => boolean
  resetRedactionCache: () => void
}

// 配置を上書きするための env (CI / テスト用):
//   CLAUDE_SCRIPTS_DIR=/path/to/scripts → /path/to/scripts/redact.cjs を見る
function resolveSharedPath(): string {
  const override = process.env.CLAUDE_SCRIPTS_DIR
  if (override) return path.join(override, 'redact.cjs')
  return path.join(os.homedir(), '.claude/scripts/redact.cjs')
}

let cached: SharedRedact | null = null

function load(): SharedRedact {
  if (cached) return cached
  const sharedPath = resolveSharedPath()
  try {
    cached = require(sharedPath) as SharedRedact
    return cached
  } catch (err) {
    // 共有モジュールが見つからない環境 (CI コンテナ等) では、入力をそのまま
    // 返す no-op フォールバックを使う。本番では警告を出して気付かせるが、
    // テストランナー (vitest) の中ではノイズになるため抑制する。
    const inTest = !!process.env.VITEST || process.env.NODE_ENV === 'test'
    if (!inTest) {
      const e = err as Error
      process.stderr.write(
        `[redact] WARNING: 共有モジュールの読み込みに失敗 (${sharedPath}): ${e.message}\n` +
          '[redact] 出力は伏字化されません。~/.claude/scripts/redact.cjs を配置してください。\n',
      )
    }
    cached = {
      redact: (s) => (s === null || s === undefined ? String(s) : String(s)),
      redactDeep: <T>(v: T) => v,
      containsLikelySecret: () => false,
      resetRedactionCache: () => {},
    }
    return cached
  }
}

export function redact(input: unknown): string {
  return load().redact(input)
}

export function redactDeep<T>(value: T): T {
  return load().redactDeep(value)
}

export function containsLikelySecret(s: string): boolean {
  return load().containsLikelySecret(s)
}

export function resetRedactionCache(): void {
  load().resetRedactionCache()
}

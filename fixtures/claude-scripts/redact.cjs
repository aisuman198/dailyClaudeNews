/**
 * ~/.claude/scripts/redact.cjs
 *
 * パブリック出力 (ログ / GitHub issue / commit / PR / 通知 など) の文字列から
 * 機密・個人情報を伏字化する **複数プロジェクト共有モジュール** 。
 *
 * 設計方針:
 *   - 各プロジェクトの src/ にコピーせず、本ファイルを直接 require して使う
 *     (ホームディレクトリにあるため、すべてのプロジェクトから同じ内容を参照可能)
 *   - 新しい機密パターンを足すときは本ファイルの STATIC_RULES / SECRET_ENV_KEYS
 *     を更新するだけで、全プロジェクトに即時反映される
 *   - 設計と運用ルールは ~/.claude/CLAUDE.md を参照
 *
 * 使い方:
 *
 * (A) Node.js / TypeScript プロジェクトから:
 *   const path = require('node:path')
 *   const os = require('node:os')
 *   const { redact } = require(path.join(os.homedir(), '.claude/scripts/redact.cjs'))
 *
 *   ESM プロジェクトでは createRequire 経由:
 *   import { createRequire } from 'node:module'
 *   const require = createRequire(import.meta.url)
 *   const { redact } = require(path.join(os.homedir(), '.claude/scripts/redact.cjs'))
 *
 * (B) シェルから (CLI):
 *   echo "path=/Users/alice/x token=ghp_ABCDE..." | node ~/.claude/scripts/redact.cjs
 *     → "path=/Users/[USER]/x token=[REDACTED:GITHUB_TOKEN]"
 *
 * (C) gh / git の入力をフィルタしたい:
 *   gh issue create --title "$(echo "$TITLE" | node ~/.claude/scripts/redact.cjs)" \
 *                   --body-file <(cat body.md | node ~/.claude/scripts/redact.cjs)
 */

'use strict'

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 静的ルール: パターンマッチによる検出 (環境に依存しない)
 */
const STATIC_RULES = [
  // ── API keys / tokens ──────────
  { name: 'anthropic-api-key',
    pattern: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g,
    replacement: '[REDACTED:ANTHROPIC_API_KEY]' },
  { name: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    replacement: '[REDACTED:GITHUB_TOKEN]' },
  { name: 'github-fg-pat',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[REDACTED:GITHUB_FG_PAT]' },
  { name: 'openai-api-key',
    pattern: /\bsk-[A-Za-z0-9]{32,}\b/g,
    replacement: '[REDACTED:OPENAI_API_KEY]' },
  { name: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED:AWS_ACCESS_KEY_ID]' },
  { name: 'slack-token',
    pattern: /\bxox[abprso]-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED:SLACK_TOKEN]' },
  { name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED:JWT]' },
  { name: 'bearer-token',
    pattern: /Bearer\s+[A-Za-z0-9._\-+/=]{20,}/g,
    replacement: 'Bearer [REDACTED]' },

  // ── PII ──────────
  { name: 'email',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[REDACTED:EMAIL]' },

  // ── パス内のユーザー名 (絶対パス) ──────────
  { name: 'macos-home-path',
    pattern: /\/Users\/[^/\s"'`<>:|]+/g,
    replacement: '/Users/[USER]' },
  { name: 'linux-home-path',
    pattern: /\/home\/[^/\s"'`<>:|]+/g,
    replacement: '/home/[USER]' },
  { name: 'windows-home-path',
    pattern: /[A-Z]:\\Users\\[^\\\s"'`<>:|]+/g,
    replacement: 'C:\\Users\\[USER]' },
]

/**
 * これらの環境変数に値が入っている場合、値そのものを伏字化対象に追加する。
 */
const SECRET_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'SLACK_TOKEN',
  'SLACK_WEBHOOK_URL',
  'NPM_TOKEN',
  'HUGGINGFACE_TOKEN',
]

function buildDynamicRules() {
  const rules = []
  const env = process.env

  // 1) 機密 env の値そのもの
  for (const key of SECRET_ENV_KEYS) {
    const v = env[key]
    if (v && v.trim().length >= 8) {
      rules.push({
        name: `env-value:${key}`,
        pattern: new RegExp(escapeRegex(v.trim()), 'g'),
        replacement: `[REDACTED:${key}]`,
      })
    }
  }

  // 2) PC ユーザー名そのもの (HOME / USER / LOGNAME / USERNAME 由来)
  const usernameCandidates = new Set()
  const homePath = env.HOME
  if (homePath) {
    const parts = homePath.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    if (last) usernameCandidates.add(last)
  }
  for (const k of ['USER', 'LOGNAME', 'USERNAME']) {
    const v = env[k]
    if (v) usernameCandidates.add(v)
  }
  for (const u of usernameCandidates) {
    if (u.length < 2 || u.length > 64) continue
    if (!/^[A-Za-z0-9_.\-]+$/.test(u)) continue
    // 汎用的すぎる名前は誤マッチを避けるため除外
    if (/^(root|admin|user|nobody|build|runner|guest|host)$/i.test(u)) continue
    rules.push({
      name: `env-username:${u}`,
      pattern: new RegExp(
        `(?<![A-Za-z0-9])${escapeRegex(u)}(?![A-Za-z0-9])`,
        'g',
      ),
      replacement: '[USER]',
    })
  }

  return rules
}

let cachedDynamic = null
function getDynamicRules() {
  if (cachedDynamic === null) cachedDynamic = buildDynamicRules()
  return cachedDynamic
}

/** テスト用または環境変更直後にキャッシュをクリア */
function resetRedactionCache() {
  cachedDynamic = null
}

/**
 * 文字列内の機密情報を伏字化する。
 * 非文字列は文字列化してから処理。冪等 (二度通しても結果が変わらない)。
 */
function redact(input) {
  if (input === null || input === undefined) return String(input)
  let s = typeof input === 'string' ? input : String(input)
  for (const r of STATIC_RULES) s = s.replace(r.pattern, r.replacement)
  for (const r of getDynamicRules()) s = s.replace(r.pattern, r.replacement)
  return s
}

/**
 * 値の中の文字列を再帰的に伏字化 (配列・オブジェクト対応)。
 */
function redactDeep(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v)
    return out
  }
  return value
}

/** 文字列に機密パターンが残っているか検査 (テスト・CI 用) */
function containsLikelySecret(s) {
  return redact(s) !== s
}

module.exports = {
  STATIC_RULES,
  SECRET_ENV_KEYS,
  redact,
  redactDeep,
  resetRedactionCache,
  containsLikelySecret,
}

// CLI: 引数があれば引数を、無ければ stdin を伏字化して stdout に出力
if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length > 0) {
    process.stdout.write(redact(args.join(' ')) + '\n')
    process.exit(0)
  }
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { buf += chunk })
  process.stdin.on('end', () => { process.stdout.write(redact(buf)) })
}

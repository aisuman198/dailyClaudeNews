import type { Phase } from './types.js'

export type ErrorCategory = 'timeout' | 'fetch' | 'git' | 'rate-limit' | 'unknown'

export type Categorized = {
  category: ErrorCategory
  subkey: string
  title: string
  labels: string[]
}

const TIMEOUT_PATTERNS = [/タイムアウト/, /timeout/i, /timed out/i]
const RATE_LIMIT_PATTERNS = [/rate limit/i, /quota/i, /5時間/, /usage limit/i, /5h/i]

export function categorize(error: Error, phase: Phase): Categorized {
  const msg = error.message ?? ''

  if (TIMEOUT_PATTERNS.some((p) => p.test(msg))) {
    // タイムアウトは「どのフェーズの」ではなく純粋なタイムアウト扱い
    return {
      category: 'timeout',
      subkey: phase,
      title: `[dailyClaudeNews] timeout: ${phase}`,
      labels: ['dailyClaudeNews', 'category:timeout', `phase:${phase}`],
    }
  }

  if (RATE_LIMIT_PATTERNS.some((p) => p.test(msg))) {
    return {
      category: 'rate-limit',
      subkey: phase,
      title: `[dailyClaudeNews] rate-limit: ${phase}`,
      labels: ['dailyClaudeNews', 'category:rate-limit', `phase:${phase}`],
    }
  }

  if (phase === 'fetch') {
    return {
      category: 'fetch',
      subkey: 'sources',
      title: `[dailyClaudeNews] fetch 失敗`,
      labels: ['dailyClaudeNews', 'category:fetch', `phase:${phase}`],
    }
  }

  if (phase === 'git') {
    return {
      category: 'git',
      subkey: 'push',
      title: `[dailyClaudeNews] git push 失敗`,
      labels: ['dailyClaudeNews', 'category:git', `phase:${phase}`],
    }
  }

  return {
    category: 'unknown',
    subkey: phase,
    title: `[dailyClaudeNews] ${phase} エラー`,
    labels: ['dailyClaudeNews', 'category:unknown', `phase:${phase}`],
  }
}

import type { Phase } from './types.js'

export type ErrorCategory = 'timeout' | 'fetch' | 'article-fetch' | 'git' | 'rate-limit' | 'verify-deploy' | 'unknown'

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
    // 記事取得（enrich-bodies）のタイムアウトは URL を問わず単一タイトルに集約
    if (phase === 'enrich-bodies') {
      return {
        category: 'article-fetch',
        subkey: 'timeout',
        title: `[dailyClaudeNews] 記事取得タイムアウト`,
        labels: ['dailyClaudeNews', 'category:article-fetch', 'phase:enrich-bodies'],
      }
    }
    // verify-deploy のタイムアウトは「Pages が時間内に公開されなかった」事象。
    // Claude CLI 系の timeout と原因が全く別なので verify-deploy バケットに集約する。
    if (phase === 'verify-deploy') {
      return {
        category: 'verify-deploy',
        subkey: 'timeout',
        title: `[dailyClaudeNews] verify-deploy 失敗 (GitHub Pages 公開未確認)`,
        labels: ['dailyClaudeNews', 'category:verify-deploy', 'phase:verify-deploy'],
      }
    }
    // それ以外のタイムアウト（summarize / review / fetch / git 等）はフェーズで集約
    return {
      category: 'timeout',
      subkey: phase,
      title: `[dailyClaudeNews] timeout: ${phase}`,
      labels: ['dailyClaudeNews', 'category:timeout', `phase:${phase}`],
    }
  }

  if (phase === 'enrich-bodies') {
    return {
      category: 'article-fetch',
      subkey: 'failure',
      title: `[dailyClaudeNews] 記事取得失敗`,
      labels: ['dailyClaudeNews', 'category:article-fetch', `phase:${phase}`],
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

  if (phase === 'verify-deploy') {
    return {
      category: 'verify-deploy',
      subkey: 'pages-not-visible',
      title: `[dailyClaudeNews] verify-deploy 失敗 (GitHub Pages 公開未確認)`,
      labels: ['dailyClaudeNews', 'category:verify-deploy', `phase:${phase}`],
    }
  }

  return {
    category: 'unknown',
    subkey: phase,
    title: `[dailyClaudeNews] ${phase} エラー`,
    labels: ['dailyClaudeNews', 'category:unknown', `phase:${phase}`],
  }
}

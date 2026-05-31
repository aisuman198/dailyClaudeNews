import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(here, '..')

const env = (key: string, fallback: string): string => process.env[key] ?? fallback
const envNum = (key: string, fallback: number): number => {
  const v = process.env[key]
  if (v === undefined) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  model: env('CLAUDE_MODEL', 'claude-sonnet-4-6'),
  fallbackModel: env('CLAUDE_FALLBACK_MODEL', 'claude-haiku-4-5-20251001'),
  reviewerModel: env('REVIEWER_MODEL', 'claude-sonnet-4-6'),
  reviewEnabled: env('REVIEW_ENABLED', 'true').toLowerCase() === 'true',
  claudeTimeoutMs: envNum('CLAUDE_TIMEOUT_MS', 1_200_000),

  anthropicSitemap: env('ANTHROPIC_SITEMAP', 'https://www.anthropic.com/sitemap.xml'),
  anthropicLookbackDays: envNum('ANTHROPIC_LOOKBACK_DAYS', 7),
  anthropicMaxItems: envNum('ANTHROPIC_MAX_ITEMS', 15),
  hnTopStoriesApi: env('HN_TOP_STORIES_API', 'https://hacker-news.firebaseio.com/v0/topstories.json'),
  hnItemApi: env('HN_ITEM_API', 'https://hacker-news.firebaseio.com/v0/item'),
  hnMaxItems: envNum('HN_MAX_ITEMS', 100),
  hnKeywords: env('HN_KEYWORDS', 'Claude,Anthropic,AI,LLM,GPT,Gemini')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  outputDir: env('OUTPUT_DIR', 'docs/daily'),
  dedupTitleSimilarity: envNum('DEDUP_TITLE_SIMILARITY', 0.85),
  historyRetentionDays: envNum('HISTORY_RETENTION_DAYS', 14),
  historyStatePath: env('HISTORY_STATE_PATH', 'state/seen.json'),
  cautionsStatePath: env('CAUTIONS_STATE_PATH', 'state/cautions.json'),

  errorIssueRepo: env('ERROR_ISSUE_REPO', 'aisuman198/dailyClaudeNews'),
  macosNotification: env('MACOS_NOTIFICATION', 'true').toLowerCase() === 'true',
  verbose: env('VERBOSE', 'false').toLowerCase() === 'true',
  skipGitPush: env('SKIP_GIT_PUSH', 'false').toLowerCase() === 'true',
  saveDraft: env('SAVE_DRAFT', 'false').toLowerCase() === 'true',
  e2eMaxArticles: envNum('E2E_MAX_ARTICLES', 0),
} as const

export const resolvePath = (relativeOrAbsolute: string): string =>
  path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(PROJECT_ROOT, relativeOrAbsolute)

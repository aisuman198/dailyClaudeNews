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
  claudeTimeoutMs: envNum('CLAUDE_TIMEOUT_MS', 1_800_000),
  // パイプライン開始前の認証プリフライト用の短いタイムアウト。
  authCheckTimeoutMs: envNum('AUTH_CHECK_TIMEOUT_MS', 120_000),

  anthropicSitemap: env('ANTHROPIC_SITEMAP', 'https://www.anthropic.com/sitemap.xml'),
  anthropicLookbackDays: envNum('ANTHROPIC_LOOKBACK_DAYS', 7),
  anthropicMaxItems: envNum('ANTHROPIC_MAX_ITEMS', 15),
  hnTopStoriesApi: env('HN_TOP_STORIES_API', 'https://hacker-news.firebaseio.com/v0/topstories.json'),
  hnItemApi: env('HN_ITEM_API', 'https://hacker-news.firebaseio.com/v0/item'),
  hnMaxItems: envNum('HN_MAX_ITEMS', 100),
  zennTopics: env('ZENN_TOPICS', 'claudecode,claude,anthropic').split(',').map((s) => s.trim()).filter(Boolean),
  zennMaxItems: envNum('ZENN_MAX_ITEMS', 5),
  qiitaTags: env('QIITA_TAGS', 'anthropic,claude').split(',').map((s) => s.trim()).filter(Boolean),
  qiitaMaxItems: envNum('QIITA_MAX_ITEMS', 5),

  hnKeywords: env('HN_KEYWORDS', 'Claude,Anthropic,AI,LLM,GPT,Gemini')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  outputDir: env('OUTPUT_DIR', 'docs/daily'),
  // 優先フィルタ: Anthropic/Codex 関連を抽出。閾値以下なら他記事で補充
  priorityKeywords: env('PRIORITY_KEYWORDS', 'Anthropic,Claude,Codex')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  priorityMinNoPad: envNum('PRIORITY_MIN_NO_PAD', 5),
  priorityPadTarget: envNum('PRIORITY_PAD_TARGET', 10),
  dedupTitleSimilarity: envNum('DEDUP_TITLE_SIMILARITY', 0.85),
  historyRetentionDays: envNum('HISTORY_RETENTION_DAYS', 14),
  historyStatePath: env('HISTORY_STATE_PATH', 'state/seen.json'),
  // 継続話題のうち、bodyText のハッシュが前回観測時と同一なら出力対象から除外する。
  // 新情報（本文の更新・追記）があった場合のみ継続話題として残す。
  recurringDropUnchanged: env('RECURRING_DROP_UNCHANGED', 'true').toLowerCase() === 'true',
  cautionsStatePath: env('CAUTIONS_STATE_PATH', 'state/cautions.json'),

  errorIssueRepo: env('ERROR_ISSUE_REPO', 'aisuman198/dailyClaudeNews'),
  macosNotification: env('MACOS_NOTIFICATION', 'true').toLowerCase() === 'true',

  // === Discord 通知 ===
  // エラーと記事共有で投稿先チャンネルを分けるため、Webhook URL も別々に持つ。
  // 未設定なら該当の通知だけがスキップされる（パイプラインは落とさない）。
  discordNotification: env('DISCORD_NOTIFICATION', 'true').toLowerCase() === 'true',
  discordErrorWebhookUrl: env('DISCORD_ERROR_WEBHOOK_URL', ''),
  discordNewsWebhookUrl: env('DISCORD_NEWS_WEBHOOK_URL', ''),
  discordTimeoutMs: envNum('DISCORD_TIMEOUT_MS', 15_000),
  verbose: env('VERBOSE', 'false').toLowerCase() === 'true',
  skipGitPush: env('SKIP_GIT_PUSH', 'false').toLowerCase() === 'true',
  saveDraft: env('SAVE_DRAFT', 'false').toLowerCase() === 'true',
  e2eMaxArticles: envNum('E2E_MAX_ARTICLES', 0),

  // verify-deploy フェーズ: push 後に GitHub Pages 上で記事が公開されたか確認
  pagesBaseUrl: env('PAGES_BASE_URL', 'https://aisuman198.github.io/dailyClaudeNews'),
  verifyDeploymentEnabled: env('VERIFY_DEPLOYMENT_ENABLED', 'true').toLowerCase() === 'true',
  // Jekyll の最初のビルド完了まで待つ初期待機 (ms)
  verifyDeploymentInitialDelayMs: envNum('VERIFY_DEPLOYMENT_INITIAL_DELAY_MS', 60_000),
  // ポーリング間隔 (ms)
  verifyDeploymentIntervalMs: envNum('VERIFY_DEPLOYMENT_INTERVAL_MS', 30_000),
  // 最大待機時間 (ms) — これを超えても出ない場合は失敗扱い
  verifyDeploymentTimeoutMs: envNum('VERIFY_DEPLOYMENT_TIMEOUT_MS', 600_000),
} as const

export const resolvePath = (relativeOrAbsolute: string): string =>
  path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(PROJECT_ROOT, relativeOrAbsolute)

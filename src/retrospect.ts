import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { config } from './config.js'
import { createDraftPr, listIssues, type GhIssue } from './issueClient.js'

function todayJst(): string {
  const tz = 9 * 60 // JST offset in minutes
  const now = new Date(Date.now() + tz * 60_000)
  return now.toISOString().slice(0, 10)
}

const DATE_RE = /\d{4}-\d{2}-\d{2}/g

export function fingerprint(title: string): string {
  return title
    .replace(/^\[dailyClaudeNews\]\s*/i, '')
    .replace(DATE_RE, '<DATE>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const SKIP_PATTERNS = [
  /timeout/i,
  /タイムアウト/,
  /rate[- ]limit/i,
  /quota/i,
  /5h/i,
  /5時間/,
  /usage limit/i,
  /記事取得/,
]

const SKIP_LABEL_PREFIXES = [
  'category:timeout',
  'category:rate-limit',
  'category:article-fetch',
]

export function isFixable(title: string, labels: string[]): boolean {
  if (labels.some((l) => SKIP_LABEL_PREFIXES.some((p) => l.startsWith(p)))) {
    return false
  }
  if (SKIP_PATTERNS.some((p) => p.test(title))) {
    return false
  }
  return true
}

function notifyMacOs(title: string, message: string): Promise<void> {
  if (!config.macosNotification) return Promise.resolve()
  const escape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `display notification "${escape(message)}" with title "${escape(title)}"`
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script], { stdio: 'ignore' })
    const t = setTimeout(() => child.kill('SIGKILL'), 5_000)
    child.on('error', () => { clearTimeout(t); resolve() })
    child.on('exit', () => { clearTimeout(t); resolve() })
  })
}

function runGit(args: string[], opts: { cwd?: string; timeoutMs?: number; stdin?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: opts.cwd })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 30_000)
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`git ${args.join(' ')}: ${stderr.trim()}`))
      else resolve(stdout)
    })
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

function cleanIssueTitle(title: string): string {
  return title
    .replace(/^\[dailyClaudeNews\]\s*/i, '')
    .trim()
    .slice(0, 70)
}

async function createDraftPrForIssue(issue: GhIssue, dateStr: string): Promise<string | null> {
  const branch = `auto/retrospect-${dateStr}-issue-${issue.number}`
  const worktreeDir = path.join(tmpdir(), `dcn-retro-${issue.number}-${Date.now()}`)

  try {
    await runGit(['fetch', 'origin', 'main'])
    await runGit(['worktree', 'add', '-b', branch, worktreeDir, 'origin/main'])
    await runGit(['commit', '--allow-empty', '-m', `chore(retrospect): 調査用ブランチ — issue #${issue.number}\n\nIssue: ${issue.title}`], { cwd: worktreeDir })
    await runGit(['push', '-u', 'origin', branch], { cwd: worktreeDir })

    const prBody = [
      `## 関連 Issue`,
      `Closes #${issue.number}`,
      ``,
      `## サマリ`,
      issue.title,
      ``,
      `## 自動診断`,
      `この PR は dailyClaudeNews の retrospect ジョブ（10:00 JST）により自動作成されました。`,
      `当日の Issue が過去に類例の無い新規パターンであり、修正対象と判定されました。`,
      ``,
      `## Issue 本文（先頭1500字）`,
      issue.body.slice(0, 1500),
      ``,
      `---`,
      `修正コードをこのブランチに加え、レビュー後に merge してください。`,
      `不要な場合はブランチ \`${branch}\` を削除して PR を close してください。`,
    ].join('\n')

    const prUrl = await createDraftPr({
      repo: config.errorIssueRepo,
      title: `fix: ${cleanIssueTitle(issue.title)}`,
      body: prBody,
      head: branch,
    })
    return prUrl
  } catch (err) {
    console.warn(`[retrospect] PR 作成失敗 (issue #${issue.number}): ${(err as Error).message}`)
    return null
  } finally {
    try {
      await runGit(['worktree', 'remove', '--force', worktreeDir])
    } catch {
      // ignore
    }
  }
}

async function main(): Promise<void> {
  const dateStr = todayJst()
  console.log(`[${new Date().toISOString()}] [retrospect] 開始 (対象日: ${dateStr})`)

  let todays: GhIssue[]
  try {
    todays = await listIssues({
      repo: config.errorIssueRepo,
      state: 'all',
      search: `created:>=${dateStr}`,
      labels: ['dailyClaudeNews'],
    })
  } catch (err) {
    console.error(`[retrospect] issue 一覧取得失敗: ${(err as Error).message}`)
    process.exit(1)
  }

  console.log(`[retrospect] 当日の issue: ${todays.length} 件`)
  if (todays.length === 0) {
    console.log(`[retrospect] 何もすることがありません`)
    return
  }

  let allIssues: GhIssue[]
  try {
    allIssues = await listIssues({
      repo: config.errorIssueRepo,
      state: 'all',
      labels: ['dailyClaudeNews'],
      limit: 500,
    })
  } catch (err) {
    console.error(`[retrospect] 全 issue 一覧取得失敗: ${(err as Error).message}`)
    process.exit(1)
  }

  const todayNumbers = new Set(todays.map((i) => i.number))
  const historical = allIssues.filter((i) => !todayNumbers.has(i.number))
  const historicalFps = new Set(historical.map((i) => fingerprint(i.title)))

  const novel = todays.filter((t) => !historicalFps.has(fingerprint(t.title)))
  console.log(`[retrospect] 新規パターン: ${novel.length} 件 / 既知パターン: ${todays.length - novel.length} 件`)

  const fixable = novel.filter((i) => isFixable(i.title, i.labels.map((l) => l.name)))
  console.log(`[retrospect] 修正候補（既知の非修正対象を除く）: ${fixable.length} 件`)

  if (fixable.length === 0) return

  for (const issue of fixable) {
    await notifyMacOs(`dailyClaudeNews 新規 issue`, `#${issue.number}: ${issue.title.slice(0, 100)}`)
    const prUrl = await createDraftPrForIssue(issue, dateStr)
    if (prUrl) {
      console.log(`[retrospect] draft PR 作成: ${prUrl} (issue #${issue.number})`)
      await notifyMacOs(`修正 PR 作成`, prUrl)
    }
  }

  console.log(`[retrospect] 完了`)
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[retrospect] 失敗: ${(err as Error).message}`)
    process.exit(1)
  })
}

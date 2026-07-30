import { spawn } from 'node:child_process'
import { redact } from './redact.js'

export type GhIssueLabel = { name: string }

export type GhIssue = {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED'
  createdAt: string
  body: string
  labels: GhIssueLabel[]
  url: string
}

type RunOpts = { timeoutMs?: number; stdin?: string; cwd?: string }

function runGh(args: string[], opts: RunOpts = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 30_000)
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`gh ${args.join(' ')}: ${stderr.trim()}`))
      else resolve(stdout)
    })
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

export async function listIssues(opts: {
  repo: string
  state?: 'open' | 'closed' | 'all'
  search?: string
  labels?: string[]
  limit?: number
}): Promise<GhIssue[]> {
  const args = ['issue', 'list', '--repo', opts.repo, '--json', 'number,title,state,createdAt,body,labels,url']
  if (opts.state) args.push('--state', opts.state)
  if (opts.labels && opts.labels.length > 0) args.push('--label', opts.labels.join(','))
  if (opts.search) args.push('--search', opts.search)
  args.push('--limit', String(opts.limit ?? 500))
  const out = await runGh(args, { timeoutMs: 30_000 })
  return JSON.parse(out) as GhIssue[]
}

export async function findOpenIssueByTitle(repo: string, title: string): Promise<GhIssue | null> {
  const issues = await listIssues({ repo, state: 'open', search: `"${title}" in:title`, limit: 10 })
  return issues.find((i) => i.title === title) ?? null
}

export async function addIssueComment(repo: string, number: number, body: string): Promise<void> {
  // パブリック出力 sink: redact 必須 (ルールは ~/.claude/CLAUDE.md 参照)
  const safeBody = redact(body)
  await runGh(['issue', 'comment', String(number), '--repo', repo, '--body-file', '-'], {
    stdin: safeBody,
    timeoutMs: 20_000,
  })
}

/** 起票した issue の URL を返す（Discord 通知にリンクを載せるため）。 */
export async function createIssue(
  repo: string,
  title: string,
  body: string,
  labels: string[],
): Promise<string> {
  // パブリック出力 sink: redact 必須 (ルールは ~/.claude/CLAUDE.md 参照)
  const safeTitle = redact(title)
  const safeBody = redact(body)
  const safeLabels = labels.map((l) => redact(l))
  const args = ['issue', 'create', '--repo', repo, '--title', safeTitle, '--body-file', '-']
  if (safeLabels.length > 0) args.push('--label', safeLabels.join(','))
  const out = await runGh(args, { stdin: safeBody, timeoutMs: 30_000 })
  // gh issue create は作成した issue の URL を stdout に出す。
  // 前後に他の行が混ざっても拾えるよう URL 行だけを抜き出す。
  const url = out.split('\n').map((l) => l.trim()).find((l) => /^https?:\/\//.test(l))
  return url ?? ''
}

export async function ensureLabelExists(repo: string, name: string, color: string, description: string): Promise<void> {
  // 失敗は無視（既に存在する/権限不足等）
  try {
    await runGh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description], { timeoutMs: 15_000 })
  } catch {
    // ignore
  }
}

export async function createDraftPr(opts: {
  repo: string
  title: string
  body: string
  head: string
  base?: string
}): Promise<string> {
  // パブリック出力 sink: redact 必須 (ルールは ~/.claude/CLAUDE.md 参照)
  const safeTitle = redact(opts.title)
  const safeBody = redact(opts.body)
  const args = [
    'pr', 'create', '--draft',
    '--repo', opts.repo,
    '--title', safeTitle,
    '--body-file', '-',
    '--head', opts.head,
    '--base', opts.base ?? 'main',
  ]
  const out = await runGh(args, { stdin: safeBody, timeoutMs: 30_000 })
  return out.trim() // PR URL
}

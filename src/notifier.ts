import { spawn } from 'node:child_process'
import { config } from './config.js'
import type { Phase } from './types.js'

function runSilently(cmd: string, args: string[], stdin?: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', () => { clearTimeout(timer); resolve() })
    child.on('exit', () => { clearTimeout(timer); resolve() })
    if (stdin !== undefined) {
      child.stdin.end(stdin)
    } else {
      child.stdin.end()
    }
  })
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function notifyMacOs(title: string, message: string): Promise<void> {
  if (!config.macosNotification) return
  const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`
  await runSilently('osascript', ['-e', script], undefined, 5_000)
}

async function createIssue(title: string, body: string): Promise<void> {
  if (!config.errorIssueRepo) return
  await runSilently(
    'gh',
    ['issue', 'create', '--repo', config.errorIssueRepo, '--title', title, '--body-file', '-'],
    body,
    20_000,
  )
}

export async function notifyFailure(error: Error, ctx: { phase: Phase }): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const title = `[dailyClaudeNews] ${today} ${ctx.phase} で失敗`
  const body = [
    `## 概要`,
    `- 日付: ${today}`,
    `- 失敗フェーズ: \`${ctx.phase}\``,
    `- エラー: ${error.message}`,
    '',
    '## スタックトレース',
    '```',
    error.stack ?? '(stack なし)',
    '```',
    '',
    `自動起票: dailyClaudeNews notifier`,
  ].join('\n')

  await Promise.all([
    createIssue(title, body),
    notifyMacOs('dailyClaudeNews 失敗', `${ctx.phase}: ${error.message.slice(0, 120)}`),
  ])
}

import { spawn } from 'node:child_process'
import { PROJECT_ROOT } from './config.js'
import { redact } from './redact.js'

function git(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`))
      else resolve(stdout)
    })
  })
}

export async function commitAndPush(paths: string[], message: string): Promise<void> {
  for (const p of paths) {
    await git(['add', p])
  }

  const status = await git(['status', '--porcelain'])
  if (status.trim().length === 0) {
    console.log(redact('変更が無いためコミットをスキップします'))
    return
  }

  // パブリック出力 sink: redact 必須 (ルールは ~/.claude/CLAUDE.md 参照)
  const safeMessage = redact(message)
  await git(['commit', '-m', safeMessage])

  try {
    await git(['push', 'origin', 'main'])
  } catch (err) {
    console.warn(redact(`push 失敗、pull --rebase してリトライ: ${(err as Error).message}`))
    await git(['pull', '--rebase', 'origin', 'main'])
    await git(['push', 'origin', 'main'])
  }
}

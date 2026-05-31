import { config } from './config.js'
import { dedupe } from './deduper.js'
import { fetchAll } from './fetcher.js'
import { commitAndPush } from './git.js'
import { loadSeen, persist, split } from './historyFilter.js'
import { notifyFailure } from './notifier.js'
import { summarize } from './summarizer.js'
import type { Phase } from './types.js'
import { formatDate, write } from './writer.js'

function log(phase: Phase, message: string): void {
  console.log(`[${new Date().toISOString()}] [${phase}] ${message}`)
}

async function main(): Promise<void> {
  const phase: { current: Phase } = { current: 'init' }
  try {
    phase.current = 'fetch'
    log(phase.current, '開始')
    const raw = await fetchAll()
    log(phase.current, `取得 ${raw.length} 件`)

    phase.current = 'dedupe'
    const items = dedupe(raw)
    log(phase.current, `${raw.length} → ${items.length} 件（同run内重複排除後）`)

    phase.current = 'history-filter'
    const seen = await loadSeen()
    const { fresh, recurring } = split(items, seen)
    log(phase.current, `新規 ${fresh.length} 件 / 継続 ${recurring.length} 件 (履歴 ${seen.length} 件)`)

    phase.current = 'summarize'
    const today = new Date()
    log(phase.current, `claude (${config.model}) 呼び出し`)
    const { markdown, modelUsed } = await summarize(fresh, recurring)

    phase.current = 'write'
    const filePath = await write(markdown, today, {
      model: modelUsed,
      freshCount: fresh.length,
      recurringCount: recurring.length,
    })
    log(phase.current, `書き込み: ${filePath}`)

    phase.current = 'persist-history'
    await persist(items)
    log(phase.current, '履歴を更新')

    phase.current = 'git'
    const dateStr = formatDate(today)
    if (config.skipGitPush) {
      log(phase.current, 'SKIP_GIT_PUSH=true のため git push をスキップ')
    } else {
      await commitAndPush(
        [filePath, config.historyStatePath],
        `chore(daily): ${dateStr} のまとめ (新規 ${fresh.length} / 継続 ${recurring.length})`,
      )
      log(phase.current, 'push 完了')
    }

    console.log(`完了: ${filePath} (model: ${modelUsed})`)
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error(`[${phase.current}] 失敗: ${e.message}`)
    if (e.stack) console.error(e.stack)
    try {
      await notifyFailure(e, { phase: phase.current })
    } catch (notifyErr) {
      console.error(`通知も失敗: ${(notifyErr as Error).message}`)
    }
    process.exit(1)
  }
}

main()

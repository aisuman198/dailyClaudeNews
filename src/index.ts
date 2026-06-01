import { enrichWithBodies } from './articleFetcher.js'
import { loadCautions, persistCautions } from './cautionStore.js'
import { config } from './config.js'
import { dedupe } from './deduper.js'
import { fetchAll } from './fetcher.js'
import { commitAndPush } from './git.js'
import { loadSeen, persist, split } from './historyFilter.js'
import { notifyFailure } from './notifier.js'
import { prioritizeAndPad } from './priorityFilter.js'
import { review } from './reviewer.js'
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
    const deduped = dedupe(raw)
    log(phase.current, `${raw.length} → ${deduped.length} 件（同run内重複排除後）`)

    phase.current = 'prioritize'
    const { items, stats } = prioritizeAndPad(deduped)
    log(
      phase.current,
      `優先 ${stats.priorityCount} 件 / 補充 ${stats.paddedCount} 件 / 計 ${stats.total} 件 (キーワード: ${config.priorityKeywords.join(',')})`,
    )

    phase.current = 'history-filter'
    const seen = await loadSeen()
    let { fresh, recurring } = split(items, seen)
    log(phase.current, `新規 ${fresh.length} 件 / 継続 ${recurring.length} 件 (履歴 ${seen.length} 件)`)

    if (config.e2eMaxArticles > 0) {
      const maxFresh = Math.min(fresh.length, Math.ceil(config.e2eMaxArticles / 2))
      const maxRecurring = config.e2eMaxArticles - maxFresh
      fresh = fresh.slice(0, maxFresh)
      recurring = recurring.slice(0, maxRecurring)
      log(phase.current, `E2E_MAX_ARTICLES=${config.e2eMaxArticles} のため 新規 ${fresh.length} 件 / 継続 ${recurring.length} 件 に縮小`)
    }

    phase.current = 'enrich-bodies'
    const [freshEnriched, recurringEnriched] = await Promise.all([
      enrichWithBodies(fresh),
      enrichWithBodies(recurring),
    ])

    phase.current = 'summarize'
    const today = new Date()
    const knownCautions = await loadCautions()
    log(phase.current, `claude (${config.model}) 呼び出し / 既知の注意 ${knownCautions.length} 件`)
    const { markdown: draftMarkdown, modelUsed } = await summarize(
      freshEnriched,
      recurringEnriched,
      knownCautions,
    )

    // draft は常時保存（診断用。state/draft-*.md は .gitignore で除外済み）
    {
      const { promises: fs } = await import('node:fs')
      const path = await import('node:path')
      const draftPath = path.join('state', `draft-${formatDate(today)}.md`)
      await fs.writeFile(draftPath, draftMarkdown, 'utf8')
      log(phase.current, `draft 保存: ${draftPath}`)
    }

    phase.current = 'review'
    log(phase.current, `claude (${config.reviewerModel}) でレビュー`)
    const { correctedMarkdown, newCautions } = await review(draftMarkdown, knownCautions)
    log(phase.current, `レビュー完了 / 新規注意 ${newCautions.length} 件`)

    phase.current = 'write'
    const filePath = await write(correctedMarkdown, today, {
      model: modelUsed,
      freshCount: fresh.length,
      recurringCount: recurring.length,
    })
    log(phase.current, `書き込み: ${filePath}`)

    phase.current = 'persist-history'
    await persist(items)
    log(phase.current, '履歴を更新')

    phase.current = 'persist-cautions'
    const allCautions = await persistCautions(newCautions)
    log(phase.current, `累計注意リスト ${allCautions.length} 件`)

    phase.current = 'git'
    const dateStr = formatDate(today)
    if (config.skipGitPush) {
      log(phase.current, 'SKIP_GIT_PUSH=true のため git push をスキップ')
    } else {
      await commitAndPush(
        [filePath, config.historyStatePath, config.cautionsStatePath],
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

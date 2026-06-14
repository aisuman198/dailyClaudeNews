import { enrichWithBodies } from './articleFetcher.js'
import { loadCautions, persistCautions } from './cautionStore.js'
import { config } from './config.js'
import { dedupe, normalizeUrl } from './deduper.js'
import { fetchAll } from './fetcher.js'
import { verifyDeployment } from './deploymentVerifier.js'
import { commitAndPush } from './git.js'
import { pickHeroImages, pickHeroMatches } from './heroMatcher.js'
import { dropUnchangedRecurring, loadSeen, persist, split } from './historyFilter.js'
import { notifyFailure } from './notifier.js'
import { prioritizeAndPad } from './priorityFilter.js'
import { redact } from './redact.js'
import { review } from './reviewer.js'
import { summarize } from './summarizer.js'
import type { Phase } from './types.js'
import { formatDate, write } from './writer.js'

// パブリック出力 sink (ログ): 必ず redact を通す。
// ルールは ~/.claude/CLAUDE.md / 実装は ~/.claude/scripts/redact.cjs 参照。
function log(phase: Phase, message: string): void {
  console.log(redact(`[${new Date().toISOString()}] [${phase}] ${message}`))
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
    const [freshAll, recurringAll] = await Promise.all([
      enrichWithBodies(fresh),
      enrichWithBodies(recurring),
    ])
    // 本文取得に失敗した記事はリトライ後も bodyText 未設定。これらは表示しない (記事カードを出さない)。
    const freshEnriched = freshAll.filter((it) => !!it.bodyText)
    let recurringEnriched = recurringAll.filter((it) => !!it.bodyText)
    const droppedFresh = freshAll.length - freshEnriched.length
    const droppedRecurring = recurringAll.length - recurringEnriched.length
    if (droppedFresh + droppedRecurring > 0) {
      log(
        phase.current,
        `本文取得失敗で除外: 新規 ${droppedFresh} / 継続 ${droppedRecurring} 件 (残 新規 ${freshEnriched.length} / 継続 ${recurringEnriched.length})`,
      )
    }

    // 継続話題のうち、bodyText が前回観測時と同一のもの (新情報なし) を除外する。
    // RECURRING_DROP_UNCHANGED=false で無効化可能。
    if (config.recurringDropUnchanged) {
      const beforeCount = recurringEnriched.length
      const { kept, dropped } = dropUnchangedRecurring(recurringEnriched, seen)
      recurringEnriched = kept
      const changedCount = recurringEnriched.filter((it) => it.bodyChanged).length
      log(
        phase.current,
        `継続話題: 本文無変化のため ${dropped.length} 件除外 (残 ${recurringEnriched.length}/${beforeCount} 件、うち本文更新 ${changedCount} 件)`,
      )
    }

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

    phase.current = 'pick-hero'
    // enrich-bodies で og:image も同時に取得済み。
    // ハイライト 3 本に対応する記事のスコアマッチで上位 3 URL を選ぶ。
    const allEnriched = [...freshEnriched, ...recurringEnriched]
    // hero_matches: highlight ↔ 記事 の対応を単一の真実として確定する (案A)。
    // hero_images は heroMatches から導出し、後方互換のため引き続き出力する。
    const heroMatches = pickHeroMatches(correctedMarkdown, allEnriched)
    const heroImages = heroMatches.map((m) => m.ogImage)
    const heroResolved = heroImages.filter((u) => u !== null).length
    log(phase.current, `ヒーロー対応 ${heroMatches.length} 件 / 画像 ${heroResolved} 件 解決`)

    phase.current = 'write'
    const filePath = await write(correctedMarkdown, today, {
      model: modelUsed,
      // 実際に表示される件数 (本文取得失敗で除外したものは含まない)
      freshCount: freshEnriched.length,
      recurringCount: recurringEnriched.length,
      heroImages,
      heroMatches,
    })
    log(phase.current, `書き込み: ${filePath}`)

    phase.current = 'persist-history'
    // items は prioritize 直後の配列で bodyText 未取得。enrich で得た本文を URL で
    // 突き合わせて付与し、seen.json に bodyHash を書き込めるようにする。
    // (e2e 切り詰めで脱落した items は bodyText 無しのまま渡るが、URL は seen 入りする)
    const bodyByUrl = new Map<string, string>()
    for (const it of [...freshAll, ...recurringAll]) {
      if (it.bodyText) bodyByUrl.set(normalizeUrl(it.url), it.bodyText)
    }
    const itemsForPersist = items.map((it) => {
      const body = bodyByUrl.get(normalizeUrl(it.url))
      return body ? { ...it, bodyText: body } : it
    })
    await persist(itemsForPersist)
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
        `chore(daily): ${dateStr} のまとめ (新規 ${freshEnriched.length} / 継続 ${recurringEnriched.length})`,
      )
      log(phase.current, 'push 完了')
    }

    phase.current = 'verify-deploy'
    if (config.skipGitPush) {
      log(phase.current, 'SKIP_GIT_PUSH=true のため公開確認もスキップ')
    } else if (!config.verifyDeploymentEnabled) {
      log(phase.current, 'VERIFY_DEPLOYMENT_ENABLED=false のためスキップ')
    } else {
      log(phase.current, `${config.pagesBaseUrl}/daily/${dateStr}.html の公開を確認`)
      await verifyDeployment(dateStr)
      log(phase.current, 'OK')
    }

    console.log(redact(`完了: ${filePath} (model: ${modelUsed})`))
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error(redact(`[${phase.current}] 失敗: ${e.message}`))
    if (e.stack) console.error(redact(e.stack))
    try {
      await notifyFailure(e, { phase: phase.current })
    } catch (notifyErr) {
      console.error(redact(`通知も失敗: ${(notifyErr as Error).message}`))
    }
    process.exit(1)
  }
}

main()

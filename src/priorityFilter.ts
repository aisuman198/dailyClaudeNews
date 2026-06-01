import { config } from './config.js'
import type { NewsItem } from './types.js'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isPriorityItem(item: NewsItem, keywords: string[]): boolean {
  const haystack = `${item.title} ${item.url}`
  return keywords.some((k) => {
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(k)}(?:[^\\p{L}\\p{N}]|$)`, 'iu')
    return re.test(haystack)
  })
}

function scoreOf(item: NewsItem): number {
  return item.score ?? 0
}

function sortByImportance(a: NewsItem, b: NewsItem): number {
  const sa = scoreOf(a)
  const sb = scoreOf(b)
  if (sa !== sb) return sb - sa
  return b.publishedAt.getTime() - a.publishedAt.getTime()
}

export type PrioritizeStats = {
  priorityCount: number
  paddedCount: number
  total: number
}

/**
 * 優先キーワード（Anthropic/Codex 等）でフィルタした記事を返す。
 * - priority 件数が `priorityMinNoPad` を超えるなら priority のみ返す（補充なし）
 * - priority 件数が `priorityMinNoPad` 以下なら、`priorityPadTarget` 件まで他の記事で補充
 *
 * 補充記事は score 降順 → publishedAt 降順で選ばれる。
 */
export function prioritizeAndPad(items: NewsItem[]): { items: NewsItem[]; stats: PrioritizeStats } {
  const keywords = config.priorityKeywords
  const minNoPad = config.priorityMinNoPad
  const padTarget = config.priorityPadTarget

  if (keywords.length === 0) {
    // 優先キーワード未設定なら何もしない
    return { items, stats: { priorityCount: items.length, paddedCount: 0, total: items.length } }
  }

  const priority = items.filter((i) => isPriorityItem(i, keywords))
  if (priority.length > minNoPad) {
    return {
      items: priority.slice().sort(sortByImportance),
      stats: { priorityCount: priority.length, paddedCount: 0, total: priority.length },
    }
  }

  const priorityUrls = new Set(priority.map((i) => i.url))
  const others = items
    .filter((i) => !priorityUrls.has(i.url))
    .sort(sortByImportance)
  const needed = Math.max(0, padTarget - priority.length)
  const filler = others.slice(0, needed)

  return {
    items: [...priority, ...filler].sort(sortByImportance),
    stats: {
      priorityCount: priority.length,
      paddedCount: filler.length,
      total: priority.length + filler.length,
    },
  }
}

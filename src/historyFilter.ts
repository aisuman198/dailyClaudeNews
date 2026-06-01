import { promises as fs } from 'node:fs'
import path from 'node:path'
import { config, resolvePath } from './config.js'
import { jaccardSimilarity, normalizeTitle, normalizeUrl } from './deduper.js'
import { redact } from './redact.js'
import type { NewsItem, SeenEntry, SeenStore } from './types.js'

const TODAY = (): string => new Date().toISOString().slice(0, 10)

export async function loadSeen(): Promise<SeenEntry[]> {
  const p = resolvePath(config.historyStatePath)
  try {
    const raw = await fs.readFile(p, 'utf8')
    const parsed = JSON.parse(raw) as SeenStore
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return []
    return parsed.entries
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    if (config.verbose) console.warn(redact(`seen.json 読み込み失敗、空で続行: ${(err as Error).message}`))
    return []
  }
}

function matchSeen(item: NewsItem, seen: SeenEntry[], threshold: number): SeenEntry | null {
  const nUrl = normalizeUrl(item.url)
  const nTitle = normalizeTitle(item.title)
  for (const e of seen) {
    if (e.normalizedUrl === nUrl) return e
    if (e.normalizedTitle && nTitle && e.normalizedTitle === nTitle) return e
    if (e.normalizedTitle && nTitle && jaccardSimilarity(e.normalizedTitle, nTitle) >= threshold) {
      return e
    }
  }
  return null
}

export function split(
  items: NewsItem[],
  seen: SeenEntry[],
): { fresh: NewsItem[]; recurring: NewsItem[] } {
  const threshold = config.dedupTitleSimilarity
  const fresh: NewsItem[] = []
  const recurring: NewsItem[] = []

  for (const it of items) {
    const hit = matchSeen(it, seen, threshold)
    if (hit) {
      recurring.push({
        ...it,
        firstSeenDate: hit.firstSeenDate,
        occurrences: hit.occurrences,
      })
    } else {
      fresh.push(it)
    }
  }
  return { fresh, recurring }
}

export async function persist(items: NewsItem[]): Promise<void> {
  const today = TODAY()
  const prior = await loadSeen()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - config.historyRetentionDays)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const fresh = prior.filter((e) => e.lastSeenDate >= cutoffStr)
  const byUrl = new Map<string, SeenEntry>()
  for (const e of fresh) byUrl.set(e.normalizedUrl, e)

  for (const it of items) {
    const nUrl = normalizeUrl(it.url)
    const nTitle = normalizeTitle(it.title)
    const existing = byUrl.get(nUrl)
    if (existing) {
      existing.lastSeenDate = today
      existing.occurrences += 1
      if (!existing.normalizedTitle) existing.normalizedTitle = nTitle
    } else {
      byUrl.set(nUrl, {
        normalizedUrl: nUrl,
        normalizedTitle: nTitle,
        firstSeenDate: today,
        lastSeenDate: today,
        occurrences: 1,
      })
    }
  }

  const store: SeenStore = { version: 1, entries: [...byUrl.values()] }
  const filePath = resolvePath(config.historyStatePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(store, null, 2) + '\n', 'utf8')
}

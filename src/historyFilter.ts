import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { config, resolvePath } from './config.js'
import { jaccardSimilarity, normalizeTitle, normalizeUrl } from './deduper.js'
import { redact } from './redact.js'
import type { NewsItem, SeenEntry, SeenStore } from './types.js'

const TODAY = (): string => new Date().toISOString().slice(0, 10)

// bodyText を正規化してから SHA-256 を取り先頭 16 桁を返す。
// 連続空白の差や末尾改行のような無意味な差分でハッシュが変わらないようにする。
export function hashBody(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

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

/**
 * enrich 済みの「継続話題」のうち、bodyText のハッシュが seen.json と一致するもの
 * (= 前回観測時から本文が変わっていない = 新情報なし) を除外する。
 *
 * - bodyText が未取得の記事はそのまま残す (判定不能)
 * - seen に bodyHash が未保存の場合もそのまま残す (初回観測なので比較不能)
 * - bodyHash が異なる場合は kept に入れ、`bodyChanged: true` を付与
 *
 * 戻り値: kept = 出力対象として残す配列 / dropped = 除外した記事の URL
 */
export function dropUnchangedRecurring(
  recurring: NewsItem[],
  seen: SeenEntry[],
): { kept: NewsItem[]; dropped: string[] } {
  const byUrl = new Map<string, SeenEntry>()
  for (const e of seen) byUrl.set(e.normalizedUrl, e)

  const kept: NewsItem[] = []
  const dropped: string[] = []
  for (const it of recurring) {
    if (!it.bodyText) {
      kept.push(it)
      continue
    }
    const entry = byUrl.get(normalizeUrl(it.url))
    if (!entry || !entry.bodyHash) {
      kept.push(it)
      continue
    }
    const currentHash = hashBody(it.bodyText)
    if (currentHash === entry.bodyHash) {
      dropped.push(it.url)
      continue
    }
    kept.push({ ...it, bodyChanged: true })
  }
  return { kept, dropped }
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
    const hasBody = typeof it.bodyText === 'string' && it.bodyText.length > 0
    const bodyHash = hasBody ? hashBody(it.bodyText!) : undefined
    const bodyLength = hasBody ? it.bodyText!.length : undefined
    const existing = byUrl.get(nUrl)
    if (existing) {
      existing.lastSeenDate = today
      existing.occurrences += 1
      if (!existing.normalizedTitle) existing.normalizedTitle = nTitle
      // bodyHash は本文取得に成功した場合のみ更新。失敗した日は前回値を保持。
      if (bodyHash) {
        existing.bodyHash = bodyHash
        existing.bodyLength = bodyLength
      }
    } else {
      const entry: SeenEntry = {
        normalizedUrl: nUrl,
        normalizedTitle: nTitle,
        firstSeenDate: today,
        lastSeenDate: today,
        occurrences: 1,
      }
      if (bodyHash) {
        entry.bodyHash = bodyHash
        entry.bodyLength = bodyLength
      }
      byUrl.set(nUrl, entry)
    }
  }

  const store: SeenStore = { version: 1, entries: [...byUrl.values()] }
  const filePath = resolvePath(config.historyStatePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(store, null, 2) + '\n', 'utf8')
}

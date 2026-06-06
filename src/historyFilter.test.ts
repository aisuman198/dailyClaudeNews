import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsItem, SeenStore } from './types.js'

let tmpDir: string
let statePath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcn-history-'))
  statePath = path.join(tmpDir, 'seen.json')
  process.env.HISTORY_STATE_PATH = statePath
  process.env.HISTORY_RETENTION_DAYS = '14'
  process.env.DEDUP_TITLE_SIMILARITY = '0.85'
  vi.resetModules()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  delete process.env.HISTORY_STATE_PATH
  delete process.env.HISTORY_RETENTION_DAYS
  delete process.env.DEDUP_TITLE_SIMILARITY
})

async function importFresh() {
  return (await import('./historyFilter.js')) as typeof import('./historyFilter.js')
}

const item = (over: Partial<NewsItem> = {}): NewsItem => ({
  source: 'anthropic-blog',
  title: 'sample title',
  url: 'https://example.com/x',
  publishedAt: new Date('2026-06-01'),
  ...over,
})

describe('historyFilter', () => {
  it('loadSeen returns [] when file does not exist', async () => {
    const { loadSeen } = await importFresh()
    expect(await loadSeen()).toEqual([])
  })

  it('persist creates state file and round-trips entries', async () => {
    const { persist, loadSeen } = await importFresh()
    await persist([item({ url: 'https://a.test/1', title: 'first' })])
    const loaded = await loadSeen()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.normalizedUrl).toBe('https://a.test/1')
    expect(loaded[0]!.occurrences).toBe(1)
  })

  it('split classifies seen vs unseen items', async () => {
    const { persist, loadSeen, split } = await importFresh()
    await persist([item({ url: 'https://a.test/seen', title: 'seen one' })])
    const seen = await loadSeen()
    const result = split(
      [
        item({ url: 'https://a.test/seen', title: 'seen one' }),
        item({ url: 'https://b.test/new', title: 'new one' }),
      ],
      seen,
    )
    expect(result.fresh).toHaveLength(1)
    expect(result.fresh[0]!.url).toBe('https://b.test/new')
    expect(result.recurring).toHaveLength(1)
    expect(result.recurring[0]!.firstSeenDate).toBeDefined()
  })

  it('persist drops entries older than retention window', async () => {
    const { persist } = await importFresh()
    const old = '2020-01-01'
    const store: SeenStore = {
      version: 1,
      entries: [
        {
          normalizedUrl: 'https://old.test/x',
          normalizedTitle: 'old',
          firstSeenDate: old,
          lastSeenDate: old,
          occurrences: 1,
        },
      ],
    }
    await fs.writeFile(statePath, JSON.stringify(store), 'utf8')
    await persist([item({ url: 'https://new.test/y', title: 'new' })])
    const saved = JSON.parse(await fs.readFile(statePath, 'utf8')) as SeenStore
    const urls = saved.entries.map((e) => e.normalizedUrl)
    expect(urls).not.toContain('https://old.test/x')
    expect(urls).toContain('https://new.test/y')
  })

  it('persist increments occurrences for existing entries', async () => {
    const { persist } = await importFresh()
    const it1 = item({ url: 'https://a.test/x', title: 'same' })
    await persist([it1])
    await persist([it1])
    const saved = JSON.parse(await fs.readFile(statePath, 'utf8')) as SeenStore
    expect(saved.entries).toHaveLength(1)
    expect(saved.entries[0]!.occurrences).toBe(2)
  })

  it('persist stores bodyHash and bodyLength when bodyText is present', async () => {
    const { persist, hashBody } = await importFresh()
    const body = 'これは本文の長いテキストです。'.repeat(30)
    await persist([item({ url: 'https://a.test/x', title: 'with body', bodyText: body })])
    const saved = JSON.parse(await fs.readFile(statePath, 'utf8')) as SeenStore
    expect(saved.entries[0]!.bodyHash).toBe(hashBody(body))
    expect(saved.entries[0]!.bodyLength).toBe(body.length)
  })

  it('persist retains prior bodyHash on a day when body fetch fails', async () => {
    const { persist, hashBody } = await importFresh()
    const body = 'first body text content abcdef'.repeat(20)
    await persist([item({ url: 'https://a.test/x', title: 't', bodyText: body })])
    // 翌日の取得失敗を模擬: bodyText 無しで persist
    await persist([item({ url: 'https://a.test/x', title: 't' })])
    const saved = JSON.parse(await fs.readFile(statePath, 'utf8')) as SeenStore
    expect(saved.entries[0]!.bodyHash).toBe(hashBody(body))
    expect(saved.entries[0]!.occurrences).toBe(2)
  })

  it('dropUnchangedRecurring removes items whose body hash matches stored hash', async () => {
    const { persist, loadSeen, dropUnchangedRecurring } = await importFresh()
    const body = 'unchanged body content '.repeat(30)
    await persist([item({ url: 'https://a.test/same', title: 'same', bodyText: body })])
    const seen = await loadSeen()
    const { kept, dropped } = dropUnchangedRecurring(
      [item({ url: 'https://a.test/same', title: 'same', bodyText: body })],
      seen,
    )
    expect(kept).toHaveLength(0)
    expect(dropped).toEqual(['https://a.test/same'])
  })

  it('dropUnchangedRecurring keeps items whose body hash changed and marks bodyChanged', async () => {
    const { persist, loadSeen, dropUnchangedRecurring } = await importFresh()
    const oldBody = 'first version of the article body '.repeat(30)
    const newBody = oldBody + ' NEW PARAGRAPH WITH ADDITIONAL FACTS '.repeat(10)
    await persist([item({ url: 'https://a.test/x', title: 't', bodyText: oldBody })])
    const seen = await loadSeen()
    const { kept, dropped } = dropUnchangedRecurring(
      [item({ url: 'https://a.test/x', title: 't', bodyText: newBody })],
      seen,
    )
    expect(dropped).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.bodyChanged).toBe(true)
  })

  it('dropUnchangedRecurring keeps items when seen has no bodyHash (legacy entries)', async () => {
    const { loadSeen, dropUnchangedRecurring } = await importFresh()
    // 旧形式 seen.json を直書き (bodyHash 無し)
    const store: SeenStore = {
      version: 1,
      entries: [
        {
          normalizedUrl: 'https://a.test/legacy',
          normalizedTitle: 'legacy',
          firstSeenDate: '2026-06-01',
          lastSeenDate: '2026-06-01',
          occurrences: 1,
        },
      ],
    }
    await fs.writeFile(statePath, JSON.stringify(store), 'utf8')
    const seen = await loadSeen()
    const { kept, dropped } = dropUnchangedRecurring(
      [item({ url: 'https://a.test/legacy', title: 'legacy', bodyText: 'whatever body' })],
      seen,
    )
    expect(dropped).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.bodyChanged).toBeUndefined()
  })

  it('dropUnchangedRecurring keeps items without bodyText (fetch failed)', async () => {
    const { persist, loadSeen, dropUnchangedRecurring } = await importFresh()
    await persist([item({ url: 'https://a.test/x', title: 't', bodyText: 'body text content'.repeat(10) })])
    const seen = await loadSeen()
    const { kept, dropped } = dropUnchangedRecurring(
      [item({ url: 'https://a.test/x', title: 't' })], // bodyText 無し
      seen,
    )
    expect(dropped).toHaveLength(0)
    expect(kept).toHaveLength(1)
  })
})

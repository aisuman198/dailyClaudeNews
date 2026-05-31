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
})

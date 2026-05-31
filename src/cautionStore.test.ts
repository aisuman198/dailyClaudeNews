import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let statePath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcn-cautions-'))
  statePath = path.join(tmpDir, 'cautions.json')
  process.env.CAUTIONS_STATE_PATH = statePath
  vi.resetModules()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  delete process.env.CAUTIONS_STATE_PATH
})

async function importFresh() {
  return (await import('./cautionStore.js')) as typeof import('./cautionStore.js')
}

describe('cautionStore', () => {
  it('loadCautions returns [] when file does not exist', async () => {
    const { loadCautions } = await importFresh()
    expect(await loadCautions()).toEqual([])
  })

  it('persistCautions creates file and round-trips entries', async () => {
    const { persistCautions, loadCautions } = await importFresh()
    await persistCautions([{ term: 'OpenRouter', rule: '原文ママで表記', context: '誤訳発見' }])
    const loaded = await loadCautions()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.term).toBe('OpenRouter')
    expect(loaded[0]!.rule).toBe('原文ママで表記')
    expect(loaded[0]!.occurrences).toBe(1)
    expect(loaded[0]!.examples).toEqual(['誤訳発見'])
  })

  it('persistCautions merges by term case-insensitively and increments occurrences', async () => {
    const { persistCautions } = await importFresh()
    await persistCautions([{ term: 'OpenRouter', rule: '原文ママ', context: 'A' }])
    await persistCautions([{ term: 'openrouter', rule: '原文ママ', context: 'B' }])
    await persistCautions([{ term: 'OpenRouter', rule: '原文ママ', context: 'C' }])
    const saved = JSON.parse(await fs.readFile(statePath, 'utf8')) as { entries: Array<{ term: string; occurrences: number; examples: string[] }> }
    expect(saved.entries).toHaveLength(1)
    expect(saved.entries[0]!.occurrences).toBe(3)
    expect(saved.entries[0]!.examples).toEqual(['A', 'B', 'C'])
  })

  it('persistCautions trims oldest example when over MAX_EXAMPLES', async () => {
    const { persistCautions } = await importFresh()
    await persistCautions([
      { term: 'X', rule: 'r', context: '1' },
      { term: 'X', rule: 'r', context: '2' },
      { term: 'X', rule: 'r', context: '3' },
      { term: 'X', rule: 'r', context: '4' },
    ])
    const saved = JSON.parse(await fs.readFile(statePath, 'utf8')) as { entries: Array<{ examples: string[] }> }
    expect(saved.entries[0]!.examples).toEqual(['2', '3', '4'])
  })

  it('persistCautions ignores empty term entries', async () => {
    const { persistCautions, loadCautions } = await importFresh()
    await persistCautions([
      { term: '', rule: 'noop' },
      { term: '   ', rule: 'noop' },
      { term: 'Valid', rule: 'r' },
    ])
    const loaded = await loadCautions()
    expect(loaded.map((c) => c.term)).toEqual(['Valid'])
  })

  it('persistCautions defaults rule to 原文ママで表記 when empty', async () => {
    const { persistCautions, loadCautions } = await importFresh()
    await persistCautions([{ term: 'Foo', rule: '' }])
    const loaded = await loadCautions()
    expect(loaded[0]!.rule).toBe('原文ママで表記')
  })
})

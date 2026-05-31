import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcn-writer-'))
  process.env.OUTPUT_DIR = tmpDir
  vi.resetModules()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  delete process.env.OUTPUT_DIR
})

async function importFresh() {
  return (await import('./writer.js')) as typeof import('./writer.js')
}

describe('writer', () => {
  it('formatDate returns YYYY-MM-DD in local time', async () => {
    const { formatDate } = await importFresh()
    expect(formatDate(new Date(2026, 5, 1))).toBe('2026-06-01')
  })

  it('write creates file with frontmatter and trailing newline', async () => {
    const { write } = await importFresh()
    const file = await write('## hello\n\nworld', new Date(2026, 5, 1), {
      model: 'claude-sonnet-4-6',
      freshCount: 3,
      recurringCount: 2,
    })
    expect(path.basename(file)).toBe('2026-06-01.md')
    const content = await fs.readFile(file, 'utf8')
    expect(content).toMatch(/^---\n/)
    expect(content).toContain('date: 2026-06-01')
    expect(content).toContain('model: claude-sonnet-4-6')
    expect(content).toContain('fresh_count: 3')
    expect(content).toContain('recurring_count: 2')
    expect(content).toContain('layout: default')
    expect(content).toContain('title: "2026-06-01 のニュース"')
    expect(content).toContain('## hello')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('write overwrites existing file (idempotent)', async () => {
    const { write } = await importFresh()
    const d = new Date(2026, 5, 1)
    const meta = { model: 'm', freshCount: 0, recurringCount: 0 }
    const first = await write('first', d, meta)
    const second = await write('second', d, meta)
    expect(first).toBe(second)
    const content = await fs.readFile(second, 'utf8')
    expect(content).toContain('second')
    expect(content).not.toContain('first')
  })
})

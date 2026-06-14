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
    expect(content).toContain('layout: daily')
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

  it('writes hero_images array when provided', async () => {
    const { write } = await importFresh()
    const file = await write('## hello', new Date(2026, 5, 1), {
      model: 'm',
      freshCount: 0,
      recurringCount: 0,
      heroImages: [
        'https://cdn.anthropic.com/a.png',
        null,
        'https://cdn.anthropic.com/c.png',
      ],
    })
    const content = await fs.readFile(file, 'utf8')
    expect(content).toContain('hero_images:')
    expect(content).toContain('  - "https://cdn.anthropic.com/a.png"')
    expect(content).toContain('  - null')
    expect(content).toContain('  - "https://cdn.anthropic.com/c.png"')
  })

  it('omits hero_images when not provided', async () => {
    const { write } = await importFresh()
    const file = await write('## hello', new Date(2026, 5, 1), {
      model: 'm',
      freshCount: 0,
      recurringCount: 0,
    })
    const content = await fs.readFile(file, 'utf8')
    expect(content).not.toContain('hero_images:')
  })

  it('writes hero_matches block when provided', async () => {
    const { write } = await importFresh()
    const file = await write('## hello', new Date(2026, 5, 1), {
      model: 'm',
      freshCount: 0,
      recurringCount: 0,
      heroMatches: [
        {
          highlight: 'TCSとAnthropicが提携を発表',
          articleUrl: 'https://www.anthropic.com/news/tcs',
          ogImage: 'https://cdn.anthropic.com/tcs.png',
        },
        { highlight: '無関係な話題', articleUrl: null, ogImage: null },
      ],
    })
    const content = await fs.readFile(file, 'utf8')
    expect(content).toContain('hero_matches:')
    expect(content).toContain('  - highlight: "TCSとAnthropicが提携を発表"')
    expect(content).toContain('    article_url: "https://www.anthropic.com/news/tcs"')
    expect(content).toContain('    og_image: "https://cdn.anthropic.com/tcs.png"')
    expect(content).toContain('    article_url: null')
    expect(content).toContain('    og_image: null')
  })

  it('omits hero_matches when not provided', async () => {
    const { write } = await importFresh()
    const file = await write('## hello', new Date(2026, 5, 1), {
      model: 'm',
      freshCount: 0,
      recurringCount: 0,
    })
    const content = await fs.readFile(file, 'utf8')
    expect(content).not.toContain('hero_matches:')
  })

  it('escapes double quotes and backslashes in image URLs', async () => {
    const { write } = await importFresh()
    const file = await write('x', new Date(2026, 5, 1), {
      model: 'm',
      freshCount: 0,
      recurringCount: 0,
      heroImages: ['https://x/a"b\\c.png', null, null],
    })
    const content = await fs.readFile(file, 'utf8')
    expect(content).toContain('  - "https://x/a\\"b\\\\c.png"')
  })
})

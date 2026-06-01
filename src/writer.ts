import { promises as fs } from 'node:fs'
import path from 'node:path'
import { config, resolvePath } from './config.js'

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type FrontmatterInput = {
  date: string
  model: string
  freshCount: number
  recurringCount: number
}

function frontmatter(fm: FrontmatterInput): string {
  return [
    '---',
    `title: "${fm.date} のニュース"`,
    `layout: daily`,
    `date: ${fm.date}`,
    'generated_by: dailyClaudeNews v0.1',
    `model: ${fm.model}`,
    `fresh_count: ${fm.freshCount}`,
    `recurring_count: ${fm.recurringCount}`,
    '---',
    '',
  ].join('\n')
}

export async function write(
  markdown: string,
  date: Date,
  meta: { model: string; freshCount: number; recurringCount: number },
): Promise<string> {
  const dateStr = formatDate(date)
  const outDir = resolvePath(config.outputDir)
  await fs.mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, `${dateStr}.md`)
  const body = frontmatter({ date: dateStr, ...meta }) + markdown.trimEnd() + '\n'
  await fs.writeFile(filePath, body, 'utf8')
  return filePath
}

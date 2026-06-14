import { promises as fs } from 'node:fs'
import path from 'node:path'
import { config, resolvePath } from './config.js'
import type { HeroMatch } from './heroMatcher.js'

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type FrontmatterInput = {
  date: string
  model: string
  freshCount: number
  recurringCount: number
  heroImages?: (string | null)[]
  heroMatches?: HeroMatch[]
}

function yamlString(s: string): string {
  // ダブルクオート文字列。バックスラッシュとダブルクオートをエスケープ。
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function frontmatter(fm: FrontmatterInput): string {
  const lines: string[] = [
    '---',
    `title: "${fm.date} のニュース"`,
    `layout: daily`,
    `date: ${fm.date}`,
    'generated_by: dailyClaudeNews v0.1',
    `model: ${fm.model}`,
    `fresh_count: ${fm.freshCount}`,
    `recurring_count: ${fm.recurringCount}`,
  ]
  if (fm.heroImages && fm.heroImages.length > 0) {
    lines.push('hero_images:')
    for (const u of fm.heroImages) {
      lines.push(u ? `  - ${yamlString(u)}` : '  - null')
    }
  }
  // hero_matches: highlight ↔ 記事 の対応関係を単一の真実として出力する (案A)。
  // クライアント (daily.js) はこの article_url でカードを特定し、マッチング再計算を避ける。
  if (fm.heroMatches && fm.heroMatches.length > 0) {
    lines.push('hero_matches:')
    for (const m of fm.heroMatches) {
      lines.push(`  - highlight: ${yamlString(m.highlight)}`)
      lines.push(`    article_url: ${m.articleUrl ? yamlString(m.articleUrl) : 'null'}`)
      lines.push(`    og_image: ${m.ogImage ? yamlString(m.ogImage) : 'null'}`)
    }
  }
  lines.push('---', '')
  return lines.join('\n')
}

export async function write(
  markdown: string,
  date: Date,
  meta: {
    model: string
    freshCount: number
    recurringCount: number
    heroImages?: (string | null)[]
    heroMatches?: HeroMatch[]
  },
): Promise<string> {
  const dateStr = formatDate(date)
  const outDir = resolvePath(config.outputDir)
  await fs.mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, `${dateStr}.md`)
  const body = frontmatter({ date: dateStr, ...meta }) + markdown.trimEnd() + '\n'
  await fs.writeFile(filePath, body, 'utf8')
  return filePath
}

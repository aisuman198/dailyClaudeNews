import { promises as fs } from 'node:fs'
import path from 'node:path'
import { config, resolvePath } from './config.js'
import { redact } from './redact.js'

export type Caution = {
  term: string
  rule: string
  firstSeenDate: string
  lastSeenDate: string
  occurrences: number
  examples: string[]
}

type CautionStore = {
  version: 1
  entries: Caution[]
}

export type NewCaution = {
  term: string
  rule: string
  context?: string
}

const TODAY = (): string => new Date().toISOString().slice(0, 10)
const MAX_EXAMPLES = 3

function statePath(): string {
  return resolvePath(config.cautionsStatePath)
}

export async function loadCautions(): Promise<Caution[]> {
  try {
    const raw = await fs.readFile(statePath(), 'utf8')
    const parsed = JSON.parse(raw) as CautionStore
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return []
    return parsed.entries
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    if (config.verbose) console.warn(redact(`cautions.json 読み込み失敗: ${(err as Error).message}`))
    return []
  }
}

function normalizeTerm(t: string): string {
  return t.trim().toLowerCase()
}

export async function persistCautions(newOnes: NewCaution[]): Promise<Caution[]> {
  const today = TODAY()
  const existing = await loadCautions()
  const byTerm = new Map<string, Caution>()
  for (const e of existing) byTerm.set(normalizeTerm(e.term), e)

  for (const n of newOnes) {
    const term = n.term?.trim()
    if (!term) continue
    const key = normalizeTerm(term)
    const exist = byTerm.get(key)
    if (exist) {
      exist.lastSeenDate = today
      exist.occurrences += 1
      if (n.context && !exist.examples.includes(n.context)) {
        exist.examples.push(n.context)
        if (exist.examples.length > MAX_EXAMPLES) exist.examples.shift()
      }
      if (n.rule && n.rule !== exist.rule) {
        exist.rule = n.rule
      }
    } else {
      byTerm.set(key, {
        term,
        rule: n.rule?.trim() || '原文ママで表記',
        firstSeenDate: today,
        lastSeenDate: today,
        occurrences: 1,
        examples: n.context ? [n.context] : [],
      })
    }
  }

  const store: CautionStore = { version: 1, entries: [...byTerm.values()] }
  const p = statePath()
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(store, null, 2) + '\n', 'utf8')
  return store.entries
}

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { NEWS_SOURCES } from './types.js'

type SourcesApi = {
  SOURCE_LABELS: Record<string, string>
  COMMUNITY_SOURCES: string[]
  sourceLabel: (source: string | undefined) => string
  isCommunitySource: (source: string) => boolean
}

// クライアント側の取得元ラベル定義（docs/assets/js/sources.js, UMD）を読み込む。
// リポジトリは "type": "module" のため require() できないので、
// 偽の module を与えた node:vm 上で実行して module.exports を取り出す。
const here = path.dirname(fileURLToPath(import.meta.url))
const sourcesPath = path.resolve(here, '../docs/assets/js/sources.js')
const moduleShim = { exports: {} as SourcesApi }
vm.runInNewContext(readFileSync(sourcesPath, 'utf8'), { module: moduleShim })
const DCN_SOURCES = moduleShim.exports

describe('sources.js の取得元ラベル定義', () => {
  // これが contract test: types.ts に source を足してラベルを足し忘れると失敗する。
  it('NEWS_SOURCES のすべてに表示ラベルがあり、フォールバックせず解決できる', () => {
    for (const source of NEWS_SOURCES) {
      expect(() => DCN_SOURCES.sourceLabel(source)).not.toThrow()
      const label = DCN_SOURCES.sourceLabel(source)
      expect(label).toBeTruthy()
      // 「SOURCE」等のプレースホルダーへフォールバックしていないこと。
      expect(label).not.toBe('SOURCE')
    }
  })

  it('ラベル定義に NEWS_SOURCES 外の余分な source が無い', () => {
    const known = new Set<string>(NEWS_SOURCES)
    for (const source of Object.keys(DCN_SOURCES.SOURCE_LABELS)) {
      expect(known.has(source)).toBe(true)
    }
  })

  it('未知の source はフォールバックせず throw する', () => {
    expect(() => DCN_SOURCES.sourceLabel('unknown-source')).toThrow()
    expect(() => DCN_SOURCES.sourceLabel('')).toThrow()
    // @ts-expect-error 実行時に undefined が来てもフォールバックしないことを確認
    expect(() => DCN_SOURCES.sourceLabel(undefined)).toThrow()
  })

  it('COMMUNITY_SOURCES はすべて NEWS_SOURCES に含まれる', () => {
    const known = new Set<string>(NEWS_SOURCES)
    for (const source of DCN_SOURCES.COMMUNITY_SOURCES) {
      expect(known.has(source)).toBe(true)
    }
  })
})

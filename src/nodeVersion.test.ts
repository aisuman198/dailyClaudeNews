import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Node のバージョン宣言は package.json / .node-version / CI ワークフローに分散している。
// 片方だけ更新して不整合になる事故を防ぐための回帰テスト。
// 実行ディレクトリに依存しないよう、リポジトリルートは import.meta.url から解決する。
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

const packageJsonPath = path.join(repoRoot, 'package.json')
const nodeVersionPath = path.join(repoRoot, '.node-version')
const ciWorkflowPath = path.join(repoRoot, '.github/workflows/ci.yml')

type PackageJson = {
  engines?: { node?: string }
  devDependencies?: Record<string, string>
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
const nodeVersionFile = readFileSync(nodeVersionPath, 'utf8').trim()
const ciWorkflow = readFileSync(ciWorkflowPath, 'utf8')

type SemVer = { major: number; minor: number; patch: number }

// semver パッケージは入れない。現行の宣言形式を扱える範囲の自前パースで十分。
// ただしパースに失敗したら黙って通さず、必ず明示的に失敗させる。
function parseVersion(raw: string, where: string): SemVer {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim())
  if (!m) {
    throw new Error(
      `${where} のバージョン "${raw}" を major.minor.patch として解釈できませんでした。` +
        'バージョン表記を見直すか、このテストのパーサを更新してください。',
    )
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

// engines.node の ">=X.Y.Z" から下限バージョンを取り出す。
function parseEnginesLowerBound(range: string): SemVer {
  const m = /^>=\s*(\d+\.\d+\.\d+)$/.exec(range.trim())
  if (!m) {
    throw new Error(
      `package.json の engines.node "${range}" を ">=X.Y.Z" として解釈できませんでした。` +
        '表記を変えた場合はこのテストのパーサも更新してください。',
    )
  }
  return parseVersion(m[1] as string, 'engines.node の下限')
}

// devDependencies の "^X.Y.Z" からメジャーバージョンを取り出す。
function parseCaretMajor(spec: string, where: string): number {
  const m = /^\^\s*(\d+)\.\d+\.\d+$/.exec(spec.trim())
  if (!m) {
    throw new Error(
      `${where} のバージョン指定 "${spec}" を "^X.Y.Z" として解釈できませんでした。` +
        '表記を変えた場合はこのテストのパーサも更新してください。',
    )
  }
  return Number(m[1])
}

function compare(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

function format(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

function enginesNode(): string {
  const range = packageJson.engines?.node
  if (!range) {
    throw new Error('package.json に engines.node が宣言されていません。')
  }
  return range
}

function typesNodeSpec(): string {
  const spec = packageJson.devDependencies?.['@types/node']
  if (!spec) {
    throw new Error('package.json の devDependencies に @types/node がありません。')
  }
  return spec
}

describe('Node バージョン宣言の整合性', () => {
  it('.node-version が engines.node の範囲を満たす', () => {
    const range = enginesNode()
    const lower = parseEnginesLowerBound(range)
    const pinned = parseVersion(nodeVersionFile, '.node-version')

    expect(
      compare(pinned, lower) >= 0,
      `.node-version (${format(pinned)}) が package.json の engines.node ("${range}") を満たしていません。` +
        'どちらか一方だけを更新していないか確認してください。',
    ).toBe(true)
  })

  it('@types/node のメジャーが engines.node の下限メジャーと一致する', () => {
    const range = enginesNode()
    const lower = parseEnginesLowerBound(range)
    const spec = typesNodeSpec()
    const typesMajor = parseCaretMajor(spec, 'devDependencies の @types/node')

    expect(
      typesMajor,
      `@types/node ("${spec}" → メジャー ${typesMajor}) と engines.node ("${range}" → メジャー ${lower.major}) の` +
        'メジャーバージョンが食い違っています。両方を同じメジャーに揃えてください。',
    ).toBe(lower.major)
  })

  it('.node-version のメジャーが engines.node の下限メジャーと一致する', () => {
    const range = enginesNode()
    const lower = parseEnginesLowerBound(range)
    const pinned = parseVersion(nodeVersionFile, '.node-version')

    expect(
      pinned.major,
      `.node-version ("${nodeVersionFile}" → メジャー ${pinned.major}) と engines.node ("${range}" → メジャー ${lower.major}) の` +
        'メジャーバージョンが食い違っています。両方を同じメジャーに揃えてください。',
    ).toBe(lower.major)
  })

  it('CI がバージョンを直書きせず .node-version を参照している', () => {
    expect(
      ciWorkflow.includes("node-version-file: '.node-version'"),
      `.github/workflows/ci.yml に "node-version-file: '.node-version'" がありません。` +
        'CI だけ古い Node のまま取り残される事故を防ぐため、バージョンはファイル参照で指定してください。',
    ).toBe(true)

    // node-version-file とは別に node-version: が書かれていると、そちらが優先されて
    // .node-version の更新が CI に反映されなくなる。
    const hardcoded = ciWorkflow.match(/^\s*node-version:\s*\S+/gm) ?? []
    expect(
      hardcoded,
      `.github/workflows/ci.yml に Node バージョンの直書き (${hardcoded.map((s) => s.trim()).join(' / ')}) があります。` +
        "node-version-file: '.node-version' に一本化してください。",
    ).toEqual([])
  })

  it('実行中の Node が engines.node を満たす', () => {
    const range = enginesNode()
    const lower = parseEnginesLowerBound(range)
    const running = parseVersion(process.version.replace(/^v/, ''), 'process.version')

    expect(
      compare(running, lower) >= 0,
      `実行中の Node (${process.version}) が package.json の engines.node ("${range}") を満たしていません。` +
        `.node-version (${nodeVersionFile}) と同じ Node で実行してください。`,
    ).toBe(true)
  })
})

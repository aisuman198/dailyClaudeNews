import { describe, expect, it } from 'vitest'
import { matchesAnyKeyword } from './keywordMatch.js'

describe('matchesAnyKeyword', () => {
  it('日本語の文字が直後に続いても一致する', () => {
    expect(matchesAnyKeyword('Codexで並列にタスクを回す', ['Codex'])).toBe(true)
    expect(matchesAnyKeyword('Claudeを業務に導入した話', ['Claude'])).toBe(true)
    expect(matchesAnyKeyword('OpenAIのCodex入門', ['Codex'])).toBe(true)
  })

  it('英数字が前後に続く場合は一致しない', () => {
    expect(matchesAnyKeyword('cloud computing', ['Claude'])).toBe(false)
    expect(matchesAnyKeyword('Codexify your workflow', ['Codex'])).toBe(false)
    expect(matchesAnyKeyword('MyCodex release', ['Codex'])).toBe(false)
  })

  it('記号区切りや大文字小文字の違いでも一致する', () => {
    expect(matchesAnyKeyword('Introducing GPT-5-Codex', ['Codex'])).toBe(true)
    expect(matchesAnyKeyword('https://openai.com/index/codex-cloud', ['Codex'])).toBe(true)
    expect(matchesAnyKeyword('CODEX CLI', ['codex'])).toBe(true)
  })
})

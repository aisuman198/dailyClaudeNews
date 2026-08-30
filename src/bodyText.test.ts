import { describe, expect, it } from 'vitest'
import { TRUNCATION_NOTE, fitBodiesToBudget, truncateBody } from './bodyText.js'

describe('truncateBody', () => {
  it('上限以内の本文はそのまま返す（注記も付けない）', () => {
    const text = 'これは短い本文です。'
    expect(truncateBody(text, 100)).toBe(text)
    expect(truncateBody(text, 100)).not.toContain(TRUNCATION_NOTE)
  })

  it('上限ちょうどの本文は切り詰めない', () => {
    const text = 'あ'.repeat(50)
    expect(truncateBody(text, 50)).toBe(text)
  })

  it('超過分は切り詰め、打ち切り注記を付ける', () => {
    const text = 'あ'.repeat(200)
    const out = truncateBody(text, 50)
    expect(out).toContain(TRUNCATION_NOTE)
    expect(out.replace(TRUNCATION_NOTE, '').trim().length).toBeLessThanOrEqual(50)
  })

  it('文の区切りまで戻して切る（文の途中でぶつ切りにしない）', () => {
    // 上限 50 の手前 20%（=40 文字目以降）に「。」がある場合はそこまで戻す
    const text = `${'あ'.repeat(44)}。${'い'.repeat(100)}`
    const out = truncateBody(text, 50)
    const body = out.replace(TRUNCATION_NOTE, '').trim()
    expect(body).toBe(`${'あ'.repeat(44)}。`)
    expect(body).not.toContain('い')
  })

  it('戻れる範囲に区切りが無ければ上限位置でそのまま切る', () => {
    // 区切りが先頭付近 (10 文字目) にしか無い → 20% の探索範囲外なので戻さない
    const text = `${'あ'.repeat(9)}。${'い'.repeat(200)}`
    const out = truncateBody(text, 50)
    const body = out.replace(TRUNCATION_NOTE, '').trim()
    expect(body.length).toBe(50)
  })

  it('上限 0 以下なら注記だけを返す', () => {
    expect(truncateBody('あ'.repeat(100), 0)).toBe(TRUNCATION_NOTE)
  })
})

describe('fitBodiesToBudget', () => {
  const item = (bodyText: string) => ({ bodyText })

  it('合計が予算以内なら何も削らない', () => {
    const items = [item('あ'.repeat(100)), item('い'.repeat(100))]
    const r = fitBodiesToBudget(items, 1_000)
    expect(r.shrunk).toBe(0)
    expect(r.items).toBe(items)
    expect(r.totalChars).toBe(200)
  })

  it('予算超過時は長い記事だけを削り、短い記事は丸ごと残す', () => {
    const short = item('あ'.repeat(50))
    const long = item('い'.repeat(5_000))
    const r = fitBodiesToBudget([short, long], 1_000)
    expect(r.shrunk).toBe(1)
    expect(r.items[0]!.bodyText).toBe(short.bodyText)
    expect(r.items[1]!.bodyText).toContain(TRUNCATION_NOTE)
    // 短い記事が使い切らなかった枠は長い記事へ回る
    expect(r.items[1]!.bodyText!.replace(TRUNCATION_NOTE, '').trim().length).toBeGreaterThan(900)
  })

  it('元の配列の順序を保つ', () => {
    const items = [item('あ'.repeat(5_000)), item('い'.repeat(10)), item('う'.repeat(5_000))]
    const r = fitBodiesToBudget(items, 1_000)
    expect(r.items).toHaveLength(3)
    expect(r.items[1]!.bodyText).toBe('い'.repeat(10))
    expect(r.items[0]!.bodyText).toContain('あ')
    expect(r.items[2]!.bodyText).toContain('う')
  })

  it('本文が無い記事があっても落ちない', () => {
    const r = fitBodiesToBudget([{ bodyText: undefined }, item('あ'.repeat(5_000))], 1_000)
    expect(r.items[0]!.bodyText).toBeUndefined()
    // 予算は本文部分に対するもの。切り詰めた記事には注記 (+ 区切りの空白) が付く
    expect(r.totalChars).toBeLessThanOrEqual(1_000 + TRUNCATION_NOTE.length + 1)
  })

  it('空配列は何もしない', () => {
    expect(fitBodiesToBudget([], 1_000)).toEqual({ items: [], shrunk: 0, totalChars: 0 })
  })
})

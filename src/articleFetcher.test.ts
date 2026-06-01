import { describe, expect, it } from 'vitest'
import { extractTextFromHtml } from './articleFetcher.js'

describe('extractTextFromHtml', () => {
  it('strips scripts, styles, and tags', () => {
    const html = `
      <html><head><script>alert(1)</script><style>.x{}</style></head>
      <body>
        <header>hidden header</header>
        <main><p>本文ここ。重要な事実。</p></main>
        <footer>hidden footer</footer>
      </body></html>
    `
    const text = extractTextFromHtml(html)
    expect(text).toContain('本文ここ')
    expect(text).toContain('重要な事実')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('hidden header')
    expect(text).not.toContain('hidden footer')
  })

  it('decodes common HTML entities', () => {
    const html = '<p>A &amp; B &lt; C &gt; D &nbsp;&#39;quote&#39;</p>'
    const text = extractTextFromHtml(html)
    expect(text).toContain("A & B < C > D")
    expect(text).toContain("'quote'")
  })

  it('caps body length to a sane upper bound', () => {
    const html = '<p>' + 'あ'.repeat(10_000) + '</p>'
    const text = extractTextFromHtml(html)
    expect(text.length).toBeLessThanOrEqual(3_500)
  })

  it('collapses whitespace', () => {
    const html = '<p>multi   spaces\n\nand newlines\t\there</p>'
    const text = extractTextFromHtml(html)
    expect(text).toBe('multi spaces and newlines here')
  })

  it('strips U+FFFD replacement characters and adjacent broken bytes', () => {
    const html = '<p>イタリア�業との連携</p>'
    const text = extractTextFromHtml(html)
    expect(text).not.toContain('�')
    expect(text).not.toContain('�')
  })

  it('strips runs of multiple U+FFFD', () => {
    const html = '<p>単一の���ータベース</p>'
    const text = extractTextFromHtml(html)
    expect(text).not.toContain('�')
  })
})

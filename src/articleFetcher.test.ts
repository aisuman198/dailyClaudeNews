import { describe, expect, it } from 'vitest'
import { extractOgImageFromHtml, extractTextFromHtml } from './articleFetcher.js'

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

describe('extractOgImageFromHtml', () => {
  const base = 'https://www.anthropic.com/news/series-h'

  it('extracts og:image content URL', () => {
    const html = '<meta property="og:image" content="https://cdn.anthropic.com/series-h.png">'
    expect(extractOgImageFromHtml(html, base)).toBe('https://cdn.anthropic.com/series-h.png')
  })

  it('handles reversed attribute order (content before property)', () => {
    const html = '<meta content="https://cdn.anthropic.com/x.jpg" property="og:image">'
    expect(extractOgImageFromHtml(html, base)).toBe('https://cdn.anthropic.com/x.jpg')
  })

  it('handles single quotes', () => {
    const html = "<meta property='og:image' content='https://cdn.anthropic.com/y.png'>"
    expect(extractOgImageFromHtml(html, base)).toBe('https://cdn.anthropic.com/y.png')
  })

  it('resolves relative URL against base', () => {
    const html = '<meta property="og:image" content="/static/cover.jpg">'
    expect(extractOgImageFromHtml(html, base)).toBe('https://www.anthropic.com/static/cover.jpg')
  })

  it('falls back to twitter:image when og:image absent', () => {
    const html = '<meta name="twitter:image" content="https://cdn.anthropic.com/tw.png">'
    expect(extractOgImageFromHtml(html, base)).toBe('https://cdn.anthropic.com/tw.png')
  })

  it('falls back to twitter:image:src too', () => {
    const html = '<meta name="twitter:image:src" content="https://cdn.anthropic.com/twsrc.png">'
    expect(extractOgImageFromHtml(html, base)).toBe('https://cdn.anthropic.com/twsrc.png')
  })

  it('prefers og:image over twitter:image when both present', () => {
    const html = '<meta property="og:image" content="https://og.x/a.png"><meta name="twitter:image" content="https://tw.x/b.png">'
    expect(extractOgImageFromHtml(html, base)).toBe('https://og.x/a.png')
  })

  it('returns null when neither tag is present', () => {
    expect(extractOgImageFromHtml('<html><body>no meta</body></html>', base)).toBeNull()
  })

  it('returns null when content is empty', () => {
    const html = '<meta property="og:image" content="">'
    expect(extractOgImageFromHtml(html, base)).toBeNull()
  })

  it('decodes &amp; entity in URL', () => {
    const html = '<meta property="og:image" content="https://cdn.x/a.png?foo=1&amp;bar=2">'
    expect(extractOgImageFromHtml(html, base)).toBe('https://cdn.x/a.png?foo=1&bar=2')
  })
})

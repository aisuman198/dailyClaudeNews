import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('fetchArticle (retry + logging)', () => {
  const URL = 'https://example.com/article'
  const validHtml = `<html><head>
    <meta property="og:image" content="https://cdn.example.com/cover.png">
  </head><body><p>${'本文'.repeat(60)}</p></body></html>`

  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    process.env.FETCH_RETRY_BASE_DELAY_MS = '0' // テスト時はリトライ間隔を 0 に
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.FETCH_RETRY_BASE_DELAY_MS
  })

  function mockOk(body: string): Response {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  function mock5xx(): Response {
    return new Response('Internal Server Error', { status: 503, headers: { 'content-type': 'text/html' } })
  }
  function mock404(): Response {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } })
  }

  it('returns text + ogImage on first-attempt success', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockOk(validHtml))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchArticle } = await import('./articleFetcher.js')
    const r = await fetchArticle(URL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.text).toContain('本文')
    expect(r.ogImage).toBe('https://cdn.example.com/cover.png')
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('retries on network error and succeeds on third attempt', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(mockOk(validHtml))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchArticle } = await import('./articleFetcher.js')
    const r = await fetchArticle(URL)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(r.text).toContain('本文')
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy.mock.calls[0]![0]).toMatch(/attempt 1\/3.*ECONNRESET.*リトライ/)
    expect(warnSpy.mock.calls[1]![0]).toMatch(/attempt 2\/3.*ETIMEDOUT.*リトライ/)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('retries on HTTP 5xx and succeeds eventually', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mock5xx())
      .mockResolvedValueOnce(mockOk(validHtml))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchArticle } = await import('./articleFetcher.js')
    const r = await fetchArticle(URL)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.text).toContain('本文')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]![0]).toMatch(/HTTP 503/)
  })

  it('gives up after MAX_RETRIES + 1 failed attempts (logs error)', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchArticle } = await import('./articleFetcher.js')
    const r = await fetchArticle(URL)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(r.text).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]![0]).toMatch(/attempt 3\/3.*リトライ上限/)
  })

  it('does NOT retry on HTTP 4xx (non-retryable)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mock404())
    vi.stubGlobal('fetch', fetchMock)
    const { fetchArticle } = await import('./articleFetcher.js')
    const r = await fetchArticle(URL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.text).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]![0]).toMatch(/HTTP 404.*リトライ不可/)
  })

  it('does NOT retry on non-html content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { fetchArticle } = await import('./articleFetcher.js')
    const r = await fetchArticle(URL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.text).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]![0]).toMatch(/non-html.*application\/json.*リトライ不可/)
  })

  it('does NOT retry when extracted text is too short but preserves og:image', async () => {
    const shortHtml = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/short.png">
    </head><body><p>短い</p></body></html>`
    const fetchMock = vi.fn().mockResolvedValueOnce(mockOk(shortHtml))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchArticle } = await import('./articleFetcher.js')
    const r = await fetchArticle(URL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.text).toBeNull()
    expect(r.ogImage).toBe('https://cdn.example.com/short.png')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]![0]).toMatch(/text too short/)
  })
})

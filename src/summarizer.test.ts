import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Caution } from './cautionStore.js'
import { buildPrompt, summarize } from './summarizer.js'
import type { NewsItem } from './types.js'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

// spawn の戻り値を模した擬似 child。ハンドラ登録後に stdout/stderr/exit を発火する。
function fakeChild(opts: { stdout?: string; stderr?: string; code?: number }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { end: () => void }
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: () => {} }
  child.kill = () => {}
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout))
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
    child.emit('exit', opts.code ?? 0)
  })
  return child
}

const it1: NewsItem = {
  source: 'anthropic-blog',
  title: 'Anthropic releases X',
  url: 'https://example.com/x',
  publishedAt: new Date('2026-06-01T00:00:00Z'),
  summary: 'desc',
}

const it2: NewsItem = {
  source: 'hacker-news',
  title: 'Old recurring',
  url: 'https://example.com/old',
  publishedAt: new Date('2026-05-25T00:00:00Z'),
  firstSeenDate: '2026-05-25',
  occurrences: 5,
}

describe('summarizer.buildPrompt', () => {
  it('includes the dedup-final-judgment instruction', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('# 重複の最終判断')
    expect(p).toContain('関連リンク')
  })

  it('forbids inference and speculative phrasing', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('# 出典の取得')
    expect(p).toContain('bodyText')
    expect(p).toContain('とみられる')
  })

  it('forbids escape phrases like "詳細は原文参照"', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('詳細は原文参照')
    expect(p).toContain('逃げ文句')
    expect(p).toContain('禁止')
  })

  it('imposes no upper bound on summary length and uses pre-fetched bodyText', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).not.toContain('約3行')
    expect(p).toContain('上限はありません')
    expect(p).toContain('bodyText')
    expect(p).toContain('本文取得失敗')
  })

  it('puts Japanese translation in the title link and original as a subtitle for English titles', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('# 英語記事の表記')
    expect(p).toContain('日本語で読めることを最優先')
    expect(p).toContain('原題')
    expect(p).toContain('<sub>**原題**:')
    expect(p).not.toContain('- 訳:')
  })

  it('asks for category-based chapters', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('## カテゴリ別まとめ')
    expect(p).toContain('### カテゴリ名')
    expect(p).toContain('プロダクト・モデルリリース')
  })

  it('requests card-style output (title link, sub meta, paragraph summary)', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('カード形式')
    expect(p).toContain('[タイトル](URL)')
    expect(p).toContain('<sub>')
    expect(p).toContain('段落として')
    expect(p).toContain('箇条書きにしない')
  })

  it('embeds fresh and recurring input section counts', () => {
    const p = buildPrompt([it1, it1], [it2])
    expect(p).toContain('新規話題（2件）')
    expect(p).toContain('継続話題（1件）')
  })

  it('serializes items as JSON sections', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain('"title": "Anthropic releases X"')
    expect(p).toContain('"firstSeenDate": "2026-05-25"')
    expect(p).toContain('"occurrences": 5')
  })

  it('does not request an editor note section', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).not.toContain('## 編集後記')
    expect(p).toContain('主観的セクションは作らない')
  })

  it('includes known caution rules when provided', () => {
    const caution: Caution = {
      term: 'OpenRouter',
      rule: '原文ママで表記',
      firstSeenDate: '2026-06-01',
      lastSeenDate: '2026-06-01',
      occurrences: 1,
      examples: [],
    }
    const p = buildPrompt([it1], [it2], [caution])
    expect(p).toContain('# 既知の用語表記ルール')
    expect(p).toContain('OpenRouter')
    expect(p).toContain('原文ママで表記')
  })

  it('omits the known cautions section when list is empty', () => {
    const p = buildPrompt([it1], [it2], [])
    expect(p).not.toContain('# 既知の用語表記ルール')
  })
})

describe('summarizer.runClaude エラーの可視化', () => {
  beforeEach(() => spawnMock.mockReset())

  it('claude が stdout に出すエラー本文 (例: 401) を例外メッセージに含める', async () => {
    // claude CLI は -p モードで認証エラー等を stdout に書き、stderr は空。
    // 旧実装は stderr だけ拾い "終了コード 1: " と原因不明になっていた。
    spawnMock.mockImplementation(() =>
      fakeChild({
        stdout: 'Failed to authenticate. API Error: 401 Invalid authentication credentials\n',
        stderr: '',
        code: 1,
      }),
    )
    await expect(summarize([it1], [it2])).rejects.toThrow(/401 Invalid authentication credentials/)
  })

  it('終了コードも例外メッセージに含める', async () => {
    spawnMock.mockImplementation(() => fakeChild({ stdout: 'boom', code: 1 }))
    await expect(summarize([it1], [it2])).rejects.toThrow(/終了コード 1/)
  })
})

describe('summarizer.summarize 出力の骨格チェック', () => {
  beforeEach(() => spawnMock.mockReset())

  const wellFormed = '## 本日のハイライト\n\n- foo\n\n## カテゴリ別まとめ\n\n### A\n\n#### [x](https://e.com)\n'
  // 2026-08-28 に実際に起きた形: 先頭が落ち、記事本文の箇条書きから始まっている
  const truncated = '- SendFeedback ツール（v2.1.247）: セッション中の問題を Claude が下書きし\n\n---\n\n#### [x](https://e.com)\n'

  it('骨格の揃った出力はそのまま採用し、呼び直さない', async () => {
    spawnMock.mockImplementation(() => fakeChild({ stdout: wellFormed }))
    const result = await summarize([it1], [it2])
    expect(result.markdown).toContain('## 本日のハイライト')
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('必須見出しが欠落した出力は破棄して claude を呼び直す', async () => {
    spawnMock
      .mockImplementationOnce(() => fakeChild({ stdout: truncated }))
      .mockImplementationOnce(() => fakeChild({ stdout: wellFormed }))
    const result = await summarize([it1], [it2])
    expect(result.markdown).toBe(wellFormed.trim())
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('再試行しても骨格が揃わなければ例外にする（壊れたまま公開しない）', async () => {
    spawnMock.mockImplementation(() => fakeChild({ stdout: truncated }))
    await expect(summarize([it1], [it2])).rejects.toThrow(/必須見出しが欠落/)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('空文字が返ったときも呼び直す', async () => {
    spawnMock
      .mockImplementationOnce(() => fakeChild({ stdout: '' }))
      .mockImplementationOnce(() => fakeChild({ stdout: wellFormed }))
    const result = await summarize([it1], [it2])
    expect(result.markdown).toBe(wellFormed.trim())
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('認証エラーなど終了コード非0はリトライせず即座に失敗する', async () => {
    spawnMock.mockImplementation(() =>
      fakeChild({ stdout: 'Failed to authenticate. API Error: 401', code: 1 }),
    )
    await expect(summarize([it1], [it2])).rejects.toThrow(/終了コード 1/)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
})

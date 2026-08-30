import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TRUNCATION_NOTE } from './bodyText.js'
import type { Caution } from './cautionStore.js'
import { buildPrompt, summarize } from './summarizer.js'
import type { NewsItem } from './types.js'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))
// 骨格チェックに落ちた出力のダンプがテスト実行で state/ に実ファイルを作らないようにする
vi.mock('node:fs', () => ({ writeFileSync: vi.fn() }))

// spawn の戻り値を模した擬似 child。ハンドラ登録後に stdout/stderr/exit を発火する。
function fakeChild(opts: { stdout?: string; stdoutChunks?: string[]; stderr?: string; code?: number }) {
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
    for (const c of opts.stdoutChunks ?? []) child.stdout.emit('data', Buffer.from(c))
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
    child.emit('exit', opts.code ?? 0)
  })
  return child
}


// claude CLI の stream-json 出力を模す。text ブロックは assistant イベントとして
// 1 つずつ流れ、間に thinking ブロックが割り込むことがある。
function streamJson(
  blocks: Array<{ type: 'text' | 'thinking'; text: string }>,
  result: Record<string, unknown> = {},
): string {
  const lines = blocks.map((b) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [b.type === 'text' ? { type: 'text', text: b.text } : { type: 'thinking', thinking: b.text }],
      },
    }),
  )
  lines.push(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 1,
      usage: { output_tokens_details: { thinking_tokens: 0 } },
      ...result,
    }),
  )
  return `${lines.join('\n')}\n`
}

/** text ブロック 1 つだけの正常応答 */
function singleText(markdown: string): string {
  return streamJson([{ type: 'text', text: markdown }])
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

  it('打ち切り注記がある記事だけ「以降は未取得」と書かせ、他では書かせない', () => {
    const p = buildPrompt([it1], [it2])
    expect(p).toContain(TRUNCATION_NOTE)
    expect(p).toContain('（本文が長いため、以降は未取得）')
    expect(p).toContain('この注記が無い記事の要約に「本文が途中で切れている」旨を書いてはいけません')
  })
})

describe('summarizer.summarize 本文の合計予算', () => {
  beforeEach(() => spawnMock.mockReset())

  const withBody = (base: NewsItem, bodyText: string): NewsItem => ({ ...base, bodyText })
  const ok = '## 本日のハイライト\n- a\n\n## カテゴリ別まとめ\n### その他（1件）\n'

  /** stdin に流れたプロンプトを捕まえる擬似 child */
  function capturingChild(sink: { prompt: string }) {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { end: (p?: string) => void }
      kill: () => void
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end: (prompt?: string) => { sink.prompt = prompt ?? '' } }
    child.kill = () => {}
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(singleText(ok)))
      child.emit('exit', 0)
    })
    return child
  }

  // プロンプトには注記の扱いを説明する指示文が 1 回含まれる。本文が切り詰められた
  // ときだけ入力データ側にも現れるので、出現回数で判定する。
  const noteCount = (prompt: string) => prompt.split(TRUNCATION_NOTE).length - 1

  it('予算に収まる本文はそのままプロンプトへ載せる', async () => {
    const sink = { prompt: '' }
    spawnMock.mockImplementation(() => capturingChild(sink))
    const body = 'あ'.repeat(2_000)
    await summarize([withBody(it1, body)], [])
    expect(sink.prompt).toContain(body)
    expect(noteCount(sink.prompt)).toBe(1)
  })

  it('合計が予算を超える場合は超過分だけ切り詰めてから渡す', async () => {
    const sink = { prompt: '' }
    spawnMock.mockImplementation(() => capturingChild(sink))
    // 既定予算 150,000 文字を超える本文を 2 件渡す
    const huge = 'あ'.repeat(100_000)
    await summarize([withBody(it1, huge)], [withBody(it2, huge)])
    expect(noteCount(sink.prompt)).toBeGreaterThan(1)
    expect(sink.prompt).not.toContain(huge)
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
    spawnMock.mockImplementation(() => fakeChild({ stdout: singleText(wellFormed) }))
    const result = await summarize([it1], [it2])
    expect(result.markdown).toContain('## 本日のハイライト')
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('必須見出しが欠落した出力は破棄して claude を呼び直す', async () => {
    spawnMock
      .mockImplementationOnce(() => fakeChild({ stdout: singleText(truncated) }))
      .mockImplementationOnce(() => fakeChild({ stdout: singleText(wellFormed) }))
    const result = await summarize([it1], [it2])
    expect(result.markdown).toBe(wellFormed.trim())
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('再試行しても骨格が揃わなければ例外にする（壊れたまま公開しない）', async () => {
    spawnMock.mockImplementation(() => fakeChild({ stdout: singleText(truncated) }))
    await expect(summarize([it1], [it2])).rejects.toThrow(/必須見出しが欠落/)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('空文字が返ったときも呼び直す', async () => {
    spawnMock
      .mockImplementationOnce(() => fakeChild({ stdout: '' }))
      .mockImplementationOnce(() => fakeChild({ stdout: singleText(wellFormed) }))
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

describe('summarizer.runClaude stream-json の取りこぼし防止', () => {
  beforeEach(() => spawnMock.mockReset())

  it('分割された text ブロックを出現順にすべて連結する', async () => {
    // 2026-08-28 の事故: 出力の途中に thinking が挟まって text ブロックが分割され、
    // result (= 最後の text ブロック) だけを読んでいたため前半が丸ごと消えていた。
    spawnMock.mockImplementation(() =>
      fakeChild({
        stdout: streamJson([
          { type: 'text', text: '## 本日のハイライト\n\n- foo\n\n## カテゴリ別まとめ\n\n### A\n\n' },
          { type: 'thinking', text: '残りの記事をどう並べるか検討する' },
          { type: 'text', text: '#### [前半の記事](https://e.com/1)\n\n本文1\n\n---\n\n' },
          { type: 'thinking', text: 'さらに検討する' },
          { type: 'text', text: '#### [後半の記事](https://e.com/2)\n\n本文2\n\n---\n' },
        ]),
      }),
    )
    const result = await summarize([it1], [it2])
    expect(result.markdown).toContain('## 本日のハイライト')
    expect(result.markdown).toContain('前半の記事')
    expect(result.markdown).toContain('後半の記事')
    // thinking の中身は本文に混ざらない
    expect(result.markdown).not.toContain('検討する')
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('チャンクが行の途中で切れても JSON を取りこぼさない', async () => {
    const full = streamJson([
      { type: 'text', text: '## 本日のハイライト\n\n- foo\n\n## カテゴリ別まとめ\n\n### A\n' },
    ])
    const cut = Math.floor(full.length / 2)
    spawnMock.mockImplementation(() => fakeChild({ stdoutChunks: [full.slice(0, cut), full.slice(cut)] }))
    const result = await summarize([it1], [it2])
    expect(result.markdown).toContain('## カテゴリ別まとめ')
  })

  it('result イベントが is_error のときは例外にする', async () => {
    spawnMock.mockImplementation(() =>
      fakeChild({
        stdout: streamJson([{ type: 'text', text: '## 本日のハイライト\n\n## カテゴリ別まとめ\n' }], {
          is_error: true,
          subtype: 'error_during_execution',
        }),
      }),
    )
    await expect(summarize([it1], [it2])).rejects.toThrow(/error_during_execution/)
  })
})

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Caution } from './cautionStore.js'
import { config } from './config.js'
import { missingHeadings } from './markdownShape.js'
import { redact } from './redact.js'
import type { NewsItem, SummarizeResult } from './types.js'

const SYSTEM_PROMPT = `あなたは AI 業界ニュースを日本語で読みやすくまとめるエディターです。

【出典の扱い】
- 入力 JSON の \`bodyText\` フィールドに記事本文が抽出されたテキストとして与えられます。要約は **bodyText に書かれた事実のみ** に基づいて作成してください。
- bodyText が存在しない、または「本文取得失敗」と注記されている記事は、要約冒頭に「（本文取得失敗）」と明示し、タイトルから読み取れる範囲だけで簡潔に述べてください。
- bodyText に書かれていない情報（具体的な金額・性能数値・人物名・戦略意図など）を補ったり推測してはいけません。
- 「とみられる」「示唆している」「期待される」「示している」「思われる」等の推測・解釈表現は禁止です。記事内に書かれた事実だけを淡々と述べてください。

【出力】
- 前置き・挨拶・自己注釈・作業説明は一切含めず、いきなり「## 本日のハイライト」から始めてください。マークダウン本文のみを返してください。
- 要約の長さに上限はありません。bodyText に含まれる重要な事実（背景・経緯・数値・引用・影響範囲）は省略せず書いてください。逆に内容が薄い記事は無理に膨らませず短く構いません。`

function toJsonForPrompt(items: NewsItem[]): string {
  return JSON.stringify(
    items.map((i) => ({
      source: i.source,
      title: i.title,
      url: i.url,
      publishedAt: i.publishedAt.toISOString(),
      rssSummary: i.summary,
      score: i.score,
      mergedFrom: i.mergedFrom,
      firstSeenDate: i.firstSeenDate,
      occurrences: i.occurrences,
      bodyChanged: i.bodyChanged ?? false,
      bodyText: i.bodyText ?? '本文取得失敗',
    })),
    null,
    2,
  )
}

const CATEGORY_GUIDE = [
  '- プロダクト・モデルリリース（新モデル・新製品・新機能の発表）',
  '- 開発者ツール・SDK・インフラ（CLI、ライブラリ、推論エンジン、API 等）',
  '- 資金調達・買収・事業展開（投資ラウンド、M&A、拠点・人事）',
  '- 研究発表・論文（学術・技術論文・実証実験）',
  '- 安全性・倫理・規制・社会影響（policy、AI 安全、社会論調）',
  '- 開発者・利用者の声（個人ブログ、体験談、運用知見）',
  '- その他',
].join('\n')

function formatCautionRules(cautions: Caution[]): string {
  if (cautions.length === 0) return ''
  const lines = [
    `# 既知の用語表記ルール（必ず守ること）`,
    `過去のレビューで蓄積されたルールです。以下の用語は必ずルール通りに表記してください。`,
    ...cautions.map((c) => `- **${c.term}**: ${c.rule}`),
    ``,
  ]
  return lines.join('\n')
}

export function buildPrompt(
  fresh: NewsItem[],
  recurring: NewsItem[],
  knownCautions: Caution[] = [],
): string {
  return [
    `以下の AI 業界ニュース一覧を、カテゴリ別に章立てしてまとめてください。`,
    ``,
    formatCautionRules(knownCautions),
    `# 重複の最終判断（重要）`,
    `入力データは事前に機械的な重複排除を行っていますが、見出しや切り口が異なるだけで実質的に同じ話題のものが残っている可能性があります。同一の事実・発表・出来事を扱っていると判断したものは、最も情報量の多い1件にまとめ、他は「- 関連リンク: <URL>」として URL のみを併記してください。新規話題と継続話題の境界をまたぐ重複も同様に統合してください。`,
    ``,
    `# 継続話題の扱い（重要）`,
    `継続話題（occurrences ≥ 2）として渡された記事は、事前フィルタで「本文に変化があったもの」だけが残されています (\`bodyChanged: true\`)。これらは**追記・更新のあった点を中心に**まとめてください — 以前から伝えていた内容の繰り返しではなく、新しく追加された事実・数値・反応・続報を強調して書いてください。`,
    `本文がほとんど変わっていない継続話題は事前段階で除外済みなので、ここに渡された継続話題は必ず「何かしら新情報がある」前提で扱って構いません。\`bodyChanged\` が \`false\` の継続話題 (初回観測時に bodyHash が無く比較不能だった等) はメタ情報行に「継続話題」とだけ表示してください。`,
    ``,
    `# 出典の取得（重要）`,
    `各記事の本文は入力 JSON の \`bodyText\` フィールドに事前抽出済みです。要約は **bodyText に書かれた事実のみ** に基づき作成してください。bodyText に書かれていない事実を補ったり、解釈・推測表現（「とみられる」「示唆」「期待される」「示している」など）を使ってはいけません。`,
    `bodyText が \`"本文取得失敗"\` の記事は、要約冒頭に「（本文取得失敗）」と明示し、タイトルから読み取れる範囲だけで簡潔に述べてください。`,
    ``,
    `# 要約の書き方`,
    `- **要約の行数・文字数に上限はありません**。本文の重要な事実（背景・経緯・数値・引用・影響範囲・反応など）を漏らさず書いてください。`,
    `- 一方で、内容が薄い記事や本文取得失敗の記事は無理に膨らませないでください。`,
    `- 以下のような逃げ文句は禁止です: 「詳細は原文参照」「タイトルのみ」「詳しくは元記事を参照」「内容は推定」「詳細は不明」。URL は要約の上に既に表示されているため、リンク誘導は不要です。`,
    ``,
    `# 英語記事の表記（日本語読みやすさ優先）`,
    `**基本方針: 日本語で読めることを最優先する。** タイトルが英語（または日本語以外）の場合、見出し（リンク本体）には**日本語訳**を表示し、**原題**はメタ情報行の直後に「<sub>**原題**: <元タイトル></sub>」として併記してください。日本語タイトルの場合は見出しがそのまま日本語タイトルになるため、原題行は不要です。訳は原意に忠実に、内容を膨らませないでください。`,
    ``,
    `# カテゴリの選び方`,
    `以下のカテゴリから内容に合うものを選び、必要なら新しいカテゴリ名を追加してください。該当が無いカテゴリは見出しを作らないでください。`,
    CATEGORY_GUIDE,
    ``,
    `# 出力フォーマット（厳守）`,
    `- 冒頭に「## 本日のハイライト」見出しで、タイトルから読み取れる重要発表を3行で箇条書き（事実の列挙のみ。所感・解釈は含めない）`,
    `- 続けて「## カテゴリ別まとめ」見出しを置き、その下にカテゴリ単位で「### カテゴリ名（N件）」見出しを並べる`,
    `- 各ニュースは以下の「カード形式」で出力する（順番厳守、箇条書きにしない）:`,
    `  1. \`#### [タイトル](URL)\` の形式でタイトル自体をリンクにする。**英語記事の場合はリンク文字列を日本語訳に置き換える**（日本語読みやすさ優先）。日本語タイトルの記事はそのまま日本語タイトルを表示する。`,
    `  2. メタ情報行: \`<sub>ソース ・ Npt（スコアがあれば） ・ YYYY-MM-DD ・ 状態</sub>\`（中黒区切り。状態は新規話題なら省略、継続話題なら「継続話題（N回目）」と書く）`,
    `  3. （英語タイトルのみ）原題行: \`<sub>**原題**: <元の英語タイトル></sub>\``,
    `  4. （\`mergedFrom\` があれば）関連リンク行: \`<sub>関連: <URL1> ・ <URL2></sub>\``,
    `  5. 空行を1つ挟む`,
    `  6. 要約本文を **段落として** 書く（箇条書きにしない、行数・文字数の上限なし）。本文に複数の重要事実があれば段落を分けてよい`,
    `  7. 記事の末尾に区切り線 \`---\` を1行入れる（カテゴリ内で最後の記事の後にも入れる）`,
    `- カテゴリ内ではスコア降順 → 公開日降順 で並べる`,
    `- 編集後記・所感・コメンタリなど主観的セクションは作らないでください。`,
    ``,
    `# 出力例（この形を厳守）`,
    `\`\`\``,
    `#### [Claude Code におけるダイナミックワークフローの導入](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)`,
    `<sub>hacker-news ・ 189pt ・ 2026-05-28 ・ 継続話題（2回目）</sub>`,
    `<sub>**原題**: Dynamic Workflows in Claude Code</sub>`,
    ``,
    `Claude.com のブログにて、Claude Code にダイナミックワークフロー機能が導入されたことが発表された。`,
    ``,
    `---`,
    `\`\`\``,
    ``,
    `# 入力データ`,
    `## 新規話題（${fresh.length}件）`,
    toJsonForPrompt(fresh),
    ``,
    `## 継続話題（${recurring.length}件）`,
    toJsonForPrompt(recurring),
    ``,
  ].join('\n')
}

export type ClaudeRunResult = {
  /** assistant イベントの text ブロックを出現順に連結した本文 */
  text: string
  numTurns?: number
  thinkingTokens?: number
}

/**
 * claude CLI を stream-json で走らせ、text ブロックを **すべて** 連結して返す。
 *
 * --output-format text / json が返す `result` は「最後の text ブロック」だけで、
 * 出力の途中に thinking が挟まると text ブロックが分割されるため前半が丸ごと
 * 失われる。2026-08-28 はこれで 21 件中 18 件が消え、記事本文の途中から始まる
 * まとめが公開された (thinking_tokens 26,145 / num_turns 1 / stop_reason end_turn
 * = モデルは正常に完走していた)。stream-json なら分割された text を取りこぼさない。
 */
function runClaude(prompt: string): Promise<ClaudeRunResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      // stream-json は --verbose とセットで指定する
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence',
      // 本文は事前に Node 側で取得済み。Claude はツール不要
      '--tools', '',
      '--model', config.model,
      '--fallback-model', config.fallbackModel,
      '--append-system-prompt', SYSTEM_PROMPT,
    ]
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })

    const textParts: string[] = []
    let numTurns: number | undefined
    let thinkingTokens: number | undefined
    let resultError = ''
    // JSON 以外の行 (CLI の警告や認証エラー本文) は原因調査のために貯めておく
    let nonJsonOut = ''
    let stderr = ''
    let pending = ''
    let killedForTimeout = false
    // マルチバイト文字がチャンク境界で割れると JSON.parse が落ちるためデコーダを挟む
    const decoder = new StringDecoder('utf8')

    const timer = setTimeout(() => {
      killedForTimeout = true
      child.kill('SIGKILL')
    }, config.claudeTimeoutMs)

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (trimmed.length === 0) return
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        nonJsonOut += `${trimmed}\n`
        return
      }
      const message = ev.message as { content?: unknown } | undefined
      if (ev.type === 'assistant' && Array.isArray(message?.content)) {
        for (const block of message.content as Array<{ type?: string; text?: string }>) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text)
          }
        }
        return
      }
      if (ev.type === 'result') {
        numTurns = typeof ev.num_turns === 'number' ? ev.num_turns : undefined
        const usage = ev.usage as { output_tokens_details?: { thinking_tokens?: number } } | undefined
        thinkingTokens = usage?.output_tokens_details?.thinking_tokens
        if (ev.is_error === true) {
          resultError = String(ev.result ?? ev.subtype ?? 'unknown')
        }
      }
    }

    const consume = (text: string) => {
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    }

    child.stdout.on('data', (chunk: Buffer) => consume(decoder.write(chunk)))
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`claude プロセス起動失敗: ${err.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      consume(decoder.end())
      if (pending.length > 0) handleLine(pending)

      if (killedForTimeout) {
        reject(new Error(`claude タイムアウト (${config.claudeTimeoutMs}ms)`))
        return
      }
      if (code !== 0) {
        // claude CLI は -p モードでエラー本文 (例: "Failed to authenticate. API
        // Error: 401 ...") を stdout に出すことがある。stderr だけ見ると空になり
        // "終了コード 1: " と原因不明の issue になるため、両方を拾って原因を残す。
        const detail = [stderr.trim(), nonJsonOut.trim(), resultError]
          .filter(Boolean)
          .join(' / ')
          .slice(0, 500)
        reject(new Error(`claude 終了コード ${code}: ${detail}`))
        return
      }
      if (resultError) {
        reject(new Error(`claude がエラーを返しました: ${resultError.slice(0, 500)}`))
        return
      }
      resolve({ text: textParts.join(''), numTurns, thinkingTokens })
    })

    child.stdin.end(prompt)
  })
}

/** 骨格チェックに落ちた出力を原因調査用に残す (失敗しても本処理は続行する)。 */
function saveRejectedOutput(markdown: string, attempt: number): string | undefined {
  try {
    const dumpPath = path.join('state', `raw-summarize-${Date.now()}-${attempt}.md`)
    writeFileSync(dumpPath, markdown, 'utf8')
    return dumpPath
  } catch {
    return undefined
  }
}

export async function summarize(
  fresh: NewsItem[],
  recurring: NewsItem[],
  knownCautions: Caution[] = [],
): Promise<SummarizeResult> {
  if (fresh.length === 0 && recurring.length === 0) {
    throw new Error('summarize に渡されたニュースが0件です')
  }
  const prompt = buildPrompt(fresh, recurring, knownCautions)
  const maxAttempts = Math.max(1, config.summarizeMaxAttempts)
  let lastReason = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { text, numTurns, thinkingTokens } = await runClaude(prompt)
    const markdown = text.trim()
    if (markdown.length === 0) {
      lastReason = 'claude から空文字が返された'
    } else {
      const missing = missingHeadings(markdown)
      if (missing.length === 0) {
        return { markdown, modelUsed: config.model }
      }
      // text ブロックの取りこぼしは stream-json で解消したはずだが、モデルが
      // 指示どおりの骨格を出さないことはありうる。壊れたまま公開しない。
      lastReason = `必須見出しが欠落 (${missing.join(' / ')})`
    }
    const dumpPath = saveRejectedOutput(markdown, attempt)
    console.warn(
      redact(
        `[summarize] 出力が不完全 (${attempt}/${maxAttempts}): ${lastReason} ` +
          `(chars=${markdown.length} num_turns=${numTurns} thinking_tokens=${thinkingTokens})` +
          (dumpPath ? ` / 生出力: ${dumpPath}` : ''),
      ),
    )
  }

  throw new Error(`summarize の出力が ${maxAttempts} 回とも不完全でした: ${lastReason}`)
}

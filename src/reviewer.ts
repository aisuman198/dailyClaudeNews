import { spawn } from 'node:child_process'
import { config } from './config.js'
import type { Caution, NewCaution } from './cautionStore.js'

const REVIEWER_SYSTEM_PROMPT = `あなたは AI 業界ニュースまとめのレビュー編集者です。前段のエディターが書いた日本語まとめを精査し、誤り・不自然な日本語・誤訳・固有名詞の翻訳ミスを修正したマークダウンと、次回以降に共有すべき注意事項を出力します。

【絶対に守る構造保存ルール】
- **入力マークダウンに含まれるすべての見出し（##, ###, ####）を一字一句変えずに出力に保持してください**。
- **入力にある #### 記事カードは1件も削除・統合・並べ替えてはいけません**。記事の数は入力と完全に一致させてください。
- **「## 本日のハイライト」直下は箇条書き（"- " で始まる3行）です**。記事カードを入れてはいけません。
- **「## カテゴリ別まとめ」見出しを保持し、その配下のカテゴリ順・カテゴリ名・件数表記もそのまま保持してください**。
- 「- ソース:」「- URL:」「- 公開日:」「- 状態:」「- 訳:」「- 関連:」等のメタ行も保持してください（中身の文字列だけ修正可）。
- 修正範囲は **「日本語の言い回し・誤字脱字・誤訳・固有名詞の表記」のみ** です。事実の追加削除・記事の統合・要約段落の大幅書き換え・構造変更は禁止です。
- 出力は前置きや作業説明を含めず、いきなり修正後マークダウン本体を返してください。
- マークダウンの末尾に必ず "<!--CAUTIONS_BEGIN-->" と "<!--CAUTIONS_END-->" で挟まれた JSON を置いてください。`

export const CAUTIONS_BEGIN = '<!--CAUTIONS_BEGIN-->'
export const CAUTIONS_END = '<!--CAUTIONS_END-->'

export type ReviewResult = {
  correctedMarkdown: string
  newCautions: NewCaution[]
}

function formatKnownCautions(cautions: Caution[]): string {
  if (cautions.length === 0) return '（なし。これが初回のレビューです）'
  return cautions
    .map((c) => `- **${c.term}**: ${c.rule}`)
    .join('\n')
}

export function buildReviewPrompt(markdown: string, knownCautions: Caution[]): string {
  return [
    `以下のマークダウンを精査し、修正版と新規注意事項を返してください。`,
    ``,
    `# レビュー観点`,
    `0. **文字化け（U+FFFD = "�"、四角内の疑問符、3つ並びの "���" など）の検出と修正は最優先**。発見した箇所は、前後の文脈から元の文字を推定して置き換える（不明な場合は当該文字を削って自然な日本語にする）。出力に "�" を絶対に残さないこと。`,
    `1. **不自然な日本語、誤訳、誤字脱字、文章の流れの悪さ** を修正してください。`,
    `2. **英語タイトルの「- 訳:」行が原意を保ち適切か** を確認し、不適切なら修正してください。`,
    `3. **固有名詞（製品名・会社名・人名・サービス名）が日本語に翻訳されていないか** を確認してください。`,
    `   - NG 例: OpenRouter → 「オープンルーター」、Claude → 「クロード」、Anthropic → 「アンソロピック」、Hacker News → 「ハッカーニュース」、Cursor → 「カーソル」、GitHub → 「ギットハブ」など`,
    `   - 訳行（"- 訳:"）の中でも、英語の固有名詞は原文表記を保持してください`,
    `   - 一般語の組み合わせから成る記事タイトル全体の意訳は OK（例: "Less Coding, More Testing" → 「コーディングは減り、テストが増えた」）`,
    `4. **要約本文の事実は改変しない**こと。事実の追加削除、記事の入れ替え、カテゴリ構成の変更、ハイライトの形式変更（箇条書き→カードなど）はしない。修正範囲は「日本語表現・誤訳・固有名詞の表記」に限る。`,
    ``,
    `# 構造保存の確認（出力前に自己チェック）`,
    `- 入力にある "## 本日のハイライト" "## カテゴリ別まとめ" の見出しを保持しているか`,
    `- ハイライト直下は "- " で始まる箇条書き行のみで、記事カード (#### 〜) を入れていないか`,
    `- 入力の #### 記事カード数と出力の #### 記事カード数が完全一致しているか`,
    `- 各カテゴリ "### カテゴリ名（N件）" の名前と件数を保持しているか`,
    `- 「- ソース:」「- URL:」「- 公開日:」「- 状態:」「- 訳:」「- 関連:」のメタ行が抜けていないか`,
    `これらすべてが ✅ になるまで出力しないでください。`,
    ``,
    `# 既知の用語表記ルール（過去の実行で蓄積、必ず守る）`,
    formatKnownCautions(knownCautions),
    ``,
    `# 出力フォーマット（厳守）`,
    `1. 修正後のマークダウン本体を "## 本日のハイライト" から始めて出力する`,
    `2. マークダウンの末尾に必ず以下のブロックを置く（前後に空行を入れて構わない）:`,
    `\`\`\``,
    `${CAUTIONS_BEGIN}`,
    `{"cautions":[{"term":"OpenRouter","rule":"原文ママで表記","context":"「オープンルーター」と訳されていたため修正"}]}`,
    `${CAUTIONS_END}`,
    `\`\`\``,
    `3. cautions には **このレビューで新たに発見した固有名詞の誤訳・要注意事項のみ** を含める。既知リストに載っている項目は繰り返さない。発見が無ければ \`{"cautions":[]}\` とする。`,
    `4. context フィールドには発見箇所の短い説明（30文字程度）を入れる。`,
    ``,
    `# 入力マークダウン`,
    markdown,
    ``,
  ].join('\n')
}

function runReviewerClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'text',
      '--no-session-persistence',
      '--tools', '',
      '--model', config.reviewerModel,
      '--fallback-model', config.fallbackModel,
      '--append-system-prompt', REVIEWER_SYSTEM_PROMPT,
    ]
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    let killedForTimeout = false
    const timer = setTimeout(() => {
      killedForTimeout = true
      child.kill('SIGKILL')
    }, config.claudeTimeoutMs)

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`claude (reviewer) プロセス起動失敗: ${err.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (killedForTimeout) {
        reject(new Error(`claude (reviewer) タイムアウト (${config.claudeTimeoutMs}ms)`))
        return
      }
      if (code !== 0) {
        reject(new Error(`claude (reviewer) 終了コード ${code}: ${stderr.slice(0, 500)}`))
        return
      }
      resolve(stdout)
    })

    child.stdin.end(prompt)
  })
}

function stripPreamble(text: string): string {
  // 「## 本日のハイライト」の手前にあるメタ文・作業説明を削除する
  const idx = text.indexOf('## 本日のハイライト')
  if (idx === -1) return text.trim()
  return text.slice(idx).trim()
}

// 万一 reviewer の出力に U+FFFD が残った場合の最終クリーンアップ。
// 文字化けの前後 1 文字も削ることで「�」を確実に消す。
export function stripMojibakeFromMarkdown(s: string): string {
  if (!s.includes('�')) return s
  return s.replace(/.?�+.?/g, '')
}

export function parseReviewOutput(raw: string): ReviewResult {
  const beginIdx = raw.indexOf(CAUTIONS_BEGIN)
  const endIdx = raw.indexOf(CAUTIONS_END)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return { correctedMarkdown: stripMojibakeFromMarkdown(stripPreamble(raw)), newCautions: [] }
  }
  const correctedMarkdown = stripMojibakeFromMarkdown(stripPreamble(raw.slice(0, beginIdx)))
  const jsonText = raw.slice(beginIdx + CAUTIONS_BEGIN.length, endIdx).trim()
  try {
    const parsed = JSON.parse(jsonText) as { cautions?: NewCaution[] }
    const cautions = Array.isArray(parsed.cautions) ? parsed.cautions : []
    return {
      correctedMarkdown,
      newCautions: cautions
        .filter((c): c is NewCaution => !!c && typeof c.term === 'string' && c.term.trim().length > 0)
        .map((c) => ({
          term: c.term.trim(),
          rule: (c.rule ?? '').trim() || '原文ママで表記',
          context: c.context?.trim() || undefined,
        })),
    }
  } catch {
    return { correctedMarkdown, newCautions: [] }
  }
}

const REQUIRED_HEADINGS = ['## 本日のハイライト', '## カテゴリ別まとめ']

export function looksWellFormed(markdown: string): boolean {
  return REQUIRED_HEADINGS.every((h) => markdown.includes(h))
}

export async function review(markdown: string, knownCautions: Caution[]): Promise<ReviewResult> {
  if (!config.reviewEnabled) {
    return { correctedMarkdown: markdown, newCautions: [] }
  }
  const prompt = buildReviewPrompt(markdown, knownCautions)
  const raw = await runReviewerClaude(prompt)
  const parsed = parseReviewOutput(raw)

  // 必須見出しが欠落していれば draft をそのまま使う（新規発見の cautions は保持）
  if (!looksWellFormed(parsed.correctedMarkdown)) {
    console.warn(
      `[review] 出力が不完全（必須見出しが欠落）。draft をそのまま採用します。新規 cautions ${parsed.newCautions.length} 件は保持。`,
    )
    return { correctedMarkdown: markdown, newCautions: parsed.newCautions }
  }

  return parsed
}

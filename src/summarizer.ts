import { spawn } from 'node:child_process'
import { config } from './config.js'
import type { NewsItem, SummarizeResult } from './types.js'

const SYSTEM_PROMPT = `あなたは AI 業界ニュースを日本語で読みやすくまとめるエディターです。

【厳守】
- 入力（タイトル・URL・ソース・スコア・publishedAt）から読み取れる事実のみを書いてください。
- 記事本文は読めません。本文の内容を推測・想像・補完しないでください。「とみられる」「示唆している」「期待される」「示している」等の解釈・推測表現を使わないでください。
- タイトルに無い情報（具体的な機能・性能・金額・人物の役職・戦略意図等）を勝手に補わないでください。
- 不明・不確実な点は記事内では触れず、URL を提示するに留めてください。
- 出力は前置き・挨拶・自己注釈・作業説明を一切含めず、いきなり「## 本日のハイライト」から始めてください。マークダウン本文のみを返してください。`

function toJsonForPrompt(items: NewsItem[]): string {
  return JSON.stringify(
    items.map((i) => ({
      source: i.source,
      title: i.title,
      url: i.url,
      publishedAt: i.publishedAt.toISOString(),
      summary: i.summary,
      score: i.score,
      mergedFrom: i.mergedFrom,
      firstSeenDate: i.firstSeenDate,
      occurrences: i.occurrences,
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

export function buildPrompt(fresh: NewsItem[], recurring: NewsItem[]): string {
  return [
    `以下の AI 業界ニュース一覧を、カテゴリ別に章立てしてまとめてください。`,
    ``,
    `# 重複の最終判断（重要）`,
    `入力データは事前に機械的な重複排除を行っていますが、見出しや切り口が異なるだけで実質的に同じ話題のものが残っている可能性があります。同一の事実・発表・出来事を扱っていると判断したものは、最も情報量の多い1件にまとめ、他は「- 関連リンク: <URL>」として URL のみを併記してください。新規話題と継続話題の境界をまたぐ重複も同様に統合してください。`,
    ``,
    `# 推論の禁止（重要）`,
    `各記事の要約は、入力に含まれる事実（タイトル・URL・ソース・publishedAt・score）のみを根拠にしてください。記事本文は読めないため、本文に書かれていそうな内容を推測・補完してはいけません。「とみられる」「示唆」「期待される」「示している」等の解釈表現は禁止です。タイトルに無い具体情報（金額・性能数値・人物の役職・固有機能名・戦略意図など）を補わないでください。`,
    ``,
    `# 要約の書き方`,
    `- 1記事の要約は **約3行（80〜180 文字程度）** を目安にしてください。タイトルから読み取れる範囲を超えるなら無理に伸ばさず短くて構いません。`,
    `- 以下のような逃げ文句は禁止です: 「詳細は原文参照」「タイトルのみ」「詳しくは元記事を参照」「内容は推定」「詳細は不明」。URL は要約の上に既に表示されているため、リンク誘導は不要です。`,
    `- 中身が薄いタイトル（記号や略語だけ等）でも、ソース名・公開日・URL のパス情報を組み合わせて、「○○ が ○○ について △△年△△月に公開した記事」という体で短く事実を述べてください。`,
    ``,
    `# 日本語訳の付与（英語記事）`,
    `タイトルが英語（または日本語以外）の場合、見出し直下に「- 訳: <日本語タイトル訳>」を追加してください。訳は原意に忠実に、内容を膨らませないでください。日本語タイトルの場合は「- 訳:」行は不要です。`,
    ``,
    `# カテゴリの選び方`,
    `以下のカテゴリから内容に合うものを選び、必要なら新しいカテゴリ名を追加してください。該当が無いカテゴリは見出しを作らないでください。`,
    CATEGORY_GUIDE,
    ``,
    `# 出力フォーマット（厳守）`,
    `- 冒頭に「## 本日のハイライト」見出しで、タイトルから読み取れる重要発表を3行で箇条書き（事実の列挙のみ。所感・解釈は含めない）`,
    `- 続けて「## カテゴリ別まとめ」見出しを置き、その下にカテゴリ単位で「### カテゴリ名（N件）」見出しを並べる`,
    `- 各ニュースは以下の「カード形式」で出力する（順番厳守、箇条書きにしない）:`,
    `  1. \`#### [元タイトル](URL)\` の形式でタイトル自体をリンクにする`,
    `  2. メタ情報行: \`<sub>ソース ・ Npt（スコアがあれば） ・ YYYY-MM-DD ・ 状態</sub>\`（中黒区切り。状態は新規話題なら省略、継続話題なら「継続話題（N回目）」と書く）`,
    `  3. （英語タイトルのみ）訳行: \`<sub>**訳**: <日本語タイトル訳></sub>\``,
    `  4. （\`mergedFrom\` があれば）関連リンク行: \`<sub>関連: <URL1> ・ <URL2></sub>\``,
    `  5. 空行を1つ挟む`,
    `  6. 要約本文を **段落として** 1パラグラフで書く（箇条書きにしない、約3行・80〜180字目安）`,
    `  7. 記事の末尾に区切り線 \`---\` を1行入れる（カテゴリ内で最後の記事の後にも入れる）`,
    `- カテゴリ内ではスコア降順 → 公開日降順 で並べる`,
    `- 編集後記・所感・コメンタリなど主観的セクションは作らないでください。`,
    ``,
    `# 出力例（この形を厳守）`,
    `\`\`\``,
    `#### [Dynamic Workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)`,
    `<sub>hacker-news ・ 189pt ・ 2026-05-28 ・ 継続話題（2回目）</sub>`,
    `<sub>**訳**: Claude Code におけるダイナミックワークフローの導入</sub>`,
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

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'text',
      '--no-session-persistence',
      '--tools', '',
      '--model', config.model,
      '--fallback-model', config.fallbackModel,
      '--append-system-prompt', SYSTEM_PROMPT,
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
      reject(new Error(`claude プロセス起動失敗: ${err.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (killedForTimeout) {
        reject(new Error(`claude タイムアウト (${config.claudeTimeoutMs}ms)`))
        return
      }
      if (code !== 0) {
        reject(new Error(`claude 終了コード ${code}: ${stderr.slice(0, 500)}`))
        return
      }
      resolve(stdout)
    })

    child.stdin.end(prompt)
  })
}

export async function summarize(
  fresh: NewsItem[],
  recurring: NewsItem[],
): Promise<SummarizeResult> {
  if (fresh.length === 0 && recurring.length === 0) {
    throw new Error('summarize に渡されたニュースが0件です')
  }
  const prompt = buildPrompt(fresh, recurring)
  const markdown = (await runClaude(prompt)).trim()
  if (markdown.length === 0) {
    throw new Error('claude から空文字が返されました')
  }
  return { markdown, modelUsed: config.model }
}

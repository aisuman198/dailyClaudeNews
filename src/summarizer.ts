import { spawn } from 'node:child_process'
import { config } from './config.js'
import type { NewsItem, SummarizeResult } from './types.js'

const SYSTEM_PROMPT = `あなたは AI 業界ニュースを日本語で読みやすくまとめるエディターです。情報は正確に、推測は避け、不確実な点は明示してください。出力は前置き・挨拶・自己注釈・作業説明を一切含めず、いきなり「## 本日のハイライト」から始めてください。マークダウン本文のみを返してください。`

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

export function buildPrompt(fresh: NewsItem[], recurring: NewsItem[]): string {
  return [
    `以下の AI 業界ニュースを、日本語で読みやすくまとめてください。`,
    ``,
    `# 重複の最終判断（重要）`,
    `入力データは事前に機械的な重複排除を行っていますが、見出しや切り口が異なるだけで実質的に同じ話題のものが残っている可能性があります。同一の事実・発表・出来事を扱っていると判断したものは、最も情報量の多い1件にまとめ、他は「- 関連リンク: <URL>」として URL のみを併記してください。新規話題と継続話題の境界をまたぐ重複も同様に統合してください。`,
    ``,
    `# 出力フォーマット（厳守）`,
    `- 冒頭に「## 本日のハイライト」見出しで3行サマリ（箇条書き）`,
    `- 「## 新規話題（${fresh.length}件）」セクションで各ニュースを厚めに要約`,
    `  - 「### 元タイトル」「- ソース: ...」「- URL: ...」「- 要約: 2〜4行で日本語」の順`,
    `  - 入力に \`mergedFrom\` が含まれる場合は「- 関連リンク: <他ソースのURL>」を追加`,
    `- 「## 継続話題（${recurring.length}件）」セクションは1行ずつ短く触れる（前日までに言及済みのため）`,
    `- 末尾に「## 編集後記」見出しで1段落（任意の所感）`,
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

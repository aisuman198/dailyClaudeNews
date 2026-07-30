/**
 * Discord Webhook 通知。
 *
 * 用途は 2 つあり、**投稿先チャンネルは別々**（別 Webhook URL）:
 *   - 失敗時: DISCORD_ERROR_WEBHOOK_URL へ「エラーが出た旨 + GitHub issue のリンク」
 *   - 成功時: DISCORD_NEWS_WEBHOOK_URL  へ「公開した記事の URL」
 *
 * 設計方針:
 * - **通知の失敗でパイプラインを落とさない。** 送信結果は例外ではなく
 *   `DiscordResult` で返し、呼び出し側はログに残すだけにする。
 *   記事の公開自体は成功しているのに通知失敗で exit 1 → 誤検知の error issue、
 *   という事故を防ぐため。
 * - Webhook URL は秘密情報。ログにも例外メッセージにも出さない
 *   (`scrubWebhookUrl` で最終防衛)。
 * - パブリック出力 sink なので送信前に必ず `redact()` を通す
 *   (ルールは ~/.claude/CLAUDE.md 参照)。
 */
import { config } from './config.js'
import { redact } from './redact.js'
import type { Phase } from './types.js'

export type DiscordEmbedField = { name: string; value: string; inline?: boolean }

export type DiscordEmbed = {
  title?: string
  description?: string
  url?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: { text: string }
}

export type DiscordPayload = {
  content?: string
  embeds?: DiscordEmbed[]
}

export type DiscordResult = { ok: true } | { ok: false; reason: string }

export type DiscordDeps = { fetch: typeof fetch }

const defaultDeps: DiscordDeps = { fetch: globalThis.fetch.bind(globalThis) }

// Discord API の上限。超えると 400 で丸ごと失敗するので送信前に切り詰める。
const LIMIT_CONTENT = 2000
const LIMIT_TITLE = 256
const LIMIT_DESCRIPTION = 4096
const LIMIT_FIELD_VALUE = 1024

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const ellipsis = '…(以下省略)'
  return s.slice(0, Math.max(0, max - ellipsis.length)) + ellipsis
}

// Webhook URL 自体が秘匿情報。fetch の例外メッセージ等に混ざる可能性があるので、
// 外に出す文字列からは必ず除去する。
function scrubWebhookUrl(s: string, webhookUrl: string): string {
  if (!webhookUrl) return s
  return s.split(webhookUrl).join('[REDACTED:DISCORD_WEBHOOK]')
}

/**
 * パブリック出力 sink: redact 必須 (ルールは ~/.claude/CLAUDE.md 参照)。
 * Webhook URL 未設定なら送信せず skip として返す。
 */
export async function postToDiscord(
  webhookUrl: string,
  payload: DiscordPayload,
  deps: DiscordDeps = defaultDeps,
): Promise<DiscordResult> {
  if (!webhookUrl) return { ok: false, reason: 'Webhook URL が未設定' }

  const safe: DiscordPayload = {}
  if (payload.content !== undefined) {
    safe.content = truncate(redact(payload.content), LIMIT_CONTENT)
  }
  if (payload.embeds && payload.embeds.length > 0) {
    safe.embeds = payload.embeds.map((e) => {
      const embed: DiscordEmbed = {}
      if (e.title !== undefined) embed.title = truncate(redact(e.title), LIMIT_TITLE)
      if (e.description !== undefined) embed.description = truncate(redact(e.description), LIMIT_DESCRIPTION)
      if (e.url !== undefined) embed.url = redact(e.url)
      if (e.color !== undefined) embed.color = e.color
      if (e.footer !== undefined) embed.footer = { text: truncate(redact(e.footer.text), LIMIT_TITLE) }
      if (e.fields !== undefined) {
        embed.fields = e.fields.map((f) => ({
          name: truncate(redact(f.name), LIMIT_TITLE),
          value: truncate(redact(f.value), LIMIT_FIELD_VALUE),
          ...(f.inline === undefined ? {} : { inline: f.inline }),
        }))
      }
      return embed
    })
  }

  try {
    const res = await deps.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(safe),
      signal: AbortSignal.timeout(config.discordTimeoutMs),
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {
        // ボディが読めなくてもステータスだけで十分
      }
      return { ok: false, reason: scrubWebhookUrl(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`, webhookUrl) }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: scrubWebhookUrl((err as Error).message, webhookUrl) }
  }
}

const COLOR_ERROR = 0xd9_3f_0b // オレンジ寄りの赤 (issue ラベルの category:* と揃える)

export type FailureContext = {
  date: string
  phase: Phase
  category: string
  error: Error
  /** 起票 / 再発コメントした issue の URL。起票できなかった場合は null。 */
  issueUrl: string | null
}

export function buildFailurePayload(ctx: FailureContext): DiscordPayload {
  const fields: DiscordEmbedField[] = [
    { name: '失敗フェーズ', value: `\`${ctx.phase}\``, inline: true },
    { name: 'カテゴリ', value: `\`${ctx.category}\``, inline: true },
    { name: '発生日', value: ctx.date, inline: true },
    {
      name: 'GitHub Issue',
      value: ctx.issueUrl ?? '起票できませんでした（詳細は run.log を確認してください）',
    },
  ]
  return {
    // issue URL を content にも入れておくと、埋め込みを畳んだ状態でもリンクを踏める。
    content: ctx.issueUrl
      ? `⚠️ dailyClaudeNews の定期実行でエラーが発生しました\n${ctx.issueUrl}`
      : '⚠️ dailyClaudeNews の定期実行でエラーが発生しました（GitHub issue の起票にも失敗しました）',
    embeds: [
      {
        title: `${ctx.phase} フェーズで失敗 (${ctx.category})`,
        ...(ctx.issueUrl ? { url: ctx.issueUrl } : {}),
        color: COLOR_ERROR,
        description: '```\n' + truncate(ctx.error.message, 1500) + '\n```',
        fields,
        footer: { text: 'dailyClaudeNews notifier' },
      },
    ],
  }
}

export type SuccessContext = {
  date: string
  articleUrl: string
  freshCount: number
  recurringCount: number
  model: string
}

export function buildSuccessPayload(ctx: SuccessContext): DiscordPayload {
  // 埋め込みではなく content にリンクを置く。Discord 側が記事ページを
  // 自動でカード展開してくれるので、共有先チャンネルでは見た目が良い。
  return {
    content: [
      `📰 **${ctx.date} の AI ニュースまとめ**を公開しました`,
      `新規 ${ctx.freshCount} 件 / 継続 ${ctx.recurringCount} 件 (model: ${ctx.model})`,
      ctx.articleUrl,
    ].join('\n'),
  }
}

export async function notifyDiscordFailure(
  ctx: FailureContext,
  deps: DiscordDeps = defaultDeps,
): Promise<DiscordResult> {
  if (!config.discordNotification) return { ok: false, reason: 'DISCORD_NOTIFICATION=false' }
  return postToDiscord(config.discordErrorWebhookUrl, buildFailurePayload(ctx), deps)
}

export async function notifyDiscordSuccess(
  ctx: SuccessContext,
  deps: DiscordDeps = defaultDeps,
): Promise<DiscordResult> {
  if (!config.discordNotification) return { ok: false, reason: 'DISCORD_NOTIFICATION=false' }
  return postToDiscord(config.discordNewsWebhookUrl, buildSuccessPayload(ctx), deps)
}

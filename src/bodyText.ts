/**
 * 記事本文 (bodyText) の切り詰めロジック。
 *
 * 本文は Node 側で事前取得して summarize のプロンプトへ丸ごと載せるため、
 * 1記事あたりの上限と、1回のプロンプト全体の上限の両方が要る。
 *
 * 2026-08-30 のまとめでは 1記事 3,500 文字で機械的に切っていたため、Qiita の
 * 技術記事 (5,500〜7,100 文字) が 37〜51% 削られ、6 件中 5 件の要約が
 * 「本文は途中で切れており…については取得できていない」で終わっていた。
 */

/** 切り詰めた本文の末尾に付ける注記。要約側はこれを見て「続きが無い」と判断する。 */
export const TRUNCATION_NOTE = '（※本文が長いため、ここまでで取得を打ち切っています）'

/** 文の区切りとみなす文字。ここまで戻して切ると要約が文の途中を拾わずに済む。 */
const SENTENCE_BOUNDARY = /[。．！？!?\n]/

/** 区切りを探して戻る範囲 (上限に対する割合)。これ以上戻ると本文が痩せすぎる。 */
const BOUNDARY_SEARCH_RATIO = 0.2

/**
 * `text` を `limit` 文字以内に切り詰める。切った場合は {@link TRUNCATION_NOTE} を付ける。
 *
 * 文の途中でぶつ切りにすると要約側が「続きがある」と誤読して不自然な文を書くため、
 * 上限の手前 20% の範囲に文の区切りがあればそこまで戻して切る。
 */
export function truncateBody(text: string, limit: number): string {
  if (limit <= 0) return TRUNCATION_NOTE
  if (text.length <= limit) return text

  const head = text.slice(0, limit)
  const minKeep = Math.floor(limit * (1 - BOUNDARY_SEARCH_RATIO))
  let cut = -1
  for (let i = head.length - 1; i >= minKeep; i -= 1) {
    if (SENTENCE_BOUNDARY.test(head[i]!)) {
      cut = i + 1
      break
    }
  }
  const body = (cut > 0 ? head.slice(0, cut) : head).trimEnd()
  return `${body} ${TRUNCATION_NOTE}`
}

type HasBody = { bodyText?: string }

export type FitResult<T> = {
  items: T[]
  /** 予算超過のために切り詰めた記事数 */
  shrunk: number
  /** 切り詰め後の bodyText 合計文字数 */
  totalChars: number
}

/**
 * 記事本文の合計が `budget` 文字を超えないように、超過分だけを切り詰める。
 *
 * 1記事あたりの上限を上げると、記事数が多い日にプロンプトがモデルの
 * コンテキスト長を超えて summarize ごと落ちうる。短い記事は丸ごと残し、
 * 長い記事だけを均等枠まで削ることで、全体量を抑えつつ削る量を最小にする。
 */
export function fitBodiesToBudget<T extends HasBody>(items: T[], budget: number): FitResult<T> {
  const totalChars = items.reduce((n, it) => n + (it.bodyText?.length ?? 0), 0)
  if (items.length === 0 || budget <= 0 || totalChars <= budget) {
    return { items, shrunk: 0, totalChars }
  }

  // 短い記事から順に「均等割り当て」を配る。使い切らなかった枠は後続へ回るので、
  // 結果として長い記事だけが削られる。
  const limits = new Map<T, number>()
  let remaining = budget
  let seats = items.length
  const shortestFirst = [...items].sort((a, b) => (a.bodyText?.length ?? 0) - (b.bodyText?.length ?? 0))
  for (const it of shortestFirst) {
    const share = Math.floor(remaining / seats)
    const take = Math.min(it.bodyText?.length ?? 0, share)
    limits.set(it, take)
    remaining -= take
    seats -= 1
  }

  let shrunk = 0
  const next = items.map((it) => {
    const limit = limits.get(it) ?? 0
    if (!it.bodyText || it.bodyText.length <= limit) return it
    shrunk += 1
    return { ...it, bodyText: truncateBody(it.bodyText, limit) }
  })

  return {
    items: next,
    shrunk,
    totalChars: next.reduce((n, it) => n + (it.bodyText?.length ?? 0), 0),
  }
}

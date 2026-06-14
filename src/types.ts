// 取得元サービスの一覧（実行時にも参照できる単一の真実）。
// 新しいニュースソースを追加したら、ここに足したうえで
// docs/assets/js/sources.js の SOURCE_LABELS にも表示名を追加すること。
// 追加漏れは src/sources.test.ts（contract test）が検出する。
export const NEWS_SOURCES = ['anthropic-blog', 'hacker-news', 'zenn', 'qiita'] as const

export type NewsSource = (typeof NEWS_SOURCES)[number]

export type NewsItem = {
  source: NewsSource
  title: string
  url: string
  publishedAt: Date
  summary?: string
  score?: number
  mergedFrom?: string[]
  firstSeenDate?: string
  occurrences?: number
  bodyText?: string
  ogImage?: string
  // 継続話題のうち、前回観測時から bodyText が変化した（追記/更新があった）ことを示すフラグ。
  // summarizer はこれを参照して「更新あり」を強調できる。
  bodyChanged?: boolean
}

export type SeenEntry = {
  normalizedUrl: string
  normalizedTitle: string
  firstSeenDate: string
  lastSeenDate: string
  occurrences: number
  // 本文 (bodyText) の SHA-256 prefix。前日との内容差分検出に使う。
  // バージョン 1 で書かれた既存エントリは undefined のまま残る (後方互換)。
  bodyHash?: string
  // bodyText の文字数。ハッシュ衝突や微小ノイズの判定補助。
  bodyLength?: number
}

export type SeenStore = {
  version: 1
  entries: SeenEntry[]
}

export type SummarizeResult = {
  markdown: string
  modelUsed: string
}

export type Phase =
  | 'init'
  | 'fetch'
  | 'dedupe'
  | 'prioritize'
  | 'history-filter'
  | 'enrich-bodies'
  | 'summarize'
  | 'review'
  | 'pick-hero'
  | 'write'
  | 'persist-history'
  | 'persist-cautions'
  | 'git'
  | 'verify-deploy'

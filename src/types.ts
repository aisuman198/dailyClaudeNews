export type NewsSource = 'anthropic-blog' | 'hacker-news'

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
}

export type SeenEntry = {
  normalizedUrl: string
  normalizedTitle: string
  firstSeenDate: string
  lastSeenDate: string
  occurrences: number
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

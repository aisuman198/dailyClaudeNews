function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * キーワードを「英数字の単語境界」で一致させる正規表現を作る（大文字小文字無視）。
 *
 * 前後に英数字が続く場合だけを不一致とし、日本語の文字が直後に続くケースは一致させる。
 * 例: 「Codexで並列実行」「Claudeを使う」は一致、「cloud」「Codexify」は不一致。
 * `\p{L}` で境界を取ると、かな・漢字も「文字」扱いになり日本語タイトルの記事を取りこぼす。
 */
export function keywordRegex(keyword: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(keyword)}(?![A-Za-z0-9])`, 'i')
}

export function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((k) => keywordRegex(k).test(text))
}

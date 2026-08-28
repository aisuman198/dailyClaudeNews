/**
 * summarizer / reviewer が返したマークダウンの骨格チェック。
 *
 * claude CLI は出力が長くなりすぎたとき、最終メッセージだけを stdout に流して
 * 先頭を落とすことがある (2026-08-28 の実例: 新規 21 件で「## 本日のハイライト」
 * 以下が丸ごと消え、記事カード 3 件だけが残った)。必須見出しの有無で
 * 「途中から始まってしまった出力」を検知する。
 */
const REQUIRED_HEADINGS = ['## 本日のハイライト', '## カテゴリ別まとめ']

export function looksWellFormed(markdown: string): boolean {
  return REQUIRED_HEADINGS.every((h) => markdown.includes(h))
}

/** looksWellFormed が false のときにログ・エラーへ載せる理由文。 */
export function missingHeadings(markdown: string): string[] {
  return REQUIRED_HEADINGS.filter((h) => !markdown.includes(h))
}

// 取得元サービス（source スラッグ）→ 画面表示用ラベルの単一定義。
// ブラウザでは window.DCN_SOURCES、Node（テスト）では module.exports として読める UMD。
//
// 新しいニュースソースを追加するときは:
//   1. src/types.ts の NEWS_SOURCES に slug を追加
//   2. この SOURCE_LABELS に表示名を追加（必要なら COMMUNITY_SOURCES にも）
// 追加漏れがあると src/sources.test.ts が CI（検証段階）で失敗する。
// 未知の source は sourceLabel() が throw する（「SOURCE」等へはフォールバックしない）。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DCN_SOURCES = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCE_LABELS = {
    'hacker-news': 'HACKER NEWS',
    'anthropic-blog': 'ANTHROPIC',
    'zenn': 'ZENN',
    'qiita': 'QIITA',
  };

  // コミュニティ発（個人・掲示板）の source。公式発表と区別して COMMUNITY タグを付ける。
  const COMMUNITY_SOURCES = ['hacker-news', 'zenn', 'qiita'];
  const communitySet = new Set(COMMUNITY_SOURCES);

  // 表示名を返す。未知の source はフォールバックせず throw（検証段階で気付くため）。
  function sourceLabel(source) {
    const label = SOURCE_LABELS[source];
    if (!label) {
      throw new Error(
        '未知のニュースソースです: ' + JSON.stringify(source) +
        '（docs/assets/js/sources.js の SOURCE_LABELS と src/types.ts の NEWS_SOURCES に追加してください）',
      );
    }
    return label;
  }

  function isCommunitySource(source) {
    return communitySet.has(source);
  }

  return { SOURCE_LABELS, COMMUNITY_SOURCES, sourceLabel, isCommunitySource };
});

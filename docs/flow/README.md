# flow/ — フロー情報（開発時・修正時の一時情報）

特定の作業・日付・調査に紐づく **一時的な情報** を置くディレクトリ。
調査メモ・バグ分析・検討中の修正案・タスク引き継ぎなど、時間が経てば
古くなる/役目を終える性質の情報をここで管理する。

システムの恒久的な定義（マスタ情報）は [../domain/](../domain/) を参照。

## 収録ドキュメント

| ファイル | 内容 |
|---------|------|
| [claude-cli-headless-spec.md](./claude-cli-headless-spec.md) | Claude CLI ヘッドレスモードの仕様調査結果（T003、2026-06-01） |
| [architecture-task-handoff.md](./architecture-task-handoff.md) | アーキテクチャ設計から後続実装タスクへの引き継ぎ（T006以降） |
| [hero-matching-design-issue.md](./hero-matching-design-issue.md) | ヒーローマッチングバグの分析・修正案・未決事項（2026-06-14） |
| [future-enhancements.md](./future-enhancements.md) | 将来の拡張余地（T005 設計時点の構想・一部実現済み） |

# fixtures/claude-scripts/

このディレクトリの `redact.cjs` は `~/.claude/scripts/redact.cjs`（正本）の
CI 用ミラーです。GitHub Actions のランナーにはユーザーのホームディレクトリ配下の
共有スクリプトが存在しないため、`src/redact.test.ts` の sink contract test /
smoke test を CI 上でも実行できるように、正本のコピーをリポジトリに同梱しています。

## 重要: このファイルを直接編集しないこと

`fixtures/claude-scripts/redact.cjs` は正本のバイト単位の複製です。
このファイルを直接編集しても、正本 `~/.claude/scripts/redact.cjs` には反映されず、
逆に正本を更新したときにこのフィクスチャが古いまま放置されるとドリフト（内容の乖離）
が発生します。

パターンの追加・修正は必ず正本 `~/.claude/scripts/redact.cjs` に対して行ってください。

## 正本を編集したら同期する

正本を更新した後は、以下のコマンドでフィクスチャを同期してください。

```sh
npm run sync:redact-fixture
```

## ドリフト検知

`src/redact.test.ts` にローカル実行時のみ動作するドリフト検知テストがあり、
正本とこのフィクスチャの内容が完全一致することを検証します。正本を更新した後に
`npm run sync:redact-fixture` を忘れると、このテストが失敗して知らせてくれます。
（CI 環境には正本が存在しないため、このテストは CI では自動的に skip されます。）

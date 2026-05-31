# T003: Claude Code CLI ヘッドレスモード仕様調査結果

**調査日**: 2026-06-01
**対象バージョン**: Claude Code 2.1.152

## 確認済みの動作

- `echo "..." | claude -p --output-format text --no-session-persistence` で Max 認証セッションを使った非対話実行が可能。
- 出力は標準出力にプレーンテキスト（モデルの最終応答のみ）。
- API キー無しで Max 契約済みアカウントの認証情報（keychain / `~/.claude/`）が自動利用される。

## 本プロジェクトで使用するフラグ

| フラグ | 用途 | 採用理由 |
|--------|------|----------|
| `-p`, `--print` | 非対話実行（必須） | launchd から起動するため対話セッションは不要 |
| `--output-format text` | プレーンテキスト出力 | マークダウン本文をそのまま受け取る |
| `--input-format text` | stdin をプレーンテキストとして扱う（デフォルト） | ニュース本文を stdin で渡すため |
| `--no-session-persistence` | セッション保存を無効化 | 毎日の自動実行で履歴を溜めない |
| `--model <name>` | モデル指定 | 要約タスクには `claude-sonnet-4-6` が妥当（コスト/品質バランス） |
| `--fallback-model <name>` | フォールバック先 | 主モデル過負荷時に `claude-haiku-4-5-20251001` などへ自動切替 |
| `--append-system-prompt <prompt>` | 役割指定の追加 | 「日本語で要約するエディター」役を注入 |
| `--tools ""` | 全ツールを無効化 | 要約のみで Bash/Edit 等は不要。安全性向上 |
| `--max-budget-usd <n>` | 想定外コスト防止 | Max なら無効だが、将来 API キー併用時の保険として検討 |
| `--json-schema <schema>` | 構造化出力 | 将来「タイトル/要約/URL」を JSON で受けたい場合に使用（v1 では使わない） |

## 採用しないフラグ

| フラグ | 不採用理由 |
|--------|------------|
| `--dangerously-skip-permissions` | 自動実行で危険。`--tools ""` で十分 |
| `--debug` | 本番運用ではログが冗長 |
| `--continue` / `--resume` | 毎日独立実行のため不要 |
| `--worktree` / `--tmux` | サンドボックス不要 |

## 標準的な呼び出しパターン（実装時の参考）

```bash
cat news_input.txt | claude -p \
  --output-format text \
  --no-session-persistence \
  --tools "" \
  --model claude-sonnet-4-6 \
  --fallback-model claude-haiku-4-5-20251001 \
  --append-system-prompt "あなたは日本語で AI 業界ニュースを要約するエディターです。"
```

## 留意点

- **使用量制限**: Max は 5 時間ローリングウィンドウ。1 日 1 回・短文要約なら問題ないが、上限到達時は非ゼロ終了コードで失敗する → notifier で検出。
- **認証の前提**: `claude` が `aisuman198` の Max アカウントで認証済みであること。launchd で別ユーザーコンテキストになる場合、`~/.claude/` が読めず失敗する。launchd 設定では `UserName` キーを明示しないか、`shuichi` 固定で運用する。
- **stdin の文字コード**: UTF-8 で渡す。シェルラッパーで `LANG=ja_JP.UTF-8 LC_ALL=ja_JP.UTF-8` を明示する。
- **タイムアウト**: ヘッドレス実行はモデル応答待ちでブロックする。Node.js 側で `child_process.spawn` + 5 分タイムアウトを設定する想定。
- **冪等性**: 同日に複数回実行されても上書き保存（`docs/daily/YYYY-MM-DD.md`）。git push 時は `[skip ci]` 等不要（CI を使わないため）。

## 後続タスクへの引き継ぎ

- T005（アーキテクチャ設計）: 上記呼び出しパターンを `src/summarizer.ts` のインターフェース設計に反映する。
- T007（summarizer 実装）: `child_process.spawn('claude', [...])` で stdin にニュース本文を流し、stdout から要約を受け取る。終了コード ≠ 0 は notifier に渡す。

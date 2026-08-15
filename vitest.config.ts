import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 既定の除外に加えて .claude/ 配下を除外する。
    // agent worktree (.claude/worktrees/<name>/) は gitignore 済みだが
    // vitest の既定 include には引っかかるため、ローカル実行時に
    // 別ブランチの古いテストまで拾ってしまう。
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});

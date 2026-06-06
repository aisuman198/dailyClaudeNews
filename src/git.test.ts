import { describe, expect, it } from 'vitest'
import { EXPECTED_BRANCHES } from './git.js'

describe('EXPECTED_BRANCHES', () => {
  it('contains main (manual / development runs)', () => {
    expect(EXPECTED_BRANCHES).toContain('main')
  })

  it('contains cron-runner (cron worktree branch)', () => {
    // scripts/setup-cron-worktree.sh が作る専用ブランチ。
    // worktree 経由の cron が commit すると HEAD はここを指すため、
    // 許可リストに含まれていないと commitAndPush が必ず throw する。
    expect(EXPECTED_BRANCHES).toContain('cron-runner')
  })

  it('is a small, explicit allowlist (no wildcard regressions)', () => {
    // 暴発防止: feature/* や任意ブランチを通したくない
    expect(EXPECTED_BRANCHES.length).toBeLessThanOrEqual(3)
  })
})

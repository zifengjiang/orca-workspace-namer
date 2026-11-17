import { assert, test } from 'orca/testing'

import { composeName, taskFromPrompt } from './namer'

test('a prompt contributes its first real sentence without pleasantries', () => {
  assert.equal(taskFromPrompt('帮我整理一下我的工作区吧\n顺带看看 hook'), '整理一下我的工作区吧')
  assert.equal(taskFromPrompt('\n\n> 请把订单 12345 的指派人改掉。\n'), '把订单 12345 的指派人改掉')
  assert.equal(taskFromPrompt(''), '')
})

test('a tab title is one line, unquoted, without a project prefix', () => {
  assert.equal(composeName('App 升级。', 16), 'App 升级')
  assert.equal(composeName('"name: 整理工作区"', 16), '整理工作区')
  assert.equal(composeName('   \n 1. 蓝牙自动探测  \n', 16), '蓝牙自动探测')
  assert.equal(composeName('hm-operator · 修 CR 评审通知', 16), '修 CR 评审通知')
  assert.equal(composeName('', 16), null)
})

test('a title longer than the limit is cut', () => {
  assert.equal(composeName('这是一个特别特别长的任务标题需要被截断', 6), '这是一个特别')
  assert.equal(composeName('这是一个特别长的任务标题', 4), '这是一个')
})

const CLAUDE_TUI = ` ▐▛███▛█   Claude Code v2.1.311
▝▜██████▀  Fable 5.1 with max effort · API Usage Billing
 ▝▝   ▝▝   /private/tmp/acme-demo
⚠ Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set · auth may not work as expected
  · to use ANTHROPIC_AUTH_TOKEN: Unset the ANTHROPIC_API_KEY environment variable
❯ 看一眼这个目录里有什么文件，一句话总结
· Pouncing… (running UserPromptSubmit hooks… 1/4 · 3s)
───────────────────────────────────────────────────────────────
❯
───────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents`

test('a terminal snapshot yields the typed prompt, not the TUI banner', () => {
  assert.equal(taskFromPrompt(CLAUDE_TUI), '看一眼这个目录里有什么文件，一句话总结')
})

test('a shell command in the snapshot is not mistaken for the task', () => {
  const snapshot = '$ claude\n╭────────────────╮\n> 把订单 12345 的指派人改掉'
  assert.equal(taskFromPrompt(snapshot), '把订单 12345 的指派人改掉')
})

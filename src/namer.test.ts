import { assert, test } from 'orca/testing'

import { composeName, fallbackName, humanizeBranch, labelFor, looksDefault, taskFromPrompt } from './namer'

test('a workspace named after its folder or branch counts as unrenamed', () => {
  assert.equal(looksDefault('feature-upgrade', '/Users/dev/orca/workspaces/acme-api/feature-upgrade', null), true)
  assert.equal(looksDefault('octocat/app-4.6.8', '/tmp/w', 'octocat/app-4.6.8'), true)
  assert.equal(looksDefault('agent-task', '/tmp/w', null), true)
  assert.equal(looksDefault('Acme · App 升级', '/tmp/w', 'octocat/app-4.6.8'), false)
  assert.equal(looksDefault('Home · Notes', '/Users/dev', null), false)
})

test('branch names lose their owner and conventional prefixes', () => {
  assert.equal(humanizeBranch('octocat/app-4.6.8'), 'app 4.6.8')
  assert.equal(humanizeBranch('feat/ble-autoprobe'), 'ble autoprobe')
  assert.equal(humanizeBranch('bug123456-location-agent'), '123456 location agent')
  assert.equal(humanizeBranch(null), '')
})

test('a prompt contributes its first real sentence without pleasantries', () => {
  assert.equal(taskFromPrompt('帮我整理一下我的工作区吧\n顺带看看 hook'), '整理一下我的工作区吧')
  assert.equal(taskFromPrompt('\n\n> 请把订单 12345 的指派人改掉。\n'), '把订单 12345 的指派人改掉')
  assert.equal(taskFromPrompt(''), '')
})

test('a name is always one line, unquoted, and prefixed with its project', () => {
  assert.equal(composeName('Acme · App 升级。', 'Acme', 16), 'Acme · App 升级')
  assert.equal(composeName('"name: Acme · 整理工作区"', 'Acme', 16), 'Acme · 整理工作区')
  assert.equal(composeName('   \n 1. 蓝牙自动探测  \n', 'Acme', 16), 'Acme · 蓝牙自动探测')
  assert.equal(composeName('随便说点什么', 'Acme', 16), 'Acme · 随便说点什么')
  assert.equal(composeName('', 'Acme', 16), null)
})

test('a task part longer than the limit is cut, not the project prefix', () => {
  const name = composeName('Acme · 这是一个特别特别长的任务标题需要被截断', 'Acme', 6)
  assert.equal(name, 'Acme · 这是一个特别')
})

test('the fallback name comes from the branch, then the folder', () => {
  assert.equal(fallbackName('Acme', 'octocat/app-4.6.8', '/tmp/w', 16), 'Acme · app 4.6.8')
  assert.equal(fallbackName('Acme', null, '/Users/dev/projects/handoff-service', 19), 'Acme · handoff-service')
  assert.equal(fallbackName('Acme', 'octocat/app-4.6.8', '/tmp/w', 4), 'Acme · app')
})

test('the project prefix follows the label map, then the project, then the folder', () => {
  const labels = { 'acme-api': 'Acme', 'handoff-service': 'Tools' }
  assert.equal(labelFor(labels, 'acme-api', '/x/acme-api'), 'Acme')
  assert.equal(labelFor(labels, null, '/Users/dev/projects/handoff-service'), 'Tools')
  assert.equal(labelFor(labels, 'web', '/x/web'), 'web')
  assert.equal(labelFor(labels, null, '/x/unknown'), 'unknown')
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

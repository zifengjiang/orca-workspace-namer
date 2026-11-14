import { assert, mountWorker, test } from 'orca/testing'

import * as worker from './worker'

const workspace = {
  id: 'w1',
  kind: 'worktree',
  name: 'feature-upgrade',
  path: '/Users/dev/orca/workspaces/acme-api/feature-upgrade',
  branch: 'octocat/app-4.6.8',
  project: 'acme-api',
  hostId: null,
}

test('tidy renames a workspace still called after its folder', async () => {
  const running = await mountWorker(worker)
  running.host.respond('workspace.list', { workspaces: [workspace], truncated: false })
  running.host.respond('workspace.rename', { name: 'acme-api · app 4.6.8' })

  const result = await running.command('namer.tidy')

  const renamed = (result as { renamed: string[] }).renamed
  assert.equal(renamed.length, 1)
  assert.ok(renamed[0].endsWith(' · app 4.6.8'), renamed[0])
  const renames = running.host.callsOf('workspace.rename')
  assert.equal(renames.length, 1)
  assert.deepEqual(renames[0], { workspaceId: 'w1', name: renamed[0] })
  running.deactivate()
})

test('tidy leaves a workspace that already carries a task name alone', async () => {
  const running = await mountWorker(worker)
  running.host.respond('workspace.list', {
    workspaces: [{ ...workspace, name: 'Acme · App 升级' }],
    truncated: false,
  })

  const result = await running.command('namer.tidy')

  assert.deepEqual(result, { ok: true, renamed: [] })
  assert.equal(running.host.callsOf('workspace.rename').length, 0)
  running.deactivate()
})

test('a working agent gets its terminal kept, so the task survives a hand-typed prompt', async () => {
  const running = await mountWorker(worker)
  running.host.respond('terminal.read', { lines: ['> 帮我整理一下我的工作区吧', 'starting agent'], truncated: false })

  await running.emit('agent.status.changed', {
    workspaceId: 'w1',
    paneKey: 'pane-1',
    terminalId: 'term-1',
    state: 'working',
    receivedAt: Date.now(),
  })

  const stored = running.host.data().storage as Record<string, { text: string }>
  assert.equal(stored['sample:w1'].text, '> 帮我整理一下我的工作区吧\nstarting agent')
  running.deactivate()
})

test('agent.prompt.before keeps the prompt Orca submitted', async () => {
  const running = await mountWorker(worker)

  await running.hooks.fire('agent.prompt.before', {
    agent: 'claude',
    terminalId: 'term-2',
    prompt: '把订单 12345 指派人改成 octocat',
    inputKind: 'orchestration',
  })

  const stored = running.host.data().storage as Record<string, unknown>
  assert.equal(stored['prompt:term-2'], '把订单 12345 指派人改成 octocat')
  running.deactivate()
})

import { assert, mountWorker, test } from 'orca/testing'

import * as worker from './worker'

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
  assert.equal(stored['sample:term-1'].text, '> 帮我整理一下我的工作区吧\nstarting agent')
  running.deactivate()
})

test('two tabs in one workspace keep their own prompt', async () => {
  const running = await mountWorker(worker)
  running.host.respond('terminal.read', { lines: ['> 把订单 12345 的指派人改掉'], truncated: false })

  for (const terminalId of ['term-a', 'term-b']) {
    await running.emit('agent.status.changed', {
      workspaceId: 'w1',
      paneKey: `pane-${terminalId}`,
      terminalId,
      state: 'working',
      receivedAt: Date.now(),
    })
  }

  const stored = running.host.data().storage as Record<string, { text: string }>
  assert.equal(stored['sample:term-a'].text, '> 把订单 12345 的指派人改掉')
  assert.equal(stored['sample:term-b'].text, '> 把订单 12345 的指派人改掉')
  running.deactivate()
})

test('agent.prompt.before keeps the prompt Orca submitted for that tab', async () => {
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

test('a finished agent with nothing to name from is left alone', async () => {
  const running = await mountWorker(worker)

  await running.emit('agent.status.changed', {
    workspaceId: 'w1',
    paneKey: 'pane-1',
    terminalId: 'term-3',
    state: 'done',
    receivedAt: Date.now(),
  })

  assert.deepEqual(running.host.data().storage, {})
  running.deactivate()
})

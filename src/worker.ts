import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'

import { composeName, fallbackName, labelFor, looksDefault, taskFromPrompt } from './namer'

/** Runs a command with stdin closed: a CLI that reads stdin would otherwise wait forever. */
function runCommand(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('timeout'))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', () => {})
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`exit ${code}`))
    })
  })
}

const PROMPT_KEY = (terminalId: string) => `prompt:${terminalId}`
const SAMPLE_KEY = (workspaceId: string) => `sample:${workspaceId}`

type Settings = {
  enabled: boolean
  useModel: boolean
  namerAgent: string
  labels: Record<string, string>
  maxTaskChars: number
  namerModel: string
  timeoutMs: number
}

type Workspace = {
  id: string
  name: string
  path: string
  branch: string | null
  project: string | null
}

export default async function activate(orca: any) {
  const inflight = new Set<string>()

  const readSettings = async (): Promise<Settings> => {
    const raw = (await orca.settings.get()) ?? {}
    let labels: Record<string, string> = {}
    try {
      labels = JSON.parse(raw.labels ?? '{}')
    } catch {
      labels = {}
    }
    return {
      enabled: raw.enabled !== false,
      useModel: raw.useModel !== false,
      namerAgent: String(raw.namerAgent ?? 'auto'),
      labels,
      maxTaskChars: Number(raw.maxTaskChars) || 16,
      namerModel: String(raw.namerModel ?? ''),
      timeoutMs: Number(raw.timeoutMs) || 60_000,
    }
  }

  // Orca only hooks prompts it submits itself; a person typing into the agent TUI
  // is captured from the terminal snapshot while the agent is starting instead.
  orca.hooks.on('agent.prompt.before', (event: any) => {
    const prompt = String(event?.prompt ?? '').slice(0, 4000)
    if (event?.terminalId && prompt) {
      void orca.storage.set(PROMPT_KEY(event.terminalId), prompt).catch(() => {})
    }
    return undefined
  })

  orca.events.on('agent.status.changed', (event: any) => {
    if (!event?.workspaceId) return
    if (event.state === 'working') return snapshotTerminal(orca, event)
    if (event.state !== 'done') return
    void nameWorkspace(orca, readSettings, inflight, event.workspaceId, event.terminalId, {
      useModel: true,
      force: false,
    })
      .catch(() => {})
      .finally(() => forget(orca, event))
  })

  // Preview answers "what would this be called?" without touching the sidebar,
  // so the naming rules can be checked against a real prompt.
  orca.panels.handle('preview', async (input: any) => {
    const settings = await readSettings()
    const list = await orca.host.call('workspace.list', {})
    const workspaces: Workspace[] = list?.workspaces ?? list ?? []
    const workspace = workspaces.find(
      (candidate) => candidate.id === input?.workspaceId || (input?.path && candidate.path === input.path),
    )
    if (!workspace) {
      return { ok: false, reason: 'workspace_missing', saw: workspaces.slice(0, 3).map((w) => w.id), count: workspaces.length }
    }
    const label = labelFor(settings.labels, workspace.project, workspace.path)
    const prompt = String(input?.prompt ?? '') || (await readPrompt(orca, workspace.id, null))
    const task = taskFromPrompt(prompt)
    const name = settings.useModel
      ? await askModel(settings, { label, branch: workspace.branch, task, path: workspace.path })
      : null
    const proposed = name ?? fallbackName(label, workspace.branch, workspace.path, settings.maxTaskChars)
    if (input?.apply && proposed) await rename(orca, workspace.id, proposed)
    return { ok: true, applied: Boolean(input?.apply), current: workspace.name, task, name: proposed }
  })

  orca.commands.register('namer.renameThis', async () => {
    const context = await orca.host.call('workspace.readContext', {})
    const list = await orca.host.call('workspace.list', {})
    const workspaces: Workspace[] = list?.workspaces ?? list ?? []
    const current = workspaces.find((workspace) => workspace.path === context?.path)
    if (!current) return { ok: false, reason: 'no_focused_workspace' }
    return nameWorkspace(orca, readSettings, inflight, current.id, null, { useModel: true, force: true })
  })

  orca.commands.register('namer.tidy', async () => {
    const settings = await readSettings()
    const list = await orca.host.call('workspace.list', {})
    const workspaces: Workspace[] = list?.workspaces ?? list ?? []
    const renamed: string[] = []
    for (const workspace of workspaces) {
      if (!looksDefault(workspace.name, workspace.path, workspace.branch)) continue
      const result = await nameWorkspace(orca, readSettings, inflight, workspace.id, null, {
        useModel: false,
        force: false,
        settings,
      }).catch(() => null)
      if (result?.ok && result.name) renamed.push(result.name)
    }
    return { ok: true, renamed }
  })
}

/** The task is spent once the agent has finished with it. */
async function forget(orca: any, event: any) {
  await orca.storage.delete(SAMPLE_KEY(event.workspaceId)).catch(() => {})
  if (event.terminalId) await orca.storage.delete(PROMPT_KEY(event.terminalId)).catch(() => {})
}

/** Keep whatever the terminal shows at agent start; it is the only copy of a hand-typed prompt. */
async function snapshotTerminal(orca: any, event: any) {
  if (!event.terminalId) return
  try {
    const previous = await readSample(orca, event.workspaceId)
    // A later turn redraws the screen without the prompt, so keep the first snapshot for a while.
    if (previous && Date.now() - previous.at < SAMPLE_FRESH_MS) return
    const snapshot = await orca.host.call('terminal.read', { terminalId: event.terminalId, maxLines: 40 })
    const text = Array.isArray(snapshot?.lines) ? snapshot.lines.join('\n') : String(snapshot ?? '')
    if (text) {
      await orca.storage.set(SAMPLE_KEY(event.workspaceId), { text: String(text).slice(0, 4000), at: Date.now() })
    }
  } catch {
    // Reading is best effort: a missing terminal must never affect the agent.
  }
}

async function nameWorkspace(
  orca: any,
  readSettings: () => Promise<Settings>,
  inflight: Set<string>,
  workspaceId: string,
  terminalId: string | null,
  options: { useModel: boolean; force: boolean; settings?: Settings },
) {
  if (inflight.has(workspaceId)) return { ok: false, reason: 'in_flight' }
  inflight.add(workspaceId)
  try {
    const settings = options.settings ?? (await readSettings())
    if (!settings.enabled && !options.force) return { ok: false, reason: 'disabled' }

    const list = await orca.host.call('workspace.list', {})
    const workspaces: Workspace[] = list?.workspaces ?? list ?? []
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
    if (!workspace) {
      return { ok: false, reason: 'workspace_missing', saw: workspaces.slice(0, 3).map((w) => w.id), count: workspaces.length }
    }
    if (!options.force && !looksDefault(workspace.name, workspace.path, workspace.branch)) {
      return { ok: false, reason: 'already_named' }
    }

    const label = labelFor(settings.labels, workspace.project, workspace.path)
    const prompt = await readPrompt(orca, workspaceId, terminalId)
    const task = taskFromPrompt(prompt)
    if (!task && !workspace.branch) return { ok: false, reason: 'nothing_to_name_from' }

    let name: string | null = null
    if (options.useModel && settings.useModel) {
      name = await askModel(settings, { label, branch: workspace.branch, task, path: workspace.path })
    }
    name ??= fallbackName(label, workspace.branch, workspace.path, settings.maxTaskChars)
    if (!name) return { ok: false, reason: 'no_name' }
    if (name === workspace.name) return { ok: false, reason: 'unchanged' }

    await rename(orca, workspaceId, name)
    return { ok: true, name, from: workspace.name }
  } finally {
    inflight.delete(workspaceId)
  }
}

async function readPrompt(orca: any, workspaceId: string, terminalId: string | null): Promise<string> {
  if (terminalId) {
    const hooked = await orca.storage.get(PROMPT_KEY(terminalId)).catch(() => null)
    if (hooked) return String(hooked)
  }
  const sample = await readSample(orca, workspaceId)
  return sample?.text ?? ''
}

const SAMPLE_FRESH_MS = 30 * 60_000
const SAMPLE_KEEP_MS = 6 * 60 * 60_000

/** Samples written by earlier versions were a bare string. */
async function readSample(orca: any, workspaceId: string): Promise<{ text: string; at: number } | null> {
  const stored = await orca.storage.get(SAMPLE_KEY(workspaceId)).catch(() => null)
  if (!stored) return null
  if (typeof stored === 'string') return { text: stored, at: 0 }
  const sample = stored as { text?: unknown; at?: unknown }
  if (typeof sample.text !== 'string') return null
  const at = Number(sample.at) || 0
  if (at && Date.now() - at > SAMPLE_KEEP_MS) return null
  return { text: sample.text, at }
}

async function askModel(
  settings: Settings,
  context: { label: string; branch: string | null; task: string; path: string },
): Promise<string | null> {
  const instruction = [
    '你在给一个开发工作区起名字，让人一眼看出这次在做什么。',
    `只输出一行，格式：${context.label} · <任务>。任务用中文，最多 ${settings.maxTaskChars} 个字，`,
    '不要引号、不要解释、不要句号、不要重复项目名。',
    '',
    `项目：${context.label}`,
    `分支：${context.branch ?? '(无)'}`,
    `目录：${context.path}`,
    `用户的任务：${context.task || '(未知，按分支推断)'}`,
  ].join('\n')

  for (const agent of agentOrder(settings.namerAgent)) {
    for (const bin of binCandidates(agent.bin)) {
      try {
        const stdout = await runCommand(bin, agent.args(instruction, settings.namerModel), settings.timeoutMs)
        const name = composeName(stdout, context.label, settings.maxTaskChars)
        if (name) return name
      } catch {
        // ENOENT or timeout: try the next candidate, then fall back to the branch name.
      }
    }
  }
  return null
}

/** Each agent CLI takes a prompt differently; only these are worth trying. */
function agentOrder(preference: string): { bin: string; args: (prompt: string, model: string) => string[] }[] {
  const known = {
    pi: { bin: 'pi', args: (prompt: string, model: string) => [...(model ? ['--model', model] : []), '-p', '--no-session', prompt] },
    claude: { bin: 'claude', args: (prompt: string, model: string) => [...(model ? ['--model', model] : []), '-p', prompt] },
    codex: { bin: 'codex', args: (prompt: string, model: string) => ['exec', ...(model ? ['-m', model] : []), prompt] },
  }
  const wanted = preference in known ? [preference as keyof typeof known] : (['pi', 'claude', 'codex'] as const)
  return wanted.map((name) => known[name])
}

/** A GUI app's PATH often misses where these CLIs live, so check the usual places. */
function binCandidates(name: string): string[] {
  const candidates = [`${homedir()}/.local/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]
  const nvm = `${homedir()}/.nvm/versions/node`
  try {
    for (const version of readdirSync(nvm).sort().reverse()) candidates.push(`${nvm}/${version}/bin/${name}`)
  } catch {
    // No nvm install here.
  }
  return [...candidates.filter((candidate) => existsSync(candidate)), name]
}

async function rename(orca: any, workspaceId: string, name: string) {
  if (orca.host.has('workspace.rename')) {
    await orca.host.call('workspace.rename', { workspaceId, name })
    return
  }
  await runCommand('orca', ['worktree', 'set', '--worktree', `id:${workspaceId}`, '--display-name', name], 30_000)
}

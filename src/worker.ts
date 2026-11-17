import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'

import { composeName, taskFromPrompt } from './namer'

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
const SAMPLE_KEY = (terminalId: string) => `sample:${terminalId}`
const NAMED_KEY = (terminalId: string) => `named:${terminalId}`

const SAMPLE_FRESH_MS = 30 * 60_000
const SAMPLE_KEEP_MS = 6 * 60 * 60_000

type Settings = {
  enabled: boolean
  useModel: boolean
  namerAgent: string
  maxTaskChars: number
  namerModel: string
  timeoutMs: number
}

export default async function activate(orca: any) {
  const inflight = new Set<string>()

  const readSettings = async (): Promise<Settings> => {
    const raw = (await orca.settings.get()) ?? {}
    return {
      enabled: raw.enabled !== false,
      useModel: raw.useModel !== false,
      namerAgent: String(raw.namerAgent ?? 'auto'),
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
    if (!event?.terminalId) return
    if (event.state === 'working') return snapshotTerminal(orca, event.terminalId)
    if (event.state !== 'done') return
    const target = { terminalId: event.terminalId as string, sessionId: event.sessionId as string | undefined }
    void nameConversation(orca, readSettings, inflight, target, { force: false })
      .catch(() => {})
      .finally(() => forget(orca, event.terminalId))
  })

  // Names the focused workspace's agent tab now, for checking the rules against a real prompt.
  orca.commands.register('namer.renameThis', async () => {
    const list = await orca.host.call('agents.list', {})
    const agents: { terminalId: string | null; sessionId?: string | null }[] = list?.agents ?? []
    const agent = agents.find((candidate) => candidate.terminalId)
    if (!agent?.terminalId) return { ok: false, reason: 'no_agent' }
    const target = { terminalId: agent.terminalId, sessionId: agent.sessionId ?? undefined }
    return nameConversation(orca, readSettings, inflight, target, { force: true })
  })
}

/** The sampled screen is spent once the agent has finished with it. */
async function forget(orca: any, terminalId: string) {
  await orca.storage.delete(SAMPLE_KEY(terminalId)).catch(() => {})
}

/** Keep whatever the terminal shows at agent start; it is the only copy of a hand-typed prompt. */
async function snapshotTerminal(orca: any, terminalId: string) {
  try {
    const previous = await readSample(orca, terminalId)
    // A later turn redraws the screen without the prompt, so keep the first snapshot for a while.
    if (previous && Date.now() - previous.at < SAMPLE_FRESH_MS) return
    const snapshot = await orca.host.call('terminal.read', { terminalId, maxLines: 40 })
    const text = Array.isArray(snapshot?.lines) ? snapshot.lines.join('\n') : String(snapshot ?? '')
    if (text) {
      await orca.storage.set(SAMPLE_KEY(terminalId), { text: String(text).slice(0, 4000), at: Date.now() })
    }
  } catch {
    // Reading is best effort: a missing terminal must never affect the agent.
  }
}

async function nameConversation(
  orca: any,
  readSettings: () => Promise<Settings>,
  inflight: Set<string>,
  target: { terminalId: string; sessionId?: string },
  options: { force: boolean },
) {
  const { terminalId, sessionId } = target
  if (inflight.has(terminalId)) return { ok: false, reason: 'in_flight' }
  inflight.add(terminalId)
  try {
    const settings = await readSettings()
    if (!settings.enabled && !options.force) return { ok: false, reason: 'disabled' }

    const prompt = await readPrompt(orca, terminalId)
    const task = taskFromPrompt(prompt)
    if (!task) return { ok: false, reason: 'no_task' }

    const named = settings.useModel ? await askModel(settings, task) : null
    const name = named ?? composeName(task, settings.maxTaskChars)
    if (!name) return { ok: false, reason: 'no_name' }

    const previous = await orca.storage.get(NAMED_KEY(terminalId)).catch(() => null)
    if (previous === name) return { ok: false, reason: 'unchanged' }

    await rename(terminalId, sessionId, name)
    await orca.storage.set(NAMED_KEY(terminalId), name).catch(() => {})
    return { ok: true, name }
  } finally {
    inflight.delete(terminalId)
  }
}

async function readPrompt(orca: any, terminalId: string): Promise<string> {
  const hooked = await orca.storage.get(PROMPT_KEY(terminalId)).catch(() => null)
  if (hooked) return String(hooked)
  const sample = await readSample(orca, terminalId)
  return sample?.text ?? ''
}

/** Samples written by earlier versions were a bare string. */
async function readSample(orca: any, terminalId: string): Promise<{ text: string; at: number } | null> {
  const stored = await orca.storage.get(SAMPLE_KEY(terminalId)).catch(() => null)
  if (!stored) return null
  if (typeof stored === 'string') return { text: stored, at: 0 }
  const sample = stored as { text?: unknown; at?: unknown }
  if (typeof sample.text !== 'string') return null
  const at = Number(sample.at) || 0
  if (at && Date.now() - at > SAMPLE_KEEP_MS) return null
  return { text: sample.text, at }
}

async function askModel(settings: Settings, task: string): Promise<string | null> {
  const instruction = [
    '你在给一个开发对话标签起名字，让人一眼看出这次在做什么。',
    `只输出任务本身，最多 ${settings.maxTaskChars} 个字，`,
    '不要项目名、不要引号、不要解释、不要句号。',
    '',
    `用户的任务：${task}`,
  ].join('\n')

  for (const agent of agentOrder(settings.namerAgent)) {
    for (const bin of binCandidates(agent.bin)) {
      try {
        const stdout = await runCommand(bin, agent.args(instruction, settings.namerModel), settings.timeoutMs)
        const name = composeName(stdout, settings.maxTaskChars)
        if (name) return name
      } catch {
        // ENOENT or timeout: try the next candidate, then name from the prompt alone.
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

/**
 * Titles are Orca's to set; a plugin has no host method for them, so the CLI does it. A tracked
 * session carries the conversation name shown in the tab, the sidebar and Session History; a
 * terminal without one still gets its tab title.
 */
async function rename(terminalId: string, sessionId: string | undefined, name: string) {
  const bin = ['/usr/local/bin/orca', '/opt/homebrew/bin/orca', '/Applications/Orca.app/Contents/Resources/bin/orca'].find(
    (candidate) => existsSync(candidate),
  )
  const orca = bin ?? 'orca'
  if (sessionId) {
    await runCommand(orca, ['chat', 'rename', '--session', sessionId, '--name', name], 30_000)
    return
  }
  await runCommand(orca, ['terminal', 'rename', '--terminal', terminalId, '--title', name], 30_000)
}

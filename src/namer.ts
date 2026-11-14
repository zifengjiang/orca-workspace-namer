// Pure naming rules. No Orca API here, so src/namer.test.ts can exercise them directly.

export const SEPARATOR = ' · '

const DEFAULT_NAMES = /^(agent-task|task|worktree|new-worktree|untitled|tmp|scratch)$/i
const BRANCH_PREFIX = /^(feat|fix|bugfix|hotfix|chore|refactor|docs|test|perf|ci|release)\//i
const OWNER_PREFIX = /^[a-z0-9_.-]+\//i
const PROMPT_NOISE = /^(帮我|帮忙|请|麻烦|能不能|能否|可以|我想|需要|帮忙把|帮我把)\s*/u
const TICKET = /\b(?:bug|cr|issue|task)[\s:#-]*(\d{4,})\b/i

/** A workspace Orca named after its folder, branch or a placeholder. */
export function looksDefault(name: string, path: string, branch: string | null): boolean {
  const trimmed = name.trim()
  if (!trimmed) return true
  const folder = path.split('/').filter(Boolean).pop() ?? ''
  if (trimmed === folder) return true
  if (branch && trimmed === branch) return true
  if (DEFAULT_NAMES.test(trimmed)) return true
  if (trimmed.includes('/')) return true
  return false
}

/** `octocat/app-4.6.8` → `app 4.6.8`; `bug123456-location-agent` → `123456 location agent`. */
export function humanizeBranch(branch: string | null): string {
  if (!branch) return ''
  let slug = branch.trim()
  slug = slug.replace(BRANCH_PREFIX, '')
  slug = slug.replace(OWNER_PREFIX, '')
  const ticket = slug.match(TICKET)
  if (ticket) slug = slug.replace(ticket[0], '')
  slug = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!slug) return ''
  return ticket ? `${ticket[1]} ${slug}`.trim() : slug
}

/** The opening sentence of what the person asked the agent, with pleasantries removed. */
export function taskFromPrompt(text: string): string {
  const lines = stripAnsi(text)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))

  for (const line of lines) {
    const marked = line.match(PROMPT_MARKER)
    if (marked && plausible(marked[1].trim())) return tidy(marked[1])
  }
  for (const line of lines) {
    if (plausible(line.trim())) return tidy(line)
  }
  return ''
}

/** A TUI redraws its banner around the prompt; neither is the task. */
const CHROME =
  /claude code|api usage|anthropic|bypass permissions|for agents|tips for|shortcuts|pouncing|hooks|escape to interrupt|ctrl\+|shift\+tab|^\s*\/\S+$|^\s*[⏵◈●○·│─└┌▐▝]|^\s*(claude|pi|codex|npm|npx|git|cd|ls)\b/i
const PROMPT_MARKER = /^[❯>›»$#]\s*(.+)$/u
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g

function stripAnsi(text: string): string {
  return text.replace(ANSI, '').replace(/\r/g, '')
}

function plausible(line: string): boolean {
  return line.length >= 4 && !CHROME.test(line)
}

function tidy(line: string): string {
  const cleaned = line.replace(PROMPT_NOISE, '').replace(/[。.!?！？]+$/u, '').trim()
  return cleaned.replace(/\s+/g, ' ')
}

/** Keep one line, no quoting, no closing punctuation, and always `<label> · <task>`. */
export function composeName(raw: string, label: string, maxTaskChars: number): string | null {
  let line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return null
  line = line.replace(/^[-*•\d.\s]+/u, '').replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, '')
  line = line.replace(/^(名字|工作区名字|name)\s*[:：]\s*/i, '')
  line = line.replace(/[。.,；;]+$/u, '').trim()

  const bare = line.startsWith(label + SEPARATOR) ? line.slice(label.length + SEPARATOR.length) : line
  const withoutLabel = bare.includes(SEPARATOR) ? bare.slice(bare.lastIndexOf(SEPARATOR) + SEPARATOR.length) : bare
  const task = Array.from(withoutLabel.trim()).slice(0, maxTaskChars).join('').trim()
  if (!task) return null
  return `${label}${SEPARATOR}${task}`
}

/** Deterministic name used when the model is unavailable or too slow. */
export function fallbackName(label: string, branch: string | null, path: string, maxTaskChars: number): string | null {
  const fromBranch = humanizeBranch(branch)
  const folder = path.split('/').filter(Boolean).pop() ?? ''
  const task = Array.from(fromBranch || folder).slice(0, maxTaskChars).join('').trim()
  return task ? `${label}${SEPARATOR}${task}` : null
}

/** Project label from the mapping, falling back to the project or folder name. */
export function labelFor(labels: Record<string, string>, project: string | null, path: string): string {
  const folder = path.split('/').filter(Boolean).pop() ?? path
  for (const candidate of [project, folder]) {
    if (candidate && labels[candidate]) return labels[candidate]
  }
  return project ?? folder
}

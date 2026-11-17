// Pure naming rules. No Orca API here, so src/namer.test.ts can exercise them directly.

const SEPARATOR = ' · '

/** A TUI redraws its banner around the prompt; neither is the task. */
const CHROME =
  /claude code|api usage|anthropic|bypass permissions|for agents|tips for|shortcuts|pouncing|hooks|escape to interrupt|ctrl\+|shift\+tab|^\s*\/\S+$|^\s*[⏵◈●○·│─└┌▐▝]|^\s*(claude|pi|codex|npm|npx|git|cd|ls)\b/i
const PROMPT_MARKER = /^[❯>›»$#]\s*(.+)$/u
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g
const PROMPT_NOISE = /^(帮我|帮忙|请|麻烦|能不能|能否|可以|我想|需要|帮忙把|帮我把)\s*/u

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

/** A tab title: one line, unquoted, no project prefix, cut to `maxTaskChars`. */
export function composeName(raw: string, maxTaskChars: number): string | null {
  let line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return null
  line = line.replace(/^[-*•\d.\s]+/u, '').replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, '')
  line = line.replace(/^(名字|标签|tab|name|title)\s*[:：]\s*/i, '')
  line = line.replace(/[。.,；;]+$/u, '').trim()

  // A model that echoes `Project · task` gets only its task part kept.
  const bare = line.includes(SEPARATOR) ? line.slice(line.lastIndexOf(SEPARATOR) + SEPARATOR.length) : line
  const name = Array.from(bare.trim()).slice(0, maxTaskChars).join('').trim()
  return name || null
}

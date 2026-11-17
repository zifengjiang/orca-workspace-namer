# Tab Namer

An Orca plugin that renames a conversation once its agent stops, using what that conversation was actually asked to do — so a tab reads `修复蓝牙重连` instead of `..ode27-upgrade`.

The agent is never asked to name anything. It finishes, the plugin reads the task that conversation was given, and renames its tab behind it. Workspaces keep whatever name they have.

## Install

```sh
orca plugin install zifengjiang/orca-workspace-namer
```

Or from a local folder while developing:

```sh
orca plugin dev load ./workspace-namer
```

It runs Node.js code with your user account's access to the machine and asks for these capabilities: read workspaces and agent status, read terminal output, and its own storage and settings.

## What it does

When an agent in a terminal tab turns `done`:

1. Takes the task from the prompt Orca submitted (`agent.prompt.before`), or — for a prompt a person typed into the agent's own TUI — from a terminal snapshot taken while the agent was starting. Both are kept per terminal, so two tabs in one workspace never borrow each other's task.
2. Turns it into one short line with a local agent CLI, or from the prompt itself when no CLI answers.
3. Renames that conversation: `chat rename` on the agent session Orca tracks (the name shows in the tab, the sidebar and Session History), or `terminal rename` on the tab when the terminal runs no tracked session. A conversation whose name already says this is left alone, so a later turn only renames when the task itself changed.

Renaming only ever happens after the agent stops, so it cannot disturb work in progress, and it applies to agents Orca did not launch too — anything that reports agent status in a terminal.

A tab holding split panes is renamed as a whole; the plugin does not touch individual pane titles.

## Settings

| Key | Meaning |
| --- | --- |
| `enabled` | Rename when an agent stops |
| `useModel` | Use a local agent CLI; off names from the prompt alone |
| `namerAgent` | `auto`, `pi`, `claude` or `codex` |
| `namerModel` | Model passed to that CLI; empty uses its default |
| `maxTaskChars` | Longest tab name, 16 by default |
| `timeoutMs` | Naming timeout, 60 s by default |

## Commands

- **Rename this conversation after its task** — rename the focused workspace's agent tab now.

## Requirements

- Orca `>=1.4.248`.
- One of `pi`, `claude` or `codex` on `PATH` for model naming; `auto` tries them in that order. Locations such as `~/.local/bin`, `/opt/homebrew/bin` and `~/.nvm/versions/node/*/bin` are checked because a GUI app's `PATH` often misses them.
- Orca's own CLI for the rename itself: plugin host APIs have no way to set a name, so `orca chat rename` and `orca terminal rename` do it. `/usr/local/bin`, `/opt/homebrew/bin` and the app bundle are checked.

## Development

```sh
orca plugin validate .
orca plugin test .
orca plugin dev load .
```

`src/namer.ts` holds the naming rules with no Orca API, so they are tested directly; `src/worker.ts` wires events, hooks and commands.

Naming costs one short model call per finished agent. Turn off `useModel` to keep it entirely local.

## License

MIT

# Workspace Namer

An Orca plugin that renames a workspace once its agent stops, using what the agent was actually asked to do — so the sidebar says `acme-api · Fix BLE reconnect` instead of `feature/ble-reconnect`.

The agent is never asked to name anything. It finishes, the plugin reads the task it was given, and renames the workspace behind it.

## Install

```sh
orca plugin install zifengjiang/orca-workspace-namer
```

Or from a local folder while developing:

```sh
orca plugin dev load ./workspace-namer
```

It runs Node.js code with your user account's access to the machine and asks for these capabilities: read workspaces and agent status, read terminal output, rename workspaces, and its own storage and settings.

## What it does

When an agent in a workspace turns `done`:

1. Skips the workspace if it already has a name of the form `Project · Task`.
2. Takes the task from the prompt Orca submitted (`agent.prompt.before`), or — for a prompt a person typed into the agent's own TUI — from a terminal snapshot taken while the agent was starting.
3. Asks a local agent CLI to turn that into one short line, then renames the workspace.

If no CLI answers, the name falls back to the branch, then the folder.

Renaming only ever happens after the agent stops, so it cannot disturb work in progress, and it applies to agents Orca did not launch too — anything that reports agent status in a terminal.

## Settings

| Key | Meaning |
| --- | --- |
| `enabled` | Rename when an agent stops |
| `useModel` | Use a local agent CLI; off means name from the branch alone |
| `namerAgent` | `auto`, `pi`, `claude` or `codex` |
| `namerModel` | Model passed to that CLI; empty uses its default |
| `labels` | JSON map from project or folder name to the prefix, e.g. `{"acme-api":"Acme"}` |
| `maxTaskChars` | Longest task part, 16 by default |
| `timeoutMs` | Naming timeout, 60 s by default |

## Commands

- **Rename this workspace after its task** — rename the focused workspace now.
- **Rename workspaces still called after their folder** — sweep every workspace whose name is still its folder or branch, without calling a model.

## Requirements

- Orca `>=1.4.248`.
- One of `pi`, `claude` or `codex` on `PATH` for model naming; `auto` tries them in that order. Locations such as `~/.local/bin`, `/opt/homebrew/bin` and `~/.nvm/versions/node/*/bin` are checked because a GUI app's `PATH` often misses them.

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

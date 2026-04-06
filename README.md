# Sidebar Terminal Hub

Sidebar Terminal Hub is a VS Code extension that embeds an interactive terminal directly into the secondary sidebar.

Its core workflow is:

**Open sidebar terminal → keep command sessions pinned on the side → run CLI tools without switching to the bottom panel**

This project is focused on turning the sidebar into a practical terminal workspace, rather than adding unrelated terminal features by default.

[中文说明](./README.zh.md)

---

## Problem It Solves

VS Code's built-in terminal is powerful, but it usually lives in the bottom panel.

That layout is not ideal when you want to:

- keep a terminal visible while editing
- pin long-running CLI sessions to the side
- treat the sidebar as a lightweight command hub

Sidebar Terminal Hub reduces that friction by placing an interactive terminal where sidebar-oriented workflows already happen.

---

## Features

- Interactive terminal embedded in the secondary sidebar
- Multiple terminal sessions with tabs
- Direct keyboard input, paste, and command execution
- ANSI / TUI output support
- Status bar button to open the sidebar terminal quickly
- View title actions for creating and closing sessions
- Custom quick-command buttons for your own workflow

---

## Typical Use Cases

- Keep coding and terminal output visible at the same time
- Pin Codex, test runners, build scripts, or dev servers in the sidebar
- Maintain multiple CLI sessions without constantly toggling the bottom panel
- Turn the secondary sidebar into a lightweight terminal hub

---

## Design Direction

This repository is maintained as a focused fork.

The goal is not to mirror every upstream terminal interaction tweak.  
The goal is to keep a cleaner product direction around the idea of a **sidebar terminal hub**.

---

## Development

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch the extension development host.

---

## Packaging

```bash
npm.cmd run package:patch
```

This command will:

- bump the patch version
- compile the extension
- generate a new `.vsix`

---

## Repository

- GitHub: [Junyu06/sidebar-terminal-hub](https://github.com/Junyu06/sidebar-terminal-hub)

---

## License

MIT

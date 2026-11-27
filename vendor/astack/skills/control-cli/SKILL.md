---
name: control-cli
description: Drive a command-line tool or terminal UI the way a user does and keep proof that it works. Runs one-shot commands and checks their output and exit codes, and drives interactive TUIs through tmux with keystrokes and screen captures. Use when shipping or fixing a CLI or TUI, to reproduce a bug on its real surface, or when the user says "run the CLI", "drive the TUI", or "show it working".
---

# Control CLI

Prove a CLI or TUI change by running the real program the way a user would, and keep what it printed. A passing unit test is not this proof. If the repository has a `verify-<app>` skill or its own terminal harness, follow that first, and use this skill only for what it doesn't cover.

## Before you start

- **Isolate state.** Point the program's home, config, and data directories at a fresh temporary directory, through `HOME`, `XDG_CONFIG_HOME`, or the tool's own variable, such as `APP_HOME=$(mktemp -d)`. Never run against the user's real config, history, or data.
- **Avoid real cost and side effects.** Use the project's mock, dry-run, or offline mode when one exists. A dry run can still touch the network or open a browser, so watch what it does. If the change shows only against a real service, say so, and stop before you spend money or touch a shared system.
- **Run what you built.** Run the binary or script built from your working tree, not a global install. Put its version or path in the evidence.
- **Keep evidence in one place** that a later session can read: a gitignored folder the project already uses for artifacts, or `~/.local/state/astack/proof/<repo>/<branch-or-slug>/`, or the folder your brief names when parallel workers share a branch. Never commit it.

## One-shot commands

1. Run the command with the inputs a user would give. Capture stdout, stderr, and the exit code apart: `cmd >out.txt 2>err.txt; echo $? >code.txt`.
2. Check each one against what the change promises: the text, the exit code, and any file it writes. Check the failure path too. A bad flag or a missing input exits nonzero with an error that says what to fix.
3. Parse machine-readable output such as JSON with `jq` instead of reading it by eye.

## Interactive TUIs

Drive the TUI in a detached `tmux` session, so you can send keys and read the screen.

```sh
tmux new-session -d -s proof -x 120 -y 40 '<command>'
tmux send-keys -t proof 'hello' Enter
tmux capture-pane -t proof -p >screen-1.txt
tmux capture-pane -t proof -p -e >screen-1.ansi
tmux kill-session -t proof
```

`capture-pane -p` gives plain text. Add `-e` to keep colors when color is part of the change.

- **Wait for the screen, not the clock.** After each key, poll `capture-pane` until the expected text appears, with a timeout. A fixed `sleep` is slow and flaky.
- **Send real keys.** Special keys go by name: `Enter`, `Escape`, `Tab`, `Up`, `C-c`. Send text with `-l` when it could look like a key name.
- **Check resize and exit.** When layout is part of the change, resize with `tmux resize-window -t proof -x 80 -y 24` and capture again. Confirm the program exits cleanly and leaves the terminal usable.
- **Kill only what you started.** Use a session name unique to the run, and never kill by process name.
- No `tmux`? Use the project's own pseudo-terminal harness, or `script` to record a session. Say which one you used.

## Report

Show the exact commands, the output or screen captures that matter, and the exit codes, before and after for a bug fix. Give the paths of the saved evidence. Name what you didn't drive, such as a platform, a real service, or a terminal size, and why.

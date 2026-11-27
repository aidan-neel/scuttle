#!/usr/bin/env python3
"""Check the shape of astack's models file, the one setup-models writes.

Usage: lint-models.py [FILE]

FILE defaults to $XDG_CONFIG_HOME/astack/models.md, or ~/.config/astack/models.md. Prints one line
per problem with its line number. Errors are lines skills would skip, so a size silently runs on
the session's own model. Warnings are allowed shapes worth a look, such as a council with fewer
than three seats. Exits 1 on any error, 0 otherwise. It checks the shape only: whether a model
exists, and which vendor made it, needs the harness's own model list.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

SIZES = ("nano", "small", "medium", "large", "xlarge", "max", "design", "panel", "council")
LISTS = ("panel", "council")
BUDGETS = ("unlimited", "large", "medium", "small")
SECTIONS = ("t3-code", "claude-code", "codex", "opencode", "devin", "antigravity")
ANTIGRAVITY_MODELS = ("flash_lite", "flash", "pro")
SIZE_LINE = re.compile(r"(\w[\w-]*):\s*(.*)$")


def entry_problem(section: str, entry: str) -> str | None:
    """Why one model entry doesn't fit its section, or None."""
    if entry == "inherit":
        return None
    words = entry.split()
    if section == "t3-code":
        if "/" not in words[0] or words[0].startswith("/") or words[0].endswith("/"):
            return f"`{entry}` needs <providerInstanceId>/<model> first"
        bad = [w for w in words[1:] if not re.fullmatch(r"[\w.-]+=\S+", w)]
        return f"`{' '.join(bad)}` should be <optionId>=<value>" if bad else None
    if len(words) != 1:
        return f"`{entry}` should be one model id with no options"
    if section == "opencode" and not re.fullmatch(r"[^/\s]+/\S+", entry):
        return f"`{entry}` needs provider/model, with an optional #variant"
    if section == "antigravity" and entry not in ANTIGRAVITY_MODELS:
        return f"`{entry}` isn't one of {', '.join(('inherit',) + ANTIGRAVITY_MODELS)}"
    return None


def lint(text: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    section = None
    seen_sections: set[str] = set()
    seen_sizes: set[str] = set()
    budget_seen = False
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        where = f"line {number}"
        if line.startswith("## "):
            section = line[3:].strip()
            seen_sizes = set()
            if section not in SECTIONS:
                errors.append(f"{where}: unknown section `{section}`; use one of {', '.join(SECTIONS)}")
            elif section in seen_sections:
                errors.append(f"{where}: section `{section}` appears twice; skills read only one")
            seen_sections.add(section)
            continue
        if section is None:
            if line.startswith("budget:"):
                value = line.split(":", 1)[1].strip()
                if budget_seen:
                    errors.append(f"{where}: a second budget line")
                if value not in BUDGETS:
                    errors.append(f"{where}: budget `{value}` isn't one of {', '.join(BUDGETS)}")
                budget_seen = True
            continue
        if not line:
            continue
        match = SIZE_LINE.match(line)
        if section == "devin" and not (match and match.group(1) in SIZES):
            continue
        if not match or match.group(1) not in SIZES:
            errors.append(f"{where}: `{line}` isn't a size line; sizes are {', '.join(SIZES)}")
            continue
        size, value = match.groups()
        if size in seen_sizes:
            errors.append(f"{where}: `{size}` appears twice in `{section}`")
        seen_sizes.add(size)
        if section == "devin":
            warnings.append(f"{where}: Devin fixes the model per profile, so skills don't read this line")
        entries = [e.strip() for e in value.split(",")] if size in LISTS else [value.strip()]
        if not all(entries):
            errors.append(f"{where}: `{size}` has an empty entry")
            continue
        for entry in entries:
            problem = entry_problem(section, entry)
            if problem:
                errors.append(f"{where}: {problem}")
        if size == "council" and entries != ["inherit"]:
            if len(entries) > 3:
                errors.append(f"{where}: council takes exactly three seats, not {len(entries)}")
            elif len(entries) < 3:
                warnings.append(f"{where}: council has {len(entries)} seats; the Council playbook will report the gap")
        if size == "panel" and len(entries) == 1 and entries != ["inherit"]:
            warnings.append(f"{where}: panel has one entry; cross-vendor checks need two or more")
    if not budget_seen:
        warnings.append("no `budget:` line, so skills have no starting reasoning effort to set")
    return errors, warnings


def default_path() -> Path:
    config = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(config) / "astack" / "models.md"


def main(argv: list[str]) -> int:
    if len(argv) > 1 or argv[:1] in (["-h"], ["--help"]):
        print(__doc__.strip())
        return 0 if argv[:1] in (["-h"], ["--help"]) else 2
    path = Path(argv[0]) if argv else default_path()
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"lint-models.py: no models file at {path}; run the setup-models skill to write one", file=sys.stderr)
        return 1
    errors, warnings = lint(text)
    for message in errors:
        print(f"{path}: error: {message}")
    for message in warnings:
        print(f"{path}: warning: {message}")
    if not errors and not warnings:
        print(f"{path}: ok")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

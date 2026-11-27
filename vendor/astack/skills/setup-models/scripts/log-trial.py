#!/usr/bin/env python3
"""Append or summarize astack model trial runs in ~/.config/astack/model-trials.md.

Usage:
  log-trial.py --summary [FILE]
  log-trial.py --project NAME --size SIZE --model MODEL --task TEXT \
               --outcome pass|partial|fail --checks pass|fail|skip \
               --rework none|minor|major --notes TEXT [FILE]
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from datetime import date
from pathlib import Path

OUTCOMES = ("pass", "partial", "fail")
CHECKS = ("pass", "fail", "skip")
REWORKS = ("none", "minor", "major")
SIZES = ("nano", "small", "medium", "large", "xlarge", "max", "design", "panel", "council")

TABLE_HEADER = (
    "## Runs\n\n"
    "| Date | Project | Size | Model | Task | Outcome | Checks | Rework | Notes |\n"
    "|---|---|---|---|---|---|---|---|---|\n"
)


def default_path() -> Path:
    config = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(config) / "astack" / "model-trials.md"


def sanitize_cell(value: str) -> str:
    return " ".join(value.replace("|", "/").splitlines()).strip()


def parse_rows(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    in_runs = False
    for raw in text.splitlines():
        line = raw.strip()
        if line == "## Runs":
            in_runs = True
            continue
        if in_runs and line.startswith("## "):
            break
        if not in_runs or not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 9 or cells[0] in ("Date", "---") or all(set(c) <= {"-"} for c in cells):
            continue
        rows.append(
            {
                "date": cells[0],
                "project": cells[1],
                "size": cells[2],
                "model": cells[3],
                "task": cells[4],
                "outcome": cells[5],
                "checks": cells[6],
                "rework": cells[7],
                "notes": cells[8],
            }
        )
    return rows


def append_row(path: Path, args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(f"# astack model trials\n\n{TABLE_HEADER}", encoding="utf-8")
    text = path.read_text(encoding="utf-8")
    if "## Runs" not in text:
        sep = "" if text.endswith("\n\n") else "\n"
        text = f"{text}{sep}{TABLE_HEADER}"
    if not text.endswith("\n"):
        text += "\n"
    row = "| " + " | ".join(
        sanitize_cell(v)
        for v in (
            args.date or date.today().isoformat(),
            args.project,
            args.size,
            args.model,
            args.task,
            args.outcome,
            args.checks,
            args.rework,
            args.notes,
        )
    ) + " |\n"
    path.write_text(text + row, encoding="utf-8")


def print_summary(path: Path) -> int:
    if not path.exists():
        print(f"No trial log found at {path}.")
        return 0
    rows = parse_rows(path.read_text(encoding="utf-8"))
    if not rows:
        print(f"{path}: 0 runs logged yet.")
        return 0
    by_model: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_model.setdefault(row["model"], []).append(row)
    print(f"{path}: {len(rows)} run(s) logged")
    for model, items in sorted(by_model.items()):
        outcomes = Counter(item["outcome"] for item in items)
        checks = Counter(item["checks"] for item in items)
        reworks = Counter(item["rework"] for item in items)
        sizes = Counter(item["size"] for item in items)
        total = len(items)
        pass_pct = round((outcomes["pass"] / total) * 100)
        size_str = ", ".join(f"{k}:{v}" for k, v in sorted(sizes.items()))
        print(
            f"- {model}: {total} run(s) | pass {outcomes['pass']}/{total} ({pass_pct}%), "
            f"partial {outcomes['partial']}, fail {outcomes['fail']} | "
            f"checks pass {checks['pass']}/{total} | "
            f"rework none:{reworks['none']} minor:{reworks['minor']} major:{reworks['major']} | "
            f"sizes {size_str}"
        )
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Log or summarize astack model trial runs.")
    parser.add_argument("--summary", action="store_true", help="Print summary stats.")
    parser.add_argument("--file", type=Path, default=None, help="Path to model-trials.md.")
    parser.add_argument("--date", default=None)
    parser.add_argument("--project")
    parser.add_argument("--size", choices=SIZES)
    parser.add_argument("--model")
    parser.add_argument("--task")
    parser.add_argument("--outcome", choices=OUTCOMES)
    parser.add_argument("--checks", choices=CHECKS)
    parser.add_argument("--rework", choices=REWORKS)
    parser.add_argument("--notes", default="")
    args = parser.parse_args(argv)

    path = args.file or default_path()
    if args.summary:
        return print_summary(path)

    required = ("project", "size", "model", "task", "outcome", "checks", "rework")
    missing = [name for name in required if getattr(args, name) is None]
    if missing:
        parser.error(f"missing required arguments: {', '.join('--' + m for m in missing)}")

    append_row(path, args)
    print(f"Logged {args.model} ({args.size}, {args.outcome}) to {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

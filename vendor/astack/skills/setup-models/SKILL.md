---
name: setup-models
description: Map astack's model sizes (nano, small, medium, large, xlarge, max, design, panel, council) to models you can actually run, per harness and for T3 Code delegation, and set the reasoning budget. Interviews the user on their orchestrator, provider quotas, and preferences, proposes a balanced cross-vendor split, and writes the global ~/.config/astack/models.md. Use for /setup-models, $setup-models, "configure my models", "change my models", or a budget change.
disable-model-invocation: true
---

# Setup models

This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Write `~/.config/astack/models.md`, the one global file every astack skill reads to pick a subagent's model, in every project and every harness on this machine. Run it from any folder. It never reads or writes anything in the current project. Skills never name a model. They name a size, and this file maps each size to a model you have. The repository ships no model choices, because each machine and account sees different ones.

## Sizes

| Size | What runs on it | Typical pick |
|---|---|---|
| `nano` | Read-only explorers, dispatchers, tooling checks, trivial mechanical edits | Fastest, lowest-cost model on a roomy quota |
| `small` | Swarm workers, routine code, verification runs, targeted fixes | Fast, quota-efficient code workhorse |
| `medium` | Code delegates in the Bug fix, Feature, Refactoring, Perf issue, and Hillclimb playbooks | Fast workhorse (when quota is tight or trial data is strong) or mid/strong code model |
| `large` | Complex multi-file changes, deep debugging, judgment, prose, synthesis | Strong mid/frontier coding model |
| `xlarge` | Hardest escalations, architecture, and cross-cutting changes when `large` isn't enough | Strongest flagship (favoring a larger quota bucket) |
| `max` | Extreme, last-resort tasks when `xlarge` fails or explicit maximum capability is needed | Heaviest frontier tier available (optional; leave out or `inherit` if none) |
| `design` | UI and visual design delegates | The model whose UI work the user likes best |
| `panel` | Arena runners and cross-judge, interrogate adversaries, swarm model races, eval candidates, and cross-vendor reviews | Two strong models from two different vendors, best judge first |
| `council` | The Council playbook | Exactly three strong flagships from three different vendors, each at high effort |

## Steps

### 1. Detect the models you can run

A list the harness gives you is the only dependable source. Never write a model you haven't seen in one.

| Where | How to list | Form to write |
|---|---|---|
| T3 Code | `orchestrator_capabilities`, plus its `search` for models outside the short list | `<providerInstanceId>/<model>`, then each option as `<optionId>=<value>` |
| Claude Code | The values the subagent tool's `model` field accepts in this session | Exactly as listed |
| Codex | `codex debug models`. It prints JSON; the slugs of entries with `"visibility": "list"` are the choices | The slug |
| OpenCode | `opencode models` | `provider/model`, plus `#variant` when the model has variants |
| Devin CLI | None per spawn: a profile fixes its model | Leave the section empty and say why |
| Antigravity | The values the subagent tool's model field lists. It has no effort option | Exactly as listed |

Inside T3 Code, fill the `## t3-code` section first. It is what every cross-vendor seat runs on, and it is the only place one session can reach every provider. Then fill the section for the harness you run in. Offer once to fill other sections if the user pastes their lists. Otherwise leave those sections as they are.

For T3 Code, keep only provider instances with `canRunChildTask` true and no constraint such as "disabled". A seat on a provider other than the one you run on also needs `canRunCrossProviderChildTask`. Diversity counts the model's vendor, the family that made it, not the provider instance. A provider that hosts other vendors' models counts as the vendor of the model it runs. Two instances of one vendor (two accounts) are separate seats but the same vendor.

### 2. Load the current file and trial log

If `~/.config/astack/models.md` exists, read it. Its `budget:` line and size lines are the current choices. A line that isn't a size in the shape of step 5 is retired. Use it as a hint for the matching size, drop it, and tell the user. With no file, every size starts as `inherit`.

If `~/.config/astack/model-trials.md` exists, run [`scripts/log-trial.py`](scripts/log-trial.py) `--summary` so real pass and rework rates inform your recommendations.

### 3. Ask the user about their workflow, quotas, and preferences

Before proposing a map, ask the user concise questions (use multiple-choice where it fits) covering:

1. **Main orchestrator:** Which model and harness usually runs their top-level session? (Name the current session's model as the default.)
2. **Subscriptions and quota split:** Which providers have larger vs. smaller plans, pay-per-token limits, or backup accounts? Ask whether they want to stretch a tight quota (favoring a fast workhorse on `small` and `medium`) or maximize first-pass depth on `medium`.
3. **Reasoning effort budget** (naming the current budget if one exists):
   - `unlimited`: the highest reasoning effort the model offers
   - `large`: one step below the highest
   - `medium`: the middle of the ladder
   - `small`: the lowest effort that still reasons
   Skills start each spawn at this level and raise it one step for the hardest work or lower it for routine work. Map the label onto each model's own effort ladder.
4. **Preferences and exclusions:** Preferred model for `design`, any ultra-heavy model to keep manual-only (never mapped to a size), and any models to exclude from `panel` (for example, models that tend to agree with diffs instead of finding real bugs).

Keep the interview to one turn unless a follow-up is genuinely needed.

### 4. Propose a balanced model split

Use the detected lists, the user's answers, and any trial log stats to propose a model for every size. Explain the rationale clearly before writing:

- **Balance quotas across vendors:** Do not double-tap the user's smallest provider bucket with both a heavy orchestrator and heavy delegates. If one vendor runs the long-context orchestrator and fast workhorses, route `large`, `design`, `nano`, and primary `panel` review to providers with more quota headroom.
- **Keep planning, coding, and review diverse:** Separate the orchestrator, workhorse, and reviewers across different vendors where available. Agreement across model families is stronger evidence than same-family sign-off.
- **Workhorse split (`nano`, `small`, `medium`):**
  - Put `nano` on a cheap, fast model from a roomy quota.
  - Put `small` on a fast coding workhorse.
  - Put `medium` on that same fast workhorse when quota is tight or trial logs show high clean pass rates (escalating hard tasks to `large`), or step `medium` up to a stronger coding model when the user has quota headroom and wants deeper first-pass handling on multi-file stateful changes.
- **Escalation and UI (`large`, `xlarge`, `max`, `design`):** Step `large` up to a stronger coding model, assign the user's strongest flagship to `xlarge` (and `design` to their preferred UI model), and reserve `max` for an ultra-heavy last-resort tier when the user has one.
- **Review `panel` vs. `council`:**
  - `panel` is a comma-separated list (one seat runs per entry). Default to **two strong models from different vendors**, best judge first. Avoid duplicating the orchestrator's vendor in `panel` when that vendor's quota is tight, and leave out weak or sycophantic reviewers.
  - `council` is **three entries from three distinct vendors**, each pinned to high effort (or the closest the model offers). Propose the latest flagship from each vendor. If fewer than three vendors are reachable, write the ones you have and tell the user the Council playbook will report the gap.
  - In T3 Code, a `panel` or `council` entry carries its own options, so each seat keeps the effort it lists.
- **Backups and trials:** List available backup provider instances or overflow models in the file header notes when the user has secondary accounts, and suggest starting a trial in `~/.config/astack/model-trials.md` whenever testing a faster workhorse on `small` or `medium`.

Show the full proposed mapping in a compact table (Slot, Model and effort, Why) plus a short per-provider quota breakdown, and ask the user whether to accept it or adjust specific sizes. Don't favor a vendor; propose from what the user has and pays for.

### 5. Write the file

Overwrite the whole file, so a rerun gives the same result. Keep the sections you didn't change. You may include short plain-text header notes before `budget:` (for example: effort cap, active trial, manual-only models, and backup seats). Shape:

```markdown
# astack models

One line per size. A missing line, or `inherit`, runs that size on the session's own model.
Written by the setup-models skill. Rerun it to change these.

budget: large

## t3-code

nano: <providerInstanceId>/<model> <optionId>=<value>
small: ...
medium: ...
large: ...
xlarge: ...
max: ...
design: ...
panel: <entry>, <entry>
council: <entry>, <entry>, <entry>

## claude-code

nano: <model>
...

## codex

nano: <model>
...

## opencode

nano: <provider/model#variant>
...

## antigravity

nano: <model>
...
```

Every real model and option you write must be in the step 1 list for that section. If one isn't, ask again.

### 6. Confirm

Run [`scripts/lint-models.py`](scripts/lint-models.py) on the file and fix each error it reports; an error is a line skills would skip. Then tell the user the file was written, any warning the lint printed, which sizes changed, and that skills read it once per session, so the change applies from the next session.

If the user is trialing a model for one or more sizes, record the active trial in `~/.config/astack/model-trials.md` so leads log completed runs with [`scripts/log-trial.py`](scripts/log-trial.py) and can summarize usefulness with `--summary`.

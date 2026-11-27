### Autonomous run

**You own the exit condition. Define done, then drive to it without stopping.**

1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero).
2. Pick the wake mechanism. Each iteration ends by arranging the next wake, so the run paces itself.
   - An event to watch (CI, a merge, a ref advancing) wakes you on the event. In T3 Code, follow its PR rules ([t3-code.md](../references/harnesses/t3-code.md#pull-requests)): watch the PR when its watch tool is listed, and T3 wakes you on each event. T3 forbids sleeps, loops, `--watch` commands, and scheduled wakes for PR waits. Elsewhere, run the watch command in the background (`gh pr checks <pr> --watch`, a loop on `git ls-remote`) or hand it to a `nano` subagent in the background that returns when the event fires, and back it with a long scheduled heartbeat in case the event never comes.
   - With no event, schedule the next wake at a fixed interval, sized to when the result is worth re-checking.
   - Never poll in a foreground sleep loop.
3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, commits if it advanced, and discards changes that didn't help. Belt-and-suspenders that "might help" gets reverted, not left to ride. Verify each unit before the next instead of batching checks at the end, per the **principle-sequence-verifiable-units** skill.
4. Mid-run discoveries that support the goal are yours. Address broken skills, related bugs, flaky verifiers, review noise, tooling failures, orphaned follow-ups, and fixable drift yourself with the **go** skill. Put out-of-band fixes in their own PR. Do not park reversible work for the human, and do not ask the user. Surface only irreversible actions, genuine product or preference calls no experiment can settle, or a real dead end. Keep the predicate as the main drive, and return to it after each side fix.
5. Checkpoint every iteration with the **show-me-your-work** skill, a row for what changed and whether the predicate moved.
6. Stop when the predicate is met, and cancel the scheduled wake. A plateau is not a stop, so keep going and pivot your approach to push past it. Surface a genuine dead end rather than spinning, and never relax the predicate to declare victory.

**Reply:** the exit condition, iterations run, what landed, what was discarded, final predicate state.

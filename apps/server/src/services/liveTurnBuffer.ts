import type { Database } from "bun:sqlite";
import type { ThreadTurn } from "@scuttle/contracts";

interface LiveTurnEntry {
  assistantText: string;
  thinkingText: string;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const UPDATE_TURN_TEXT_SQL =
  "UPDATE turns SET assistant_message = ?, thinking_text = ? WHERE id = ?";

export class LiveTurnBuffer {
  private readonly entries = new Map<string, LiveTurnEntry>();
  private disposed = false;

  constructor(
    private readonly db: Database,
    private readonly flushDelayMs = 150,
  ) {}

  update(turnId: string, assistantText: string, thinkingText: string): void {
    if (this.disposed) return;
    let entry = this.entries.get(turnId);
    if (!entry) {
      entry = {
        assistantText,
        thinkingText,
        dirty: true,
        timer: null,
      };
      this.entries.set(turnId, entry);
    } else {
      entry.assistantText = assistantText;
      entry.thinkingText = thinkingText;
      entry.dirty = true;
    }
    if (entry.timer === null) {
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (!this.disposed) {
          this.flush(turnId);
        }
      }, this.flushDelayMs);
    }
  }

  flush(turnId: string): void {
    const entry = this.entries.get(turnId);
    if (!entry) return;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (!entry.dirty) return;
    this.db.query(UPDATE_TURN_TEXT_SQL).run(entry.assistantText, entry.thinkingText, turnId);
    entry.dirty = false;
  }

  flushAll(): void {
    for (const turnId of this.entries.keys()) {
      this.flush(turnId);
    }
  }

  delete(turnId: string): void {
    const entry = this.entries.get(turnId);
    if (!entry) return;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.entries.delete(turnId);
  }

  overlayTurn(turn: ThreadTurn): ThreadTurn {
    const entry = this.entries.get(turn.id);
    if (!entry) return turn;
    return {
      ...turn,
      assistantMessage: entry.assistantText,
      thinkingText: entry.thinkingText,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.flushAll();
    } catch {
      // Database may already be closed during teardown.
    }
    for (const entry of this.entries.values()) {
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    this.entries.clear();
  }
}

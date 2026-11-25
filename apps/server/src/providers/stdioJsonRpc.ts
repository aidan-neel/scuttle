import type { Subprocess } from "bun";

export interface JsonRpcNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface JsonRpcIncomingRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params: unknown;
}

export interface StdioJsonRpcOptions {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
  readonly onNotification?: (notification: JsonRpcNotification) => void;
  readonly onRequest?: (request: JsonRpcIncomingRequest) => Promise<unknown>;
  readonly onStderr?: (text: string) => void;
}

interface PendingRpcCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class StdioJsonRpcProcess {
  private readonly proc: Subprocess<"pipe", "pipe", "pipe">;
  private readonly pending = new Map<string, PendingRpcCall>();
  private nextId = 1;
  private closed = false;
  private stderrTail = "";

  constructor(private readonly options: StdioJsonRpcOptions) {
    const mergedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) mergedEnv[key] = value;
    }
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (value !== undefined) mergedEnv[key] = value;
      }
    }

    this.proc = Bun.spawn([options.command, ...options.args], {
      cwd: options.cwd,
      env: mergedEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    void this.readStdout();
    void this.readStderr();
    void this.proc.exited.then((code) => {
      this.closed = true;
      const err = new Error(
        `Process "${options.command}" exited with code ${code}${this.stderrTail ? `: ${this.stderrTail.slice(-400)}` : ""}`,
      );
      for (const [id, call] of this.pending.entries()) {
        clearTimeout(call.timer);
        call.reject(err);
        this.pending.delete(id);
      }
    });
  }

  get exited(): Promise<number> {
    return this.proc.exited;
  }

  get stderr(): string {
    return this.stderrTail;
  }

  private writeJson(payload: unknown): void {
    if (this.closed) return;
    const line = `${JSON.stringify(payload)}\n`;
    void this.proc.stdin.write(line);
  }

  request(method: string, params?: unknown, timeoutMs = 45_000): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error(`RPC process "${this.options.command}" is already closed.`));
    }
    const id = this.nextId++;
    const key = String(id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`RPC request "${method}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(key, { resolve, reject, timer });
      this.writeJson({
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });
    });
  }

  notify(method: string, params?: unknown): void {
    this.writeJson({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    });
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.proc.stdin.end();
    } catch {
      // Ignore already-closed stdin.
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // Ignore already-exited process.
    }
    setTimeout(() => {
      try {
        this.proc.kill("SIGKILL");
      } catch {
        // Ignore already-exited process.
      }
    }, 1500);
  }

  private async readStdout(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).replace(/\r$/, "").trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line.length > 0) {
            this.handleLine(line);
          }
          newlineIdx = buffer.indexOf("\n");
        }
      }
      const trailing = buffer.trim();
      if (trailing.length > 0) {
        this.handleLine(trailing);
      }
    } catch {
      // Stream ended.
    }
  }

  private async readStderr(): Promise<void> {
    const reader = this.proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        this.stderrTail = (this.stderrTail + chunk).slice(-4096);
        this.options.onStderr?.(chunk);
      }
    } catch {
      // Stream ended.
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(parsed)) return;

    const hasId = typeof parsed.id === "string" || typeof parsed.id === "number";
    const hasMethod = typeof parsed.method === "string";

    if (hasId && !hasMethod) {
      const key = String(parsed.id);
      const call = this.pending.get(key);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(key);
      if ("error" in parsed && parsed.error !== undefined) {
        const errObj = isObject(parsed.error) ? parsed.error : undefined;
        const msg =
          typeof errObj?.message === "string" ? errObj.message : JSON.stringify(parsed.error);
        call.reject(new Error(msg));
      } else {
        call.resolve(parsed.result);
      }
      return;
    }

    if (hasMethod && hasId) {
      const reqId = parsed.id;
      const method = parsed.method;
      if (typeof method !== "string" || (typeof reqId !== "string" && typeof reqId !== "number")) {
        return;
      }
      if (!this.options.onRequest) {
        this.writeJson({
          jsonrpc: "2.0",
          id: reqId,
          error: { code: -32601, message: `Method not handled: ${method}` },
        });
        return;
      }
      void this.options
        .onRequest({ id: reqId, method, params: parsed.params })
        .then((result) => {
          this.writeJson({ jsonrpc: "2.0", id: reqId, result });
        })
        .catch((error: unknown) => {
          this.writeJson({
            jsonrpc: "2.0",
            id: reqId,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        });
      return;
    }

    if (hasMethod && typeof parsed.method === "string") {
      this.options.onNotification?.({ method: parsed.method, params: parsed.params });
    }
  }
}

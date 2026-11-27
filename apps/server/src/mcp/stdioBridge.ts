export interface StdioBridgeOptions {
  readonly endpoint: string;
  readonly authorization: string;
  readonly input: AsyncIterable<string | Uint8Array>;
  readonly output: { write(chunk: string): unknown };
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getProp = (value: unknown, key: string): unknown =>
  isObject(value) ? Reflect.get(value, key) : undefined;

const parseSsePayloads = (text: string): ReadonlyArray<unknown> => {
  const payloads: Array<unknown> = [];
  let dataLines: Array<string> = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n").trim();
    dataLines = [];
    if (raw.length === 0 || raw === "[DONE]") return;
    try {
      payloads.push(JSON.parse(raw));
    } catch {
      // Ignore malformed SSE keepalive frames.
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) flush();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  flush();
  return payloads;
};

const readResponsePayloads = async (response: Response): Promise<ReadonlyArray<unknown>> => {
  if (response.status === 202 || response.status === 204) return [];
  const text = await response.text();
  if (text.trim().length === 0) return [];
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/event-stream")) return parseSsePayloads(text);
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
};

export const runStdioBridge = async (options: StdioBridgeOptions): Promise<void> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;
  let sessionBarrier: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<void>>();

  const writeMessage = (payload: unknown): void => {
    options.output.write(`${JSON.stringify(payload)}\n`);
  };

  const buildHeaders = (includeContentType: boolean): Record<string, string> => ({
    accept: "application/json, text/event-stream",
    authorization: options.authorization,
    ...(includeContentType ? { "content-type": "application/json" } : {}),
    ...(sessionId !== null ? { "mcp-session-id": sessionId } : {}),
    ...(protocolVersion !== null ? { "mcp-protocol-version": protocolVersion } : {}),
  });

  const forwardLine = async (line: string, messageId: unknown): Promise<void> => {
    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: buildHeaders(true),
        body: line,
      });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      if (!response.ok) {
        await response.text().catch(() => "");
        if (messageId !== undefined) {
          writeMessage({
            jsonrpc: "2.0",
            id: messageId ?? null,
            error: { code: -32603, message: `Scuttle MCP HTTP ${response.status}.` },
          });
        }
        return;
      }
      for (const entry of await readResponsePayloads(response)) {
        const version = getProp(getProp(entry, "result"), "protocolVersion");
        if (typeof version === "string" && version.length > 0) protocolVersion = version;
        writeMessage(entry);
      }
    } catch (error) {
      if (messageId !== undefined) {
        const msg = error instanceof Error ? error.message : String(error);
        writeMessage({
          jsonrpc: "2.0",
          id: messageId ?? null,
          error: { code: -32603, message: `Scuttle MCP bridge error: ${msg}` },
        });
      }
    }
  };

  const track = (task: Promise<void>): void => {
    const wrapped = task.finally(() => pending.delete(wrapped));
    pending.add(wrapped);
  };

  const dispatchLine = (rawLine: string): void => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (!isObject(parsed)) return;
    const messageId = getProp(parsed, "id");
    const method = getProp(parsed, "method");
    if (method === "initialize" || method === "notifications/initialized") {
      const next = sessionBarrier.then(() => forwardLine(line, messageId));
      sessionBarrier = next;
      track(next);
      return;
    }
    track(sessionBarrier.then(() => forwardLine(line, messageId)));
  };

  // Split strictly on \n so raw U+2028/U+2029 inside JSON strings stay intact.
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of options.input) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    for (let idx = buffer.indexOf("\n"); idx !== -1; idx = buffer.indexOf("\n")) {
      dispatchLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) dispatchLine(buffer);

  await Promise.allSettled(pending);
  await fetchImpl(options.endpoint, { method: "DELETE", headers: buildHeaders(false) })
    .then((res) => res.text().catch(() => ""))
    .catch(() => {});
};

if (import.meta.main) {
  const endpoint = process.env.SCUTTLE_MCP_ENDPOINT;
  const authorization = process.env.SCUTTLE_MCP_AUTHORIZATION;
  if (!endpoint || !authorization) {
    process.stderr.write("SCUTTLE_MCP_ENDPOINT and SCUTTLE_MCP_AUTHORIZATION are required.\n");
    process.exit(2);
  }
  await runStdioBridge({ endpoint, authorization, input: process.stdin, output: process.stdout });
}

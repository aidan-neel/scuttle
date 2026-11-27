import * as Crypto from "node:crypto";

export const DEFAULT_MCP_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface IssueMcpTokenInput {
  readonly threadId: string;
  readonly projectId: string;
  readonly agentId?: string | undefined;
  readonly delegationId?: string | undefined;
  readonly providerId?: string | undefined;
}

export interface McpSessionContext extends IssueMcpTokenInput {
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface IssuedMcpToken {
  readonly token: string;
  readonly authorizationHeader: string;
}

export interface McpSessionRegistryOptions {
  readonly ttlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

interface StoredSession {
  readonly digest: Buffer;
  readonly context: {
    readonly threadId: string;
    readonly projectId: string;
    readonly agentId?: string | undefined;
    readonly delegationId?: string | undefined;
    readonly providerId?: string | undefined;
    readonly createdAt: number;
    lastSeenAt: number;
  };
}

export interface McpSessionRegistry {
  readonly issueToken: (ctx: IssueMcpTokenInput) => IssuedMcpToken;
  readonly verifyAuthorization: (authHeader: string | null | undefined) => McpSessionContext | null;
  readonly revokeThread: (threadId: string) => number;
  readonly cleanupExpired: () => number;
}

const sha256Digest = (token: string): Buffer => Crypto.createHash("sha256").update(token).digest();

const extractBearerToken = (authHeader: string | null | undefined): string | null => {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  const match = /^Bearer\s+(\S+)$/i.exec(trimmed);
  return match?.[1] ?? null;
};

export const makeMcpSessionRegistry = (options?: McpSessionRegistryOptions): McpSessionRegistry => {
  const ttlMs = options?.ttlMs ?? DEFAULT_MCP_SESSION_TTL_MS;
  const now = options?.now ?? (() => Date.now());
  const sessions = new Map<string, StoredSession>();

  const isExpired = (entry: StoredSession, timestamp: number): boolean =>
    timestamp - entry.context.lastSeenAt > ttlMs;

  const issueToken: McpSessionRegistry["issueToken"] = (ctx) => {
    const token = Crypto.randomBytes(32).toString("base64url");
    const digest = sha256Digest(token);
    const key = digest.toString("hex");
    const createdAt = now();
    sessions.set(key, {
      digest,
      context: {
        threadId: ctx.threadId,
        projectId: ctx.projectId,
        ...(ctx.agentId !== undefined ? { agentId: ctx.agentId } : {}),
        ...(ctx.delegationId !== undefined ? { delegationId: ctx.delegationId } : {}),
        ...(ctx.providerId !== undefined ? { providerId: ctx.providerId } : {}),
        createdAt,
        lastSeenAt: createdAt,
      },
    });
    return {
      token,
      authorizationHeader: `Bearer ${token}`,
    };
  };

  const verifyAuthorization: McpSessionRegistry["verifyAuthorization"] = (authHeader) => {
    const token = extractBearerToken(authHeader);
    if (token === null) return null;
    const candidateDigest = sha256Digest(token);
    const key = candidateDigest.toString("hex");
    const entry = sessions.get(key);
    if (!entry) return null;
    if (
      entry.digest.length !== candidateDigest.length ||
      !Crypto.timingSafeEqual(entry.digest, candidateDigest)
    ) {
      return null;
    }
    const timestamp = now();
    if (isExpired(entry, timestamp)) {
      sessions.delete(key);
      return null;
    }
    entry.context.lastSeenAt = timestamp;
    return { ...entry.context };
  };

  const revokeThread: McpSessionRegistry["revokeThread"] = (threadId) => {
    let removed = 0;
    for (const [key, entry] of sessions) {
      if (entry.context.threadId === threadId) {
        sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  };

  const cleanupExpired: McpSessionRegistry["cleanupExpired"] = () => {
    const timestamp = now();
    let removed = 0;
    for (const [key, entry] of sessions) {
      if (isExpired(entry, timestamp)) {
        sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  };

  return {
    issueToken,
    verifyAuthorization,
    revokeThread,
    cleanupExpired,
  };
};

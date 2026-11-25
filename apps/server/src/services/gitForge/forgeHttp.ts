import type { ForgeKind } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { redactSecrets } from "./redact.ts";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class ForgeHttpError extends Schema.TaggedError<ForgeHttpError>()("ForgeHttpError", {
  status: Schema.Number,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export const DEFAULT_HOST: Record<ForgeKind, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
};

const FORGE_LABEL: Record<ForgeKind, string> = { github: "GitHub", gitlab: "GitLab" };

export const normalizeHost = (raw: string): string | null => {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/.test(host) ? host : null;
};

export const apiBaseUrl = (forge: ForgeKind, host: string): string => {
  if (forge === "gitlab") return `https://${host}/api/v4`;
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
};

const messageOf = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const texts = value.filter((item) => typeof item === "string");
    return texts.length > 0 ? texts.join(", ") : null;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    return messageOf(value.message);
  }
  return null;
};

export const forgeErrorMessage = (payload: unknown): string | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const details =
    "errors" in payload && Array.isArray(payload.errors)
      ? payload.errors.map(messageOf).filter((text) => text !== null)
      : [];
  const head = messageOf(payload);
  const parts = [head, ...details].filter((text) => text !== null && text.length > 0);
  return parts.length > 0 ? parts.join(": ") : null;
};

const authHeaders = (forge: ForgeKind, token: string): Record<string, string> =>
  forge === "github"
    ? {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      }
    : { Authorization: `Bearer ${token}`, Accept: "application/json" };

const readJson = (response: Response) =>
  Effect.tryPromise({
    try: (): Promise<unknown> => response.json(),
    catch: () =>
      new ForgeHttpError({ status: response.status, detail: "Forge returned invalid JSON." }),
  });

export const forgeRequest = (input: {
  readonly fetch: FetchFn;
  readonly forge: ForgeKind;
  readonly host: string;
  readonly token: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: Readonly<Record<string, string | boolean>>;
}) =>
  Effect.gen(function* () {
    const url = `${apiBaseUrl(input.forge, input.host)}/${input.path}`;
    const response = yield* Effect.tryPromise({
      try: () =>
        input.fetch(url, {
          method: input.method,
          headers: {
            ...authHeaders(input.forge, input.token),
            ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
          signal: AbortSignal.timeout(20_000),
        }),
      catch: (cause) =>
        new ForgeHttpError({
          status: 0,
          detail: `Could not reach ${input.host}: ${redactSecrets(String(cause), [input.token])}`,
        }),
    });
    if (response.status === 401 || response.status === 403) {
      return yield* new ForgeHttpError({
        status: response.status,
        detail: `${FORGE_LABEL[input.forge]} rejected the saved credential. Reconnect in Settings → Git.`,
      });
    }
    const payload = yield* readJson(response);
    if (!response.ok) {
      const message = forgeErrorMessage(payload) ?? `HTTP ${response.status}`;
      return yield* new ForgeHttpError({
        status: response.status,
        detail: `${FORGE_LABEL[input.forge]} request failed: ${redactSecrets(message, [input.token])}`,
      });
    }
    return payload;
  });

const ForgeUser = Schema.Union([
  Schema.Struct({ login: Schema.String }),
  Schema.Struct({ username: Schema.String }),
]);

export const fetchForgeUsername = (fetch: FetchFn, forge: ForgeKind, host: string, token: string) =>
  forgeRequest({ fetch, forge, host, token, method: "GET", path: "user" }).pipe(
    Effect.flatMap((payload) =>
      Schema.decodeUnknownEffect(ForgeUser)(payload).pipe(
        Effect.mapError(
          () => new ForgeHttpError({ status: 502, detail: "Forge returned an unexpected user." }),
        ),
      ),
    ),
    Effect.map((user) => ("login" in user ? user.login : user.username)),
  );

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
});

const AccessTokenResponse = Schema.Union([
  Schema.Struct({ access_token: Schema.String }),
  Schema.Struct({ error: Schema.String, interval: Schema.optionalKey(Schema.Number) }),
]);

const postForm = <A>(
  fetch: FetchFn,
  url: string,
  form: Record<string, string>,
  schema: Schema.Decoder<A>,
) =>
  Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(20_000),
      }),
    catch: () => new ForgeHttpError({ status: 0, detail: "Could not reach github.com." }),
  }).pipe(
    Effect.flatMap(readJson),
    Effect.flatMap((payload) =>
      Schema.decodeUnknownEffect(schema)(payload).pipe(
        Effect.mapError(
          () =>
            new ForgeHttpError({
              status: 502,
              detail:
                "GitHub device flow returned an unexpected response. Check the OAuth client ID.",
            }),
        ),
      ),
    ),
  );

export const requestDeviceCode = (fetch: FetchFn, clientId: string) =>
  postForm(
    fetch,
    "https://github.com/login/device/code",
    { client_id: clientId, scope: "repo read:org" },
    DeviceCodeResponse,
  );

export const requestDeviceToken = (fetch: FetchFn, clientId: string, deviceCode: string) =>
  postForm(
    fetch,
    "https://github.com/login/oauth/access_token",
    {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    AccessTokenResponse,
  );

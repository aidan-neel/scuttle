import type { ForgeKind } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import type { CommandRunner } from "./processRunner.ts";

export interface CliLogin {
  readonly host: string;
  readonly username: string | null;
}

export interface CliDetection {
  readonly installed: boolean;
  readonly version: string | null;
  readonly logins: ReadonlyArray<CliLogin>;
}

export const CLI_BINARY: Record<ForgeKind, string> = { github: "gh", gitlab: "glab" };

const LOGGED_IN = /Logged in to (\S+?)(?:\s+(?:account|as)\s+([^\s(]+))?(?:\s|$)/;

export const parseCliAuthStatus = (text: string): ReadonlyArray<CliLogin> => {
  const logins: CliLogin[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = LOGGED_IN.exec(line);
    if (match === null) continue;
    const host = match[1]!.toLowerCase();
    if (logins.some((login) => login.host === host)) continue;
    logins.push({ host, username: match[2] ?? null });
  }
  return logins;
};

export const parseCliVersion = (text: string): string | null =>
  /(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(text)?.[1] ?? null;

export const detectCli = (runner: CommandRunner, forge: ForgeKind) =>
  Effect.gen(function* () {
    const binary = CLI_BINARY[forge];
    const versionRes = yield* runner([binary, "--version"], { timeoutMs: 5_000 });
    if (versionRes.exitCode !== 0) {
      return { installed: false, version: null, logins: [] } satisfies CliDetection;
    }
    const authRes = yield* runner([binary, "auth", "status"], { timeoutMs: 10_000 });
    return {
      installed: true,
      version: parseCliVersion(versionRes.stdout || versionRes.stderr),
      logins: parseCliAuthStatus(`${authRes.stdout}\n${authRes.stderr}`),
    } satisfies CliDetection;
  });

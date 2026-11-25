import * as Effect from "effect/Effect";

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export type CommandRunner = (
  argv: ReadonlyArray<string>,
  options?: CommandOptions,
) => Effect.Effect<CommandResult>;

const DEFAULT_TIMEOUT_MS = 20_000;

const NON_INTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
  GLAB_CHECK_UPDATE: "false",
  GIT_OPTIONAL_LOCKS: "0",
  NO_COLOR: "1",
};

export const runCommand: CommandRunner = (argv, options) =>
  Effect.promise(async () => {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const proc = Bun.spawn([...argv], {
        ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...NON_INTERACTIVE_ENV },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<CommandResult>((resolve) => {
        timer = setTimeout(() => {
          proc.kill();
          resolve({ exitCode: 124, stdout: "", stderr: "", timedOut: true });
        }, timeoutMs);
      });
      const completed = Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr, timedOut: false }));
      const result = await Promise.race([completed, deadline]);
      clearTimeout(timer);
      return result;
    } catch (error) {
      return {
        exitCode: 127,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false,
      };
    }
  });

export const commandFailure = (result: CommandResult, fallback: string): string => {
  if (result.timedOut) return `${fallback} (timed out)`;
  const text = result.stderr.trim() || result.stdout.trim();
  return text.length > 0 ? text : fallback;
};

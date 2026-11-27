import { Copy01Icon, LinkSquare02Icon, Logout01Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { DeviceFlowStart, ForgeStatus } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { SettingsGroup, SettingsRow } from "@/components/settings/primitives.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { type Feedback, FeedbackLine, GitInput } from "./fields.tsx";
import { FORGE_NAME, ForgeLogo } from "./ForgeLogo.tsx";
import { getGitApi, openExternalUrl } from "./gitApi.ts";

const CLI_NAME = { github: "gh", gitlab: "glab" } as const;
const TOKEN_SCOPE = { github: "repo", gitlab: "api" } as const;

const SOURCE_LABEL: Record<ForgeStatus["authSource"], string> = {
  "gh-cli": "via gh CLI",
  "glab-cli": "via glab CLI",
  oauth: "via OAuth",
  token: "via access token",
  none: "",
};

const connectionSummary = (status: ForgeStatus): string => {
  if (!status.connected) return "Not connected";
  const who = status.username !== null ? `@${status.username}` : status.host;
  return `${who} on ${status.host} ${SOURCE_LABEL[status.authSource]}`;
};

const cliSummary = (status: ForgeStatus): string => {
  const cli = CLI_NAME[status.forge];
  if (!status.cliInstalled) return `Not installed. Install ${cli} to use your existing login.`;
  const version = status.cliVersion !== null ? `${cli} ${status.cliVersion}` : cli;
  return status.cliAuthenticated
    ? `${version} · signed in`
    : `${version} · run \`${cli} auth login\` to sign in`;
};

function DeviceFlowPanel({
  flow,
  onCancel,
}: {
  readonly flow: DeviceFlowStart;
  readonly onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    openExternalUrl(flow.verificationUri);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <div className="font-mono text-[1.1875rem] leading-7 font-medium tracking-[0.18em] text-fg select-all">
          {flow.userCode}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-label text-fg-muted">
          <DotSpinner variant="loading" label="Waiting for authorization" />
          Enter this code on GitHub. Waiting for approval…
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void copyAndOpen()}>
          <Icon icon={copied ? LinkSquare02Icon : Copy01Icon} />
          {copied ? "Open GitHub" : "Copy & open"}
        </Button>
      </div>
    </div>
  );
}

function TokenForm({
  status,
  onConnected,
}: {
  readonly status: ForgeStatus;
  readonly onConnected: (status: ForgeStatus) => void;
}) {
  const [token, setToken] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const isGitlab = status.forge === "gitlab";

  const submit = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const api = await getGitApi();
      const trimmedHost = host.trim();
      const next = await api.connectForgeToken({
        forge: status.forge,
        token: token.trim(),
        ...(trimmedHost.length > 0 ? { host: trimmedHost } : {}),
      });
      setToken("");
      onConnected(next);
    } catch (error) {
      setFeedback({ tone: "error", text: describeApiError(error, "Could not save the token.") });
    }
    setBusy(false);
  };

  return (
    <form
      className="space-y-2 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (token.trim().length > 0) void submit();
      }}
    >
      <div className="text-body text-fg">Personal access token</div>
      <div className="text-label text-fg-muted">
        Needs the <code className="font-mono">{TOKEN_SCOPE[status.forge]}</code> scope. Stored
        locally and never sent back to the app.
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {isGitlab && (
          <GitInput
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="gitlab.com"
            aria-label="GitLab host"
            className="font-mono sm:w-44"
          />
        )}
        <GitInput
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={isGitlab ? "glpat-…" : "ghp_… or github_pat_…"}
          aria-label={`${FORGE_NAME[status.forge]} access token`}
          className="min-w-0 flex-1 basis-48 font-mono"
        />
        <Button type="submit" size="lg" disabled={busy || token.trim().length === 0}>
          {busy ? "Checking…" : "Connect"}
        </Button>
      </div>
      <FeedbackLine feedback={feedback} />
    </form>
  );
}

export function ForgeCard({
  status,
  onStatus,
}: {
  readonly status: ForgeStatus;
  readonly onStatus: (status: ForgeStatus) => void;
}) {
  const [flow, setFlow] = useState<DeviceFlowStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const name = FORGE_NAME[status.forge];

  useEffect(() => {
    if (flow === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (seconds: number) => {
      timer = setTimeout(() => void poll(), seconds * 1000);
    };
    const poll = async () => {
      try {
        const api = await getGitApi();
        const result = await api.pollGithubDeviceFlow(flow.flowId);
        if (cancelled) return;
        if (result.kind === "pending") return schedule(result.intervalSeconds);
        setFlow(null);
        if (result.kind === "complete") onStatus(result.status);
        else if (result.kind === "expired") {
          setFeedback({ tone: "error", text: "The code expired. Start sign-in again." });
        } else setFeedback({ tone: "error", text: "Sign-in was denied on GitHub." });
      } catch (error) {
        if (cancelled) return;
        setFlow(null);
        setFeedback({ tone: "error", text: describeApiError(error, "GitHub sign-in failed.") });
      }
    };
    schedule(flow.intervalSeconds);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow]);

  const startOAuth = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const api = await getGitApi();
      setFlow(await api.startGithubDeviceFlow());
    } catch (error) {
      setFeedback({ tone: "error", text: describeApiError(error, "Could not start sign-in.") });
    }
    setBusy(false);
  };

  const signOut = async () => {
    setBusy(true);
    try {
      const api = await getGitApi();
      onStatus(await api.disconnectForge(status.forge));
    } catch (error) {
      setFeedback({ tone: "error", text: describeApiError(error, "Could not sign out.") });
    }
    setBusy(false);
  };

  const showOAuth = status.oauthAvailable && !status.hasStoredCredential && flow === null;

  return (
    <SettingsGroup>
      <div className="flex items-center gap-3 px-4 py-3">
        <ForgeLogo forge={status.forge} className="size-4.5" />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-fg">{name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-label text-fg-muted">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                status.connected ? "bg-success" : "bg-fg-faint",
              )}
            />
            <span className="truncate">{connectionSummary(status)}</span>
          </div>
        </div>
        {status.hasStoredCredential && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void signOut()}>
            <Icon icon={Logout01Icon} />
            {status.authSource === "gh-cli" || status.authSource === "glab-cli"
              ? "Remove saved login"
              : "Sign out"}
          </Button>
        )}
        {showOAuth && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void startOAuth()}>
            Sign in with GitHub
          </Button>
        )}
      </div>
      {flow !== null && <DeviceFlowPanel flow={flow} onCancel={() => setFlow(null)} />}
      {feedback !== null && (
        <div className="px-4 py-2">
          <FeedbackLine feedback={feedback} />
        </div>
      )}
      <SettingsRow title={`${CLI_NAME[status.forge]} CLI`} description={cliSummary(status)} />
      {!status.hasStoredCredential && <TokenForm status={status} onConnected={onStatus} />}
    </SettingsGroup>
  );
}

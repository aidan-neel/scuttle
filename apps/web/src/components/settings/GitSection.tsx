import { RefreshIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { ForgeStatus } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { Skeleton } from "skullet/react";
import { FeedbackLine } from "@/components/git/fields.tsx";
import { ForgeCard } from "@/components/git/ForgeCard.tsx";
import { getGitApi } from "@/components/git/gitApi.ts";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";

const SAMPLE_FORGES: ReadonlyArray<ForgeStatus> = [
  {
    forge: "github",
    connected: true,
    authSource: "gh-cli",
    host: "github.com",
    username: "octocat",
    cliInstalled: true,
    cliVersion: "2.62.0",
    cliAuthenticated: true,
    hasStoredCredential: false,
    oauthAvailable: true,
  },
  {
    forge: "gitlab",
    connected: false,
    authSource: "none",
    host: "gitlab.com",
    username: null,
    cliInstalled: false,
    cliVersion: null,
    cliAuthenticated: false,
    hasStoredCredential: false,
    oauthAvailable: false,
  },
];

let cachedForges: ReadonlyArray<ForgeStatus> | null = null;

export function GitSection() {
  const [forges, setForges] = useState<ReadonlyArray<ForgeStatus> | null>(() => cachedForges);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh: boolean, silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const api = await getGitApi();
      const next = await api.listForges(refresh);
      cachedForges = next;
      setForges(next);
      setError(null);
    } catch (cause) {
      if (cachedForges === null || !silent) {
        setError(describeApiError(cause, "Could not load Git accounts."));
      }
    }
    if (!silent) setRefreshing(false);
  };

  useEffect(() => {
    void load(false, cachedForges !== null);
  }, []);

  const replace = (next: ForgeStatus) =>
    setForges((current) => {
      const updated =
        current === null
          ? [next]
          : current.map((item) => (item.forge === next.forge ? next : item));
      cachedForges = updated;
      return updated;
    });

  return (
    <section className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2 px-0.5">
        <h2 className="text-label font-medium text-fg-secondary">Accounts</h2>
        <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void load(true)}>
          <Icon icon={RefreshIcon} className={cn(refreshing && "animate-spin")} />
          Re-check
        </Button>
      </div>
      {error !== null && <FeedbackLine feedback={{ tone: "error", text: error }} />}
      <Skeleton
        data={forges}
        sample={SAMPLE_FORGES}
        loading={forges === null && error === null}
        id="git-accounts"
        label="Loading Git accounts"
        error={error !== null && forges === null ? <div /> : undefined}
      >
        {(items) => (
          <div className="space-y-4">
            {items.map((status) => (
              <ForgeCard key={status.forge} status={status} onStatus={replace} />
            ))}
          </div>
        )}
      </Skeleton>
    </section>
  );
}

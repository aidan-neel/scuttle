import { RefreshIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { ForgeStatus } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { FeedbackLine } from "@/components/git/fields.tsx";
import { ForgeCard } from "@/components/git/ForgeCard.tsx";
import { getGitApi } from "@/components/git/gitApi.ts";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";

export function GitSection() {
  const [forges, setForges] = useState<ReadonlyArray<ForgeStatus> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh: boolean) => {
    setRefreshing(true);
    try {
      const api = await getGitApi();
      setForges(await api.listForges(refresh));
      setError(null);
    } catch (cause) {
      setError(describeApiError(cause, "Could not load Git accounts."));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const replace = (next: ForgeStatus) =>
    setForges((current) =>
      current === null ? [next] : current.map((item) => (item.forge === next.forge ? next : item)),
    );

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
      {forges === null && error === null && (
        <div className="flex items-center gap-2 px-0.5 text-label text-fg-muted">
          <DotSpinner variant="loading" label="Loading Git accounts" />
          Checking gh and glab…
        </div>
      )}
      <div className="space-y-4">
        {forges?.map((status) => (
          <ForgeCard key={status.forge} status={status} onStatus={replace} />
        ))}
      </div>
    </section>
  );
}

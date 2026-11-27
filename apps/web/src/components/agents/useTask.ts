import { describeApiError } from "@scuttle/client-runtime";
import { useState } from "react";

export interface Task {
  readonly busy: string | null;
  readonly error: string | null;
  readonly run: (key: string, work: () => Promise<unknown>, fallback: string) => Promise<boolean>;
  readonly clearError: () => void;
}

export function useTask(): Task {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, work: () => Promise<unknown>, fallback: string) => {
    setBusy(key);
    setError(null);
    let ok = false;
    try {
      await work();
      ok = true;
    } catch (cause) {
      setError(describeApiError(cause, fallback));
    }
    setBusy((current) => (current === key ? null : current));
    return ok;
  };

  return { busy, error, run, clearError: () => setError(null) };
}

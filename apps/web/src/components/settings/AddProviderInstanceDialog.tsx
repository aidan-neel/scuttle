import { Dialog } from "@base-ui/react/dialog";
import { createScuttleApiClient, describeApiError } from "@scuttle/client-runtime";
import type { ProviderKind, ProviderSnapshot } from "@scuttle/contracts";
import { useRef, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import {
  DialogAlert,
  DialogCloseButton,
  DialogFooter,
  DialogSettingRow,
  DialogSettings,
  DialogShell,
} from "@/components/ui/DialogShell.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Picker, type PickerOption } from "@/components/ui/Picker.tsx";

const apiClient = createScuttleApiClient();

type AccountProviderKind = Exclude<ProviderKind, "acp-registry">;

const KIND_OPTIONS: ReadonlyArray<PickerOption<AccountProviderKind>> = [
  {
    value: "claude",
    label: "Claude Code",
    icon: <BrandLogo brand="claude" className="size-3.5" />,
  },
  { value: "codex", label: "Codex", icon: <BrandLogo brand="codex" className="size-3.5" /> },
  {
    value: "antigravity",
    label: "Antigravity",
    icon: <BrandLogo brand="antigravity" className="size-3.5" />,
  },
  {
    value: "opencode",
    label: "OpenCode",
    icon: <BrandLogo brand="opencode" className="size-3.5" />,
  },
  {
    value: "copilot",
    label: "GitHub Copilot",
    icon: <BrandLogo brand="copilot" className="size-3.5" />,
  },
];

export const parseEnvLines = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
};

export const formatEnvLines = (env: Readonly<Record<string, string>> | undefined): string =>
  env
    ? Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")
    : "";

interface AddProviderInstanceDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (snapshot: ProviderSnapshot) => void | Promise<void>;
}

export function AddProviderInstanceDialog({
  open,
  onOpenChange,
  onCreated,
}: AddProviderInstanceDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AccountProviderKind>("claude");
  const [name, setName] = useState("");
  const [homePath, setHomePath] = useState("");
  const [shadowHomePath, setShadowHomePath] = useState("");
  const [envText, setEnvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKind("claude");
    setName("");
    setHomePath("");
    setShadowHomePath("");
    setEnvText("");
    setSaving(false);
    setError(null);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    setSaving(true);
    setError(null);
    try {
      const env = parseEnvLines(envText);
      const snapshot = await apiClient.createProviderInstance({
        kind,
        name: trimmedName,
        ...(homePath.trim() ? { homePath: homePath.trim() } : {}),
        ...(shadowHomePath.trim() ? { shadowHomePath: shadowHomePath.trim() } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      });
      await onCreated(snapshot);
      onOpenChange(false);
    } catch (err) {
      setError(describeApiError(err, "Failed to create provider account."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      onExitComplete={reset}
      initialFocus={nameRef}
      className="top-[14vh] w-[min(30rem,calc(100vw-2rem))]"
    >
      <DialogCloseButton />
      <div className="px-5 pt-5 pb-3">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em] text-fg">
          Add isolated account
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-label text-fg-muted">
          Create an isolated shadow-home profile with separate credentials and environment.
        </Dialog.Description>
      </div>

      <DialogSettings>
        <DialogSettingRow label="Harness">
          <Picker
            label="Harness"
            value={kind}
            options={KIND_OPTIONS}
            onValueChange={setKind}
            variant="field"
          />
        </DialogSettingRow>

        <DialogSettingRow label="Display name">
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="e.g. Claude Work"
            className="h-8 w-56 rounded-control bg-chrome px-2.5 text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
          />
        </DialogSettingRow>

        <DialogSettingRow label="Home path">
          <input
            type="text"
            value={homePath}
            onChange={(e) => setHomePath(e.target.value)}
            placeholder="Optional (e.g. ~/.claude-work)"
            spellCheck={false}
            className="h-8 w-56 rounded-control bg-chrome px-2.5 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
          />
        </DialogSettingRow>

        <DialogSettingRow label="Shadow home">
          <input
            type="text"
            value={shadowHomePath}
            onChange={(e) => setShadowHomePath(e.target.value)}
            placeholder="Auto-isolated in Scuttle data dir"
            spellCheck={false}
            className="h-8 w-56 rounded-control bg-chrome px-2.5 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
          />
        </DialogSettingRow>

        <div className="relative flex flex-col gap-1.5 py-3 before:absolute before:top-0 before:right-1.5 before:left-0 before:h-px before:bg-dialog-line">
          <span className="text-label text-fg-muted">Environment variables (KEY=VALUE)</span>
          <textarea
            rows={3}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={"ANTHROPIC_BASE_URL=https://...\nCUSTOM_VAR=value"}
            spellCheck={false}
            className="w-full resize-none rounded-control bg-chrome p-2.5 font-mono text-meta text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
          />
        </div>
      </DialogSettings>

      <DialogFooter>
        <div className="min-w-0 flex-1">{error && <DialogAlert message={error} />}</div>
        <Button
          type="button"
          variant="ghost"
          size="dialog"
          disabled={saving}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="dialog"
          disabled={!name.trim() || saving}
          onClick={() => void submit()}
        >
          {saving && <DotSpinner variant="working" label="Creating" />}
          Create account
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

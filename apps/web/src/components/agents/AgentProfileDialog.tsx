import { Dialog } from "@base-ui/react/dialog";
import { Alert02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { Agent, ModelSelection, ThreadRuntime } from "@scuttle/contracts";
import { type ReactNode, useRef, useState } from "react";
import { RUNTIMES } from "@/components/home/ComposerContextBar.tsx";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { Picker } from "@/components/ui/Picker.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";

interface AgentProfileDialogProps {
  readonly agent: Agent | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function SettingRow({
  label,
  divider = true,
  children,
}: {
  readonly label: string;
  readonly divider?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={
        divider
          ? "flex min-h-12 items-center gap-3 border-b border-line px-1"
          : "flex min-h-12 items-center gap-3 px-1"
      }
    >
      <span className="w-24 shrink-0 text-body font-medium text-fg">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}

function ProfileForm({ agent, onClose }: { readonly agent: Agent; readonly onClose: () => void }) {
  const { providers, updateAgent } = useWorkspace();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(agent.name);
  const [runtime, setRuntime] = useState<ThreadRuntime>(agent.runtime);
  const [modelSelection, setModelSelection] = useState<ModelSelection>(agent.modelSelection);
  const [saving, setSaving] = useState(false);
  const [closingAfterSave, setClosingAfterSave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const dirty =
    (trimmedName.length > 0 && trimmedName !== agent.name) ||
    runtime !== agent.runtime ||
    modelSelection.providerId !== agent.modelSelection.providerId ||
    modelSelection.model !== agent.modelSelection.model ||
    modelSelection.effort !== agent.modelSelection.effort;

  const save = async () => {
    if (saving || closingAfterSave || trimmedName.length === 0) return;
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateAgent(agent.id, {
        name: trimmedName,
        runtime,
        modelSelection,
        modelStack: { ...agent.modelStack, agent: modelSelection },
      });
      setClosingAfterSave(true);
      onClose();
    } catch (cause) {
      setError(describeApiError(cause, "Could not update the agent."));
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="flex h-12 items-center gap-2 pr-3 pl-5">
        <Dialog.Title className="flex-1 text-title font-semibold text-fg">
          Agent Profile
        </Dialog.Title>
        <Dialog.Close
          aria-label="Close"
          render={<Button type="button" variant="ghost" size="icon-sm" />}
        >
          <Icon icon={Cancel01Icon} />
        </Dialog.Close>
      </header>

      <div className="flex flex-col items-center gap-3 px-6 pt-3 pb-5">
        <Identicon name={trimmedName || agent.name} size="xl" className="size-18 rounded-[14px]" />
        <input
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Agent"
          aria-label="Agent name"
          spellCheck={false}
          className="w-full bg-transparent text-center text-[23px] leading-tight font-medium tracking-tight text-fg caret-fg outline-none placeholder:text-fg-faint"
        />
      </div>

      <div className="flex flex-col px-5 pb-3">
        <SettingRow label="Project">
          <span
            className="flex min-w-0 items-center gap-1.5 text-label text-fg-secondary"
            title={agent.projectPath}
          >
            <Identicon name={agent.projectName} size="sm" className="size-3.5" />
            <span className="truncate">{agent.projectName}</span>
          </span>
        </SettingRow>
        <SettingRow label="Runtime">
          <Picker label="Runtime" value={runtime} options={RUNTIMES} onValueChange={setRuntime} />
        </SettingRow>
        <SettingRow label="Model" divider={false}>
          <ModelPicker
            providers={providers}
            selection={modelSelection}
            onChange={setModelSelection}
          />
        </SettingRow>
      </div>

      <div className="border-t border-line px-5 py-3">
        <p className="text-label leading-[1.5] text-fg-muted">
          {agent.purpose.trim().length > 0
            ? agent.purpose
            : `No purpose set yet. Tell ${agent.name} what it owns in chat.`}
        </p>
      </div>

      <footer className="flex h-14 items-center gap-2 border-t border-line bg-black/10 px-5">
        <div className="min-w-0 flex-1">
          {error !== null && (
            <p role="alert" className="flex items-center gap-1.5 text-label text-danger">
              <Icon icon={Alert02Icon} className="size-3.5 shrink-0" />
              <span className="truncate">{error}</span>
            </p>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={trimmedName.length === 0 || saving}
          className="min-w-[72px]"
        >
          {dirty || saving || closingAfterSave ? "Save" : "Done"}
        </Button>
      </footer>
    </form>
  );
}

export function AgentProfileDialog({ agent, open, onOpenChange }: AgentProfileDialogProps) {
  const isOpen = open && agent !== null;
  const [renderedAgent, setRenderedAgent] = useState<Agent | null>(agent);
  if (agent !== null && agent !== renderedAgent) {
    setRenderedAgent(agent);
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ease-out-quint data-ending-style:opacity-0 data-ending-style:duration-160 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-x-0 top-[15vh] z-50 mx-auto flex w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-canvas bg-menu shadow-menu outline-none transition-[opacity,scale,translate] duration-220 ease-out-quint data-ending-style:translate-y-1.5 data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-160 data-starting-style:translate-y-2 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
          {renderedAgent !== null && (
            <ProfileForm
              key={renderedAgent.id}
              agent={renderedAgent}
              onClose={() => onOpenChange(false)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

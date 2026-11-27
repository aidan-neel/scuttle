import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { Agent, IdenticonStyle, ModelSelection, ThreadRuntime } from "@scuttle/contracts";
import { DEFAULT_IDENTICON_STYLE } from "@scuttle/shared/identicon";
import type { AgentId } from "@scuttle/shared/ids";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { RUNTIMES } from "@/components/home/ComposerContextBar.tsx";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import {
  DialogAlert,
  DialogCloseButton,
  DialogFooter,
  DialogSettingRow,
  DialogSettings,
  DialogShell,
} from "@/components/ui/DialogShell.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon, identiconStyleOptions } from "@/components/ui/Identicon.tsx";
import { Picker, PillLabel, pillTriggerClass } from "@/components/ui/Picker.tsx";
import { spring } from "@/lib/motion.ts";
import { useWorkspace } from "@/lib/workspace.tsx";

interface AgentProfileDialogProps {
  readonly agent: Agent | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface ComposerHandoff {
  readonly agentId: AgentId;
  navigated: boolean;
  exited: boolean;
}

const sameModel = (a: ModelSelection, b: ModelSelection) =>
  a.providerId === b.providerId && a.model === b.model && a.effort === b.effort;

const changeLabel = (count: number) => `${count} unsaved change${count === 1 ? "" : "s"}`;

function ProfileForm({
  agent,
  onClose,
  onAskInChat,
}: {
  readonly agent: Agent;
  readonly onClose: () => void;
  readonly onAskInChat: () => void;
}) {
  const navigate = useNavigate();
  const still = useReducedMotion() === true;
  const { providers, modelTiers, updateAgent } = useWorkspace();
  const agentOverrideCount = Object.keys(modelTiers.agents[agent.id] ?? {}).length;
  const savedIdenticonStyle = agent.identiconStyle ?? DEFAULT_IDENTICON_STYLE;
  const [name, setName] = useState(agent.name);
  const [identiconStyle, setIdenticonStyle] = useState<IdenticonStyle>(savedIdenticonStyle);
  const [runtime, setRuntime] = useState<ThreadRuntime>(agent.runtime);
  const [modelSelection, setModelSelection] = useState<ModelSelection>(agent.modelSelection);
  const [saving, setSaving] = useState(false);
  const [closingAfterSave, setClosingAfterSave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const previewName = trimmedName || agent.name;
  const nameChanged = trimmedName !== agent.name;
  const styleChanged = identiconStyle !== savedIdenticonStyle;
  const runtimeChanged = runtime !== agent.runtime;
  const modelChanged = !sameModel(modelSelection, agent.modelSelection);
  const changeCount = [nameChanged, styleChanged, runtimeChanged, modelChanged].filter(
    Boolean,
  ).length;
  const dirty = changeCount > 0;
  const showFooter = dirty || saving || closingAfterSave || error !== null;

  const revert = () => {
    setName(agent.name);
    setIdenticonStyle(savedIdenticonStyle);
    setRuntime(agent.runtime);
    setModelSelection(agent.modelSelection);
    setError(null);
  };

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
        identiconStyle,
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

  const purpose = agent.purpose.trim();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Dialog.Title className="sr-only">Agent profile</Dialog.Title>
      <DialogCloseButton />

      <div className="flex flex-col items-center px-8 pt-11 pb-7">
        <Identicon
          name={previewName}
          style={identiconStyle}
          size="xl"
          className="size-16 rounded-dialog"
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={agent.name}
          aria-label="Agent name"
          spellCheck={false}
          className="mt-3.5 w-full rounded-control bg-transparent px-2 py-0.5 text-center text-[1.375rem] leading-7 font-semibold tracking-[-0.02em] text-fg caret-fg outline-none transition-colors duration-(--dur-hover) placeholder:text-fg-faint hover:bg-fg/3 focus-visible:bg-fg/4"
        />
        {purpose.length > 0 ? (
          <p
            title={purpose}
            className="line-clamp-3 max-w-[21.25rem] pt-1 text-center text-label text-fg-muted"
          >
            {purpose}
          </p>
        ) : (
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 pt-1 text-label text-fg-muted">
            No purpose yet.
            <button
              type="button"
              onClick={onAskInChat}
              className="rounded-chip text-fg-secondary underline decoration-white/22 underline-offset-3 outline-none transition-colors duration-(--dur-hover) hover:text-fg hover:decoration-white/45 focus-visible:shadow-focus"
            >
              Ask {agent.name} in chat
            </button>
          </p>
        )}
      </div>

      <DialogSettings className={showFooter ? "pb-1.5" : "pb-3"}>
        <DialogSettingRow label="Avatar" dirty={styleChanged}>
          <Picker
            label="Avatar style"
            value={identiconStyle}
            options={identiconStyleOptions(previewName)}
            onValueChange={setIdenticonStyle}
            variant="field"
          />
        </DialogSettingRow>
        <DialogSettingRow label="Project">
          <span
            className="flex h-7 min-w-0 items-center gap-[0.4375rem] px-2 text-label text-fg"
            title={agent.projectPath}
          >
            <Identicon name={agent.projectName} size="sm" className="size-3.5" />
            <span className="truncate">{agent.projectName}</span>
          </span>
        </DialogSettingRow>
        <DialogSettingRow label="Runtime" dirty={runtimeChanged}>
          <Picker
            label="Runtime"
            value={runtime}
            options={RUNTIMES}
            onValueChange={setRuntime}
            variant="field"
          />
        </DialogSettingRow>
        <DialogSettingRow label="Model" dirty={modelChanged}>
          <ModelPicker
            providers={providers}
            selection={modelSelection}
            onChange={setModelSelection}
            align="end"
            variant="field"
          />
        </DialogSettingRow>
        <DialogSettingRow label="Model stack">
          <button
            type="button"
            className={pillTriggerClass(undefined, "field")}
            onClick={() => {
              onClose();
              void navigate({
                to: "/settings/$section",
                params: { section: "stack" },
                search: { scope: "agent", agentId: agent.id },
              });
            }}
          >
            <PillLabel>
              {agentOverrideCount > 0
                ? `${agentOverrideCount} override${agentOverrideCount === 1 ? "" : "s"}`
                : `Inherits ${agent.projectName}`}
            </PillLabel>
            <Icon icon={ArrowRight01Icon} className="size-2.5 text-fg-faint" />
          </button>
        </DialogSettingRow>
      </DialogSettings>

      <AnimatePresence initial={false}>
        {showFooter && (
          <motion.div
            key="footer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={still ? { duration: 0 } : spring.snappy}
            className="overflow-hidden"
          >
            <DialogFooter>
              <div className="min-w-0 flex-1">
                {error !== null ? (
                  <DialogAlert message={error} />
                ) : (
                  changeCount > 0 && (
                    <span className="text-label text-fg-muted">{changeLabel(changeCount)}</span>
                  )
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="dialog"
                disabled={saving || closingAfterSave}
                onClick={revert}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="dialog"
                disabled={trimmedName.length === 0 || saving || closingAfterSave}
                className="px-3.5"
              >
                Save
              </Button>
            </DialogFooter>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}

export function AgentProfileDialog({ agent, open, onOpenChange }: AgentProfileDialogProps) {
  const navigate = useNavigate();
  const handoffRef = useRef<ComposerHandoff | null>(null);

  const focusComposerWhenReady = () => {
    const handoff = handoffRef.current;
    if (handoff === null || !handoff.navigated || !handoff.exited) return;
    handoffRef.current = null;
    requestAnimationFrame(() =>
      document.getElementById(`composer-agent-${handoff.agentId}`)?.focus(),
    );
  };

  const askInChat = (target: Agent) => {
    const handoff: ComposerHandoff = { agentId: target.id, navigated: false, exited: false };
    handoffRef.current = handoff;
    onOpenChange(false);
    void navigate({ to: "/agents/$agentId", params: { agentId: target.id } }).finally(() => {
      handoff.navigated = true;
      focusComposerWhenReady();
    });
  };

  return (
    <DialogShell
      open={open && agent !== null}
      onOpenChange={onOpenChange}
      onExitComplete={() => {
        if (handoffRef.current === null) return;
        handoffRef.current.exited = true;
        focusComposerWhenReady();
      }}
      finalFocus={() => handoffRef.current === null}
      className="top-[15vh] w-[min(28.25rem,calc(100vw-2rem))]"
    >
      {agent !== null && (
        <ProfileForm
          key={agent.id}
          agent={agent}
          onClose={() => onOpenChange(false)}
          onAskInChat={() => askInChat(agent)}
        />
      )}
    </DialogShell>
  );
}

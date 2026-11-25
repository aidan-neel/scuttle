import { Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Picker, type PickerOption } from "@/components/ui/Picker.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { usePrefersReducedMotion } from "@/lib/dither";
import { useWorkspace } from "@/lib/workspace.tsx";
import { modelDisplayName } from "./modelCatalog.ts";
import { type EnterBehavior, usePreferences, writePreference } from "./preferences.ts";
import { Kbd, SettingsGroup, SettingsRow } from "./primitives.tsx";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl";

const ENTER_OPTIONS: ReadonlyArray<PickerOption<EnterBehavior>> = [
  { value: "enter", label: "Enter sends" },
  { value: "mod-enter", label: `${MOD}+Enter sends` },
];

function DefaultModelRow() {
  const { providers, defaultModelSelection } = useWorkspace();
  const provider = providers.find((p) => p.id === defaultModelSelection.providerId);
  const model = provider?.models.find((m) => m.slug === defaultModelSelection.model);
  return (
    <SettingsRow
      title="Default model"
      description={
        provider === undefined ? (
          "Pick one under Models."
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <BrandLogo brand={provider.kind} className="size-3.5 shrink-0" />
            <span className="truncate">
              {provider.name} ·{" "}
              {model === undefined ? defaultModelSelection.model : modelDisplayName(model)}
            </span>
          </span>
        )
      }
      control={
        <Link
          to="/settings"
          search={{ section: "models" }}
          className={buttonClass("secondary", "md")}
        >
          Change
        </Link>
      }
    />
  );
}

export function GeneralSection() {
  const { enterBehavior } = usePreferences();
  return (
    <>
      <SettingsGroup title="Composer">
        <SettingsRow
          title="Enter behavior"
          description={
            enterBehavior === "enter"
              ? "Enter sends the message. Shift+Enter adds a new line."
              : `${MOD}+Enter sends the message. Enter adds a new line.`
          }
          control={
            <Picker
              label="Enter behavior"
              value={enterBehavior}
              options={ENTER_OPTIONS}
              onValueChange={(value) => writePreference("enterBehavior", value)}
            />
          }
        />
      </SettingsGroup>
      <SettingsGroup title="New threads">
        <DefaultModelRow />
      </SettingsGroup>
    </>
  );
}

export function AppearanceSection() {
  const { ditherBackground } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <>
      <SettingsGroup title="Background">
        <SettingsRow
          title="Horizon dither"
          description="The animated dither glow behind the home composer."
          control={
            <Switch
              checked={ditherBackground}
              aria-label="Horizon dither"
              onCheckedChange={(checked) => writePreference("ditherBackground", checked)}
            />
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Motion">
        <SettingsRow
          title="Reduced motion"
          description="Scuttle follows your system setting and shortens animations when it is on."
          control={
            <span className="text-label text-fg-secondary">
              {reducedMotion ? "On (system)" : "Off (system)"}
            </span>
          }
        />
      </SettingsGroup>
    </>
  );
}

interface Shortcut {
  readonly action: string;
  readonly keys: ReadonlyArray<string>;
}

function ShortcutGroup({
  title,
  shortcuts,
}: {
  readonly title: string;
  readonly shortcuts: ReadonlyArray<Shortcut>;
}) {
  return (
    <SettingsGroup title={title}>
      {shortcuts.map((shortcut) => (
        <div key={shortcut.action} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <span className="text-body text-fg">{shortcut.action}</span>
          <span className="flex shrink-0 items-center gap-1">
            {shortcut.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </div>
      ))}
    </SettingsGroup>
  );
}

export function ShortcutsSection() {
  const { enterBehavior } = usePreferences();
  const send = enterBehavior === "enter" ? ["Enter"] : [MOD, "Enter"];
  const newline = enterBehavior === "enter" ? ["Shift", "Enter"] : ["Enter"];
  return (
    <>
      <ShortcutGroup
        title="Anywhere"
        shortcuts={[{ action: "Search threads and projects", keys: [MOD, "K"] }]}
      />
      <ShortcutGroup
        title="Composer"
        shortcuts={[
          { action: "Send message", keys: send },
          { action: "New line", keys: newline },
          { action: "Stop the running agent", keys: ["Esc"] },
        ]}
      />
      <ShortcutGroup
        title="Reasoning effort"
        shortcuts={[
          { action: "Lower or raise effort", keys: ["←", "→"] },
          { action: "Lowest or highest effort", keys: ["Home", "End"] },
        ]}
      />
      <ShortcutGroup
        title="Settings"
        shortcuts={[
          { action: "Open the first matching section", keys: ["Enter"] },
          { action: "Clear the search", keys: ["Esc"] },
        ]}
      />
    </>
  );
}

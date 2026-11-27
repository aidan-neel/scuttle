import { Tick02Icon } from "@hugeicons/core-free-icons";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Picker, type PickerOption } from "@/components/ui/Picker.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { usePrefersReducedMotion } from "@/lib/dither";
import { THEMES, type ThemeDefinition } from "@/lib/themes.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import {
  type ActiveTurnDispatch,
  type EnterBehavior,
  usePreferences,
  writePreference,
} from "./preferences.ts";
import { Kbd, SettingsGroup, SettingsRow } from "./primitives.tsx";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl";

const ENTER_OPTIONS: ReadonlyArray<PickerOption<EnterBehavior>> = [
  { value: "enter", label: "Enter sends" },
  { value: "mod-enter", label: `${MOD}+Enter sends` },
];

const ACTIVE_DISPATCH_OPTIONS: ReadonlyArray<PickerOption<ActiveTurnDispatch>> = [
  { value: "steer", label: "Steer" },
  { value: "queue", label: "Queue" },
];

function DefaultModelRow() {
  const { providers, defaultModelSelection, setDefaultModelSelection } = useWorkspace();
  return (
    <SettingsRow
      title="Default model"
      description="The model new threads and agents start with."
      control={
        <ModelPicker
          providers={providers}
          selection={defaultModelSelection}
          onChange={setDefaultModelSelection}
          variant="field"
          side="bottom"
          align="end"
        />
      }
    />
  );
}

export function GeneralSection() {
  const { enterBehavior, activeTurnDispatch } = usePreferences();
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
        <SettingsRow
          title="While a turn is running"
          description={
            activeTurnDispatch === "steer"
              ? "Sending steers the active turn immediately. Alt+Enter queues it instead."
              : "Sending queues the message for after the active turn. Alt+Enter steers instead."
          }
          control={
            <Picker
              label="While a turn is running"
              value={activeTurnDispatch}
              options={ACTIVE_DISPATCH_OPTIONS}
              onValueChange={(value) => writePreference("activeTurnDispatch", value)}
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

function ThemeCard({
  theme,
  active,
  onSelect,
}: {
  readonly theme: ThemeDefinition;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const { swatch } = theme;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 rounded-row p-2 text-left outline-none transition-[background-color,box-shadow] duration-(--dur-hover) ease-hover focus-visible:shadow-focus",
        active
          ? "bg-fg/[0.05] shadow-[inset_0_0_0_1.5px_var(--color-primary)]"
          : "bg-transparent shadow-[inset_0_0_0_1px_var(--color-edge)] hover:bg-fg/[0.03] hover:shadow-[inset_0_0_0_1px_var(--color-edge-strong)]",
      )}
    >
      <div
        aria-hidden="true"
        className="flex h-16 w-full overflow-hidden rounded-chip border"
        style={{ backgroundColor: swatch.canvas, borderColor: swatch.line }}
      >
        <div
          className="flex w-[30%] flex-col gap-1.5 border-r p-2"
          style={{ backgroundColor: swatch.sidebar, borderColor: swatch.line }}
        >
          <span
            className="h-1.5 w-7 rounded-full opacity-80"
            style={{ backgroundColor: swatch.fg }}
          />
          <span
            className="mt-0.5 h-1 w-9 rounded-full opacity-35"
            style={{ backgroundColor: swatch.fgMuted }}
          />
          <span
            className="h-1 w-6 rounded-full opacity-25"
            style={{ backgroundColor: swatch.fgMuted }}
          />
        </div>
        <div className="flex flex-1 flex-col justify-between p-2">
          <div className="space-y-1">
            <span
              className="block h-1.5 w-14 rounded-full opacity-80"
              style={{ backgroundColor: swatch.fg }}
            />
            <span
              className="block h-1 w-10 rounded-full opacity-35"
              style={{ backgroundColor: swatch.fgMuted }}
            />
          </div>
          <div
            className="flex items-center justify-between rounded-[4px] border px-1.5 py-1"
            style={{ backgroundColor: swatch.panel, borderColor: swatch.line }}
          >
            <span
              className="h-1 w-8 rounded-full opacity-35"
              style={{ backgroundColor: swatch.fgMuted }}
            />
            <span className="size-2.5 rounded-full" style={{ backgroundColor: swatch.primary }} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <div className="truncate text-label font-medium text-fg">{theme.name}</div>
          <div className="truncate text-meta text-fg-muted">{theme.description}</div>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-full transition-[opacity,transform] duration-150 ease-out-quint",
            active
              ? "scale-100 bg-primary text-on-primary opacity-100"
              : "scale-75 bg-fg/8 text-transparent opacity-0",
          )}
        >
          <Icon icon={Tick02Icon} className="size-2.5" />
        </span>
      </div>
    </button>
  );
}

export function AppearanceSection() {
  const { theme, ditherBackground } = usePreferences();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <>
      <SettingsGroup title="Theme">
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3"
        >
          {THEMES.map((entry) => (
            <ThemeCard
              key={entry.id}
              theme={entry}
              active={entry.id === theme}
              onSelect={() => writePreference("theme", entry.id)}
            />
          ))}
        </div>
      </SettingsGroup>
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
  const { enterBehavior, activeTurnDispatch } = usePreferences();
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
          {
            action:
              activeTurnDispatch === "steer"
                ? "Queue message while running"
                : "Steer turn while running",
            keys: ["Alt", "Enter"],
          },
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

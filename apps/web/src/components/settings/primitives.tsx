import { Search01Icon } from "@hugeicons/core-free-icons";
import type { ProviderSnapshot } from "@scuttle/contracts";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";

export function SettingsHeader({ title }: { readonly title: string }) {
  return (
    <header className="pb-1">
      <h1 className="text-[20px] leading-7 font-semibold tracking-tight text-fg">{title}</h1>
    </header>
  );
}

export function SettingsGroup({
  title,
  action,
  children,
  className,
}: {
  readonly title?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className="space-y-2">
      {(title !== undefined || action !== undefined) && (
        <div className="flex min-h-6 items-center justify-between gap-2 px-0.5">
          {title !== undefined && (
            <h2 className="text-label font-medium text-fg-secondary">{title}</h2>
          )}
          {action}
        </div>
      )}
      <div
        className={cn(
          "divide-y divide-line overflow-hidden rounded-card bg-panel shadow-raised",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  control,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly control?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-body text-fg">{title}</div>
        {description !== undefined && (
          <div className="mt-0.5 text-label text-fg-muted">{description}</div>
        )}
      </div>
      {control !== undefined && <div className="shrink-0">{control}</div>}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  label,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly label: string;
}) {
  return (
    <input
      type="text"
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className="h-8 w-full rounded-control bg-chrome px-2.5 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus sm:w-60"
    />
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  onEnter,
  className,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly onEnter?: () => void;
  readonly className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-8 items-center gap-2 rounded-control bg-chrome px-2.5 shadow-raised focus-within:shadow-focus",
        className,
      )}
    >
      <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value.length > 0) {
            event.preventDefault();
            onChange("");
          } else if (event.key === "Enter" && onEnter !== undefined) {
            event.preventDefault();
            onEnter();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

export function StatusDot({
  status,
  className,
}: {
  readonly status: ProviderSnapshot["status"];
  readonly className?: string;
}) {
  return <span className={cn("shrink-0 rounded-full", STATUS_DOT[status], className)} />;
}

const STATUS_DOT: Record<ProviderSnapshot["status"], string> = {
  ready: "bg-success",
  unauthenticated: "bg-warning",
  unavailable: "bg-danger",
  probing: "bg-input",
  disabled: "bg-fg-faint",
};

export function providerSummary(provider: ProviderSnapshot): string {
  switch (provider.status) {
    case "ready":
      return `Ready · ${provider.models.length} model${provider.models.length === 1 ? "" : "s"}`;
    case "probing":
      return "Checking availability…";
    case "unauthenticated":
      return "Sign in required";
    case "unavailable":
      return "CLI not installed";
    case "disabled":
      return "Disabled";
  }
}

export function Kbd({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-chip bg-white/6 px-1.5 font-mono text-meta text-fg-secondary shadow-[inset_0_0_0_1px_var(--color-edge)]">
      {children}
    </kbd>
  );
}

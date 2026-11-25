import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

interface SwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly "aria-label": string;
  readonly className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  "aria-label": ariaLabel,
  className,
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled ?? false}
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 outline-none transition-colors duration-150 ease-out",
        "bg-white/14 shadow-[inset_0_0_0_1px_var(--color-edge)] data-checked:bg-primary data-checked:shadow-none",
        "focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      <BaseSwitch.Thumb className="block size-4 rounded-full bg-fg shadow-[0_1px_2px_rgb(0_0_0/40%)] transition-transform duration-150 ease-out data-checked:translate-x-4" />
    </BaseSwitch.Root>
  );
}

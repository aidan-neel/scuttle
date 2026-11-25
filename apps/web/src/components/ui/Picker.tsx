import { Menu } from "@base-ui/react/menu";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon.tsx";
import { MENU_ITEM_CLASS, MenuPopup, MenuRadioItem, MenuSeparator } from "./Menu.tsx";

export interface PickerOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon?: ReactNode;
}

export interface PickerAction {
  readonly label: string;
  readonly icon: IconSvgElement;
  readonly onSelect: () => void;
}

export type PickerVariant = "ghost" | "pill";

export const pillTriggerClass = (className?: string, variant: PickerVariant = "pill") =>
  cn(
    "group/pill inline-flex min-w-0 shrink-0 cursor-default items-center whitespace-nowrap select-none outline-none",
    "transition-[background-color,color,box-shadow] duration-(--dur-hover) ease-hover",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    variant === "ghost"
      ? [
          "h-6 gap-1 rounded-chip px-1.5 text-label text-fg-muted",
          "hover:bg-(--wash) hover:text-fg active:bg-hover active:duration-(--dur-tap)",
          "data-popup-open:bg-(--wash) data-popup-open:text-fg",
          "focus-visible:shadow-focus",
          "[&_svg:not([class*=size-])]:size-3",
        ]
      : [
          "h-6.5 gap-1.5 rounded-control pr-1.5 pl-2 text-label text-fg-secondary",
          "bg-panel/70 shadow-[inset_0_0_0_1px_var(--color-edge)] backdrop-blur-xs",
          "hover:bg-raised hover:text-fg active:bg-hover active:duration-(--dur-tap)",
          "data-popup-open:bg-raised data-popup-open:text-fg data-popup-open:shadow-[inset_0_0_0_1px_var(--color-edge-strong)]",
          "focus-visible:shadow-[var(--shadow-focus),inset_0_0_0_1px_var(--color-edge-strong)]",
          "[&_svg:not([class*=size-])]:size-3.5",
        ],
    className,
  );

export function PillLabel({ children, mono }: { children: string; mono?: boolean }) {
  return (
    <span title={children} className={cn("min-w-0 truncate leading-[18px]", mono && "font-mono")}>
      {children}
    </span>
  );
}

export function PillChevron() {
  return (
    <Icon
      icon={ArrowDown01Icon}
      className="size-2.5 text-fg-faint transition-[rotate,color] duration-150 ease-out group-hover/pill:text-fg-muted group-data-popup-open/pill:rotate-180 group-data-popup-open/pill:text-fg-muted"
    />
  );
}

interface PickerProps<Value extends string> {
  label: string;
  value: Value;
  options: ReadonlyArray<PickerOption<Value>>;
  onValueChange: (value: Value) => void;
  icon?: ReactNode;
  action?: PickerAction;
  variant?: PickerVariant;
  side?: "top" | "bottom";
  disabled?: boolean;
  className?: string;
}

export function Picker<Value extends string>({
  label,
  value,
  options,
  onValueChange,
  icon,
  action,
  variant = "pill",
  side = "bottom",
  disabled = false,
  className,
}: PickerProps<Value>) {
  const current = options.find((option) => option.value === value);

  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        aria-label={`${label}: ${current?.label ?? ""}`}
        className={pillTriggerClass(className, variant)}
      >
        {icon ?? current?.icon}
        {current && <PillLabel>{current.label}</PillLabel>}
        <PillChevron />
      </Menu.Trigger>
      <MenuPopup label={label} side={side} className="max-w-72">
        <Menu.RadioGroup
          value={value}
          onValueChange={(next: unknown) => {
            const picked = options.find((option) => option.value === next);
            if (picked !== undefined) onValueChange(picked.value);
          }}
        >
          {options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.icon}
              <span className="min-w-0 truncate leading-[18px]">{option.label}</span>
            </MenuRadioItem>
          ))}
        </Menu.RadioGroup>
        {action && (
          <>
            <MenuSeparator />
            <Menu.Item className={MENU_ITEM_CLASS} onClick={action.onSelect}>
              <Icon icon={action.icon} className="size-3.5 text-fg-muted" />
              {action.label}
            </Menu.Item>
          </>
        )}
      </MenuPopup>
    </Menu.Root>
  );
}

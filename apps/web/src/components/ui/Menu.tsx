import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon.tsx";

const POPUP_CLASS =
  "min-w-42 origin-(--transform-origin) rounded-card bg-menu p-1 shadow-menu outline-none transition-[opacity,scale,translate] duration-180 ease-out-quint data-ending-style:translate-y-0 data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-110 data-starting-style:-translate-y-1 data-starting-style:scale-97 data-starting-style:opacity-0";

export const MENU_ITEM_CLASS =
  "flex h-7 cursor-default items-center gap-2 rounded-chip px-2 text-label text-fg-secondary outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-(--wash) data-highlighted:text-fg [&_svg:not([class*=size-])]:size-3.5";

export const MENU_ITEM_DANGER_CLASS =
  "flex h-7 cursor-default items-center gap-2 rounded-chip px-2 text-label text-danger/90 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-danger/12 data-highlighted:text-danger [&_svg:not([class*=size-])]:size-3.5";

export function MenuPopup({
  children,
  label,
  align = "start",
  className,
}: {
  children: ReactNode;
  label: string;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={4} align={align} className="z-50 outline-none">
        <Menu.Popup aria-label={label} className={cn(POPUP_CLASS, className)}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <Menu.GroupLabel className="px-2 pt-1 pb-0.5 text-meta font-medium text-fg-muted">
      {children}
    </Menu.GroupLabel>
  );
}

export function MenuSeparator() {
  return <Menu.Separator className="mx-1 my-1 h-px bg-edge" />;
}

interface MenuRadioItemProps {
  value: string;
  children: ReactNode;
}

export function MenuRadioItem({ value, children }: MenuRadioItemProps) {
  return (
    <Menu.RadioItem
      value={value}
      closeOnClick
      className={cn(MENU_ITEM_CLASS, "data-checked:text-fg")}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      <Menu.RadioItemIndicator
        keepMounted
        className="text-fg transition-[opacity,scale] duration-150 ease-out-quint data-unchecked:scale-75 data-unchecked:opacity-0"
      >
        <Icon icon={Tick02Icon} className="size-3.5" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}

export function ContextMenuPopup({
  children,
  label,
  className,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner sideOffset={2} className="z-50 outline-none">
        <ContextMenu.Popup aria-label={label} className={cn(POPUP_CLASS, className)}>
          {children}
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}

export function ContextMenuItem({
  children,
  danger = false,
  disabled,
  onClick,
}: {
  readonly children: ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <ContextMenu.Item
      disabled={disabled}
      onClick={onClick}
      className={danger ? MENU_ITEM_DANGER_CLASS : MENU_ITEM_CLASS}
    >
      {children}
    </ContextMenu.Item>
  );
}

export function ContextMenuSeparator() {
  return <ContextMenu.Separator className="mx-1 my-1 h-px bg-edge" />;
}

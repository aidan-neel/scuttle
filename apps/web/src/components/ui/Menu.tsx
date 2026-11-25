import { Menu } from "@base-ui/react/menu";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon.tsx";

export function MenuPopup({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={6} align="start" className="z-50 outline-none">
        <Menu.Popup
          aria-label={label}
          className={cn(
            "min-w-48 origin-(--transform-origin) rounded-card bg-menu p-1 shadow-menu outline-none transition-[opacity,scale,translate] duration-200 ease-out-quint data-ending-style:translate-y-0 data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-120 data-starting-style:-translate-y-1 data-starting-style:scale-96 data-starting-style:opacity-0",
            className,
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <Menu.GroupLabel className="px-2 pt-1.5 pb-1 text-meta font-medium text-fg-muted">
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
      className="flex h-8 cursor-default items-center gap-2 rounded-chip px-2 text-button text-fg-secondary outline-none select-none data-checked:text-fg data-highlighted:bg-(--wash) data-highlighted:text-fg [&_svg:not([class*=size-])]:size-4"
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

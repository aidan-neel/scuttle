import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "quiet" | "destructive";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const BASE = [
  "relative inline-flex shrink-0 cursor-default items-center justify-center whitespace-nowrap select-none outline-none",
  "text-button leading-none font-normal",
  "shadow-(--button-shadow) focus-visible:shadow-[var(--shadow-focus),var(--button-shadow)]",
  "transition-[background-color,color,box-shadow,--button-top,--button-bottom] duration-(--dur-hover) ease-hover",
  "active:duration-(--dur-tap) active:ease-out",
  "disabled:pointer-events-none disabled:opacity-40 data-disabled:pointer-events-none data-disabled:opacity-40",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0",
].join(" ");

const FILL = "[background:linear-gradient(180deg,var(--button-top),var(--button-bottom))]";
const WASH = "hover:bg-(--wash) active:bg-(--wash-strong)";
const FLAT = "[--button-shadow:0_0_transparent]";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: [
    FILL,
    "font-medium text-on-primary [--button-shadow:var(--shadow-primary)]",
    "[--button-top:var(--fill-primary-top)] [--button-bottom:var(--fill-primary-bottom)]",
    "hover:[--button-top:var(--fill-primary-hover-top)] hover:[--button-bottom:var(--fill-primary-hover-bottom)]",
    "active:[--button-top:var(--fill-primary-press-top)] active:[--button-bottom:var(--fill-primary-press-bottom)]",
  ].join(" "),
  secondary: [
    FILL,
    "text-fg [--button-shadow:var(--shadow-raised)]",
    "[--button-top:var(--fill-raised-top)] [--button-bottom:var(--fill-raised-bottom)]",
    "hover:[--button-top:var(--fill-raised-hover-top)] hover:[--button-bottom:var(--fill-raised-hover-bottom)]",
    "active:[--button-top:var(--fill-raised-press-top)] active:[--button-bottom:var(--fill-raised-press-bottom)]",
  ].join(" "),
  outline: `bg-transparent text-fg ${WASH} [--button-shadow:inset_0_0_0_1px_var(--color-edge)] hover:[--button-shadow:inset_0_0_0_1px_var(--color-edge-strong)]`,
  ghost: `bg-transparent text-fg-secondary hover:text-fg ${FLAT} ${WASH}`,
  quiet: `bg-transparent text-fg ${FLAT} ${WASH}`,
  destructive: `bg-danger/14 text-danger ${FLAT} hover:bg-danger/20 active:bg-danger/24`,
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-6 gap-1 rounded-chip px-[7px] text-label [&_svg:not([class*=size-])]:size-[13px]",
  md: "h-7 gap-1.5 rounded-control px-[9px] [&_svg:not([class*=size-])]:size-3.5",
  lg: "h-8 gap-2 rounded-control px-[11px] text-body [&_svg:not([class*=size-])]:size-4",
  icon: "size-7 rounded-control [&_svg:not([class*=size-])]:size-4",
  "icon-sm": "size-[22px] rounded-chip [&_svg:not([class*=size-])]:size-3.5",
};

export const buttonClass = (
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
) => cn(BASE, VARIANTS[variant], SIZES[size], className);

type ButtonProps = ComponentProps<typeof BaseButton> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string | undefined;
};

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <BaseButton
      data-variant={variant}
      className={buttonClass(variant, size, className)}
      {...props}
    />
  );
}

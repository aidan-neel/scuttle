import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

interface IconProps {
  icon: IconSvgElement;
  className?: string;
  label?: string;
  strokeWidth?: number;
}

const DEFAULT_STROKE_WIDTH = 1.85;

export function Icon({ icon, className, label, strokeWidth = DEFAULT_STROKE_WIDTH }: IconProps) {
  return label === undefined ? (
    <HugeiconsIcon icon={icon} strokeWidth={strokeWidth} className={className} aria-hidden />
  ) : (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={strokeWidth}
      className={className}
      role="img"
      aria-label={label}
    />
  );
}

import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

interface IconProps {
  icon: IconSvgElement;
  className?: string;
  label?: string;
}

export function Icon({ icon, className, label }: IconProps) {
  return label === undefined ? (
    <HugeiconsIcon icon={icon} strokeWidth={1.5} className={className} aria-hidden />
  ) : (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={1.5}
      className={className}
      role="img"
      aria-label={label}
    />
  );
}

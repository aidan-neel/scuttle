import { Menu } from "@base-ui/react/menu";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { buttonClass } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { MenuPopup, MenuRadioItem } from "./Menu.tsx";
import { MorphWidth } from "./MorphWidth.tsx";
import { SwapText } from "./SwapText.tsx";

export interface PickerOption<Value extends string> {
  readonly value: Value;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
}

interface PickerProps<Value extends string> {
  label: string;
  value: Value;
  options: ReadonlyArray<PickerOption<Value>>;
  onValueChange: (value: Value) => void;
  icon?: ReactNode;
}

export function Picker<Value extends string>({
  label,
  value,
  options,
  onValueChange,
  icon,
}: PickerProps<Value>) {
  const current = options.find((option) => option.value === value);

  return (
    <Menu.Root>
      <Menu.Trigger
        className={buttonClass(
          "quiet",
          "md",
          "group/picker data-popup-open:bg-(--wash) [&_svg:not([class*=size-])]:size-4",
        )}
      >
        {icon ?? current?.icon}
        <span className="sr-only">{label}: </span>
        <MorphWidth>
          <SwapText swapKey={value} className="gap-1.5">
            {current?.label}
          </SwapText>
        </MorphWidth>
        <Icon
          icon={ArrowDown01Icon}
          className="size-3 text-fg-muted transition-transform duration-200 ease-out-quint group-data-popup-open/picker:rotate-180"
        />
      </Menu.Trigger>
      <MenuPopup label={label}>
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
              {option.label}
            </MenuRadioItem>
          ))}
        </Menu.RadioGroup>
      </MenuPopup>
    </Menu.Root>
  );
}

import { Menu } from "@base-ui/react/menu";
import { Add01Icon, MoreHorizontalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button, buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import {
  MENU_ITEM_CLASS,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioItem,
  MenuSeparator,
} from "@/components/ui/Menu.tsx";

export type SectionMenuEntry =
  | {
      readonly kind: "action";
      readonly label: string;
      readonly onSelect: () => void;
      readonly disabled?: boolean;
    }
  | {
      readonly kind: "toggle";
      readonly label: string;
      readonly checked: boolean;
      readonly disabled?: boolean;
      readonly onCheckedChange: (checked: boolean) => void;
    }
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly value: string;
      readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
      readonly onValueChange: (value: string) => void;
    }
  | { readonly kind: "separator" };

const ITEM_CLASS = MENU_ITEM_CLASS;

function MenuEntry({ entry }: { readonly entry: SectionMenuEntry }) {
  switch (entry.kind) {
    case "action":
      return (
        <Menu.Item className={ITEM_CLASS} disabled={entry.disabled} onClick={entry.onSelect}>
          {entry.label}
        </Menu.Item>
      );
    case "toggle":
      return (
        <Menu.CheckboxItem
          className={ITEM_CLASS}
          checked={entry.checked}
          disabled={entry.disabled}
          onCheckedChange={entry.onCheckedChange}
        >
          <span className="min-w-0 flex-1">{entry.label}</span>
          <Menu.CheckboxItemIndicator className="text-fg">
            <Icon icon={Tick02Icon} className="size-3.5" />
          </Menu.CheckboxItemIndicator>
        </Menu.CheckboxItem>
      );
    case "choice":
      return (
        <Menu.Group>
          <MenuGroupLabel>{entry.label}</MenuGroupLabel>
          <Menu.RadioGroup
            value={entry.value}
            onValueChange={(next: unknown) => {
              const picked = entry.options.find((option) => option.value === next);
              if (picked !== undefined) entry.onValueChange(picked.value);
            }}
          >
            {entry.options.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </MenuRadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Group>
      );
    case "separator":
      return <MenuSeparator />;
  }
}

interface SectionHeaderProps {
  id: string;
  title: string;
  addLabel: string;
  onAdd?: () => void;
  menu?: ReadonlyArray<SectionMenuEntry>;
}

export function SectionHeader({ id, title, addLabel, onAdd, menu }: SectionHeaderProps) {
  return (
    <div className="group/header flex h-8 items-center gap-0.5 pr-1 pl-2">
      <h2 id={id} className="flex-1 text-button font-medium text-fg-secondary">
        {title}
      </h2>
      <Button variant="ghost" size="icon-sm" aria-label={addLabel} onClick={onAdd}>
        <Icon icon={Add01Icon} />
      </Button>
      {menu !== undefined && (
        <Menu.Root>
          <Menu.Trigger
            aria-label={`${title} options`}
            className={buttonClass("ghost", "icon-sm", "data-popup-open:bg-(--wash)")}
          >
            <Icon icon={MoreHorizontalIcon} />
          </Menu.Trigger>
          <MenuPopup label={`${title} options`}>
            {menu.map((entry, index) => (
              <MenuEntry key={`${entry.kind}-${index}`} entry={entry} />
            ))}
          </MenuPopup>
        </Menu.Root>
      )}
    </div>
  );
}

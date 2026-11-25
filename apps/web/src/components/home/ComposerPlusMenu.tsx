import { Menu } from "@base-ui/react/menu";
import {
  Attachment01Icon,
  BubbleChatIcon,
  Folder01Icon,
  PlusSignIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { RefObject } from "react";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { MENU_ITEM_CLASS, MenuSeparator } from "@/components/ui/Menu.tsx";
import type { MentionCategory } from "./useComposerPalette.ts";

export const ATTACH_SHORTCUT_LABEL = "Ctrl+/";

interface ComposerPlusMenuProps {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly filesAvailable: boolean;
  readonly onUpload: () => void;
  readonly onMention: (category: MentionCategory) => void;
}

const CATEGORIES: ReadonlyArray<{
  readonly category: MentionCategory;
  readonly label: string;
  readonly icon: IconSvgElement;
}> = [
  { category: "agents", label: "Agents", icon: UserGroupIcon },
  { category: "threads", label: "Threads", icon: BubbleChatIcon },
  { category: "files", label: "Files", icon: Folder01Icon },
];

export function ComposerPlusMenu({
  textareaRef,
  filesAvailable,
  onUpload,
  onMention,
}: ComposerPlusMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Add context"
        className={buttonClass(
          "ghost",
          "icon",
          "data-popup-open:bg-(--wash) data-popup-open:text-fg",
        )}
      >
        <Icon icon={PlusSignIcon} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50 outline-none">
          <Menu.Popup
            aria-label="Add context"
            finalFocus={textareaRef}
            className="min-w-56 origin-(--transform-origin) rounded-card bg-menu p-1 shadow-menu outline-none transition-[opacity,scale,translate] duration-180 ease-out-quint data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-110 data-starting-style:translate-y-1 data-starting-style:scale-97 data-starting-style:opacity-0"
          >
            <Menu.Item onClick={onUpload} className={MENU_ITEM_CLASS}>
              <Icon icon={Attachment01Icon} className="text-fg-muted" />
              <span className="flex-1">Upload attachment</span>
              <span className="font-mono text-meta text-fg-faint">{ATTACH_SHORTCUT_LABEL}</span>
            </Menu.Item>
            <MenuSeparator />
            {CATEGORIES.map(({ category, label, icon }) => (
              <Menu.Item
                key={category}
                disabled={category === "files" && !filesAvailable}
                onClick={() => onMention(category)}
                className={MENU_ITEM_CLASS}
              >
                <Icon icon={icon} className="text-fg-muted" />
                {label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

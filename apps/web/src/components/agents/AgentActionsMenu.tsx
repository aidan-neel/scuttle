import { Menu } from "@base-ui/react/menu";
import {
  Copy01Icon,
  Delete02Icon,
  FilterIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { Agent } from "@scuttle/contracts";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import {
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  MENU_ITEM_CLASS,
  MENU_ITEM_DANGER_CLASS,
  MenuPopup,
  MenuSeparator,
} from "@/components/ui/Menu.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";

export interface AgentMenuHandlers {
  readonly onOpenProfile: () => void;
  readonly onRequestRemove: () => void;
  readonly isFiltered?: boolean;
  readonly onToggleFilter?: () => void;
}

type ActionEntry =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      readonly icon: IconSvgElement;
      readonly danger?: boolean;
      readonly onSelect: () => void;
    }
  | { readonly kind: "separator"; readonly id: string };

const buildAgentMenuEntries = (
  agent: Agent,
  togglePin: () => void,
  handlers: AgentMenuHandlers,
): ReadonlyArray<ActionEntry> => [
  {
    kind: "item",
    id: "pin",
    label: agent.pinned ? "Unpin" : "Pin",
    icon: agent.pinned ? PinOffIcon : PinIcon,
    onSelect: togglePin,
  },
  {
    kind: "item",
    id: "profile",
    label: "Profile",
    icon: UserCircleIcon,
    onSelect: handlers.onOpenProfile,
  },
  ...(handlers.onToggleFilter !== undefined
    ? [
        {
          kind: "item" as const,
          id: "filter",
          label: handlers.isFiltered ? "Clear thread filter" : "Filter threads",
          icon: FilterIcon,
          onSelect: handlers.onToggleFilter,
        },
      ]
    : []),
  {
    kind: "item",
    id: "copy-path",
    label: "Copy path",
    icon: Copy01Icon,
    onSelect: () => {
      void navigator.clipboard?.writeText(agent.projectPath);
    },
  },
  { kind: "separator", id: "sep-danger" },
  {
    kind: "item",
    id: "remove",
    label: "Remove agent",
    icon: Delete02Icon,
    danger: true,
    onSelect: handlers.onRequestRemove,
  },
];

export function AgentContextMenuContent({
  agent,
  handlers,
}: {
  readonly agent: Agent;
  readonly handlers: AgentMenuHandlers;
}) {
  const { updateAgent } = useWorkspace();
  const entries = buildAgentMenuEntries(
    agent,
    () => void updateAgent(agent.id, { pinned: !agent.pinned }),
    handlers,
  );

  return (
    <ContextMenuPopup label={`${agent.name} actions`}>
      {entries.map((entry) =>
        entry.kind === "separator" ? (
          <ContextMenuSeparator key={entry.id} />
        ) : (
          <ContextMenuItem key={entry.id} danger={entry.danger === true} onClick={entry.onSelect}>
            <Icon icon={entry.icon} className={entry.danger ? "" : "text-fg-muted"} />
            {entry.label}
          </ContextMenuItem>
        ),
      )}
    </ContextMenuPopup>
  );
}

export function AgentHeaderMenu({
  agent,
  handlers,
}: {
  readonly agent: Agent;
  readonly handlers: AgentMenuHandlers;
}) {
  const { updateAgent } = useWorkspace();
  const entries = buildAgentMenuEntries(
    agent,
    () => void updateAgent(agent.id, { pinned: !agent.pinned }),
    handlers,
  );

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${agent.name} options`}
        className={buttonClass(
          "ghost",
          "icon",
          "data-popup-open:bg-(--wash) data-popup-open:text-fg",
        )}
      >
        <Icon icon={MoreHorizontalIcon} />
      </Menu.Trigger>
      <MenuPopup label={`${agent.name} actions`} align="end">
        {entries.map((entry) =>
          entry.kind === "separator" ? (
            <MenuSeparator key={entry.id} />
          ) : (
            <Menu.Item
              key={entry.id}
              onClick={entry.onSelect}
              className={entry.danger ? MENU_ITEM_DANGER_CLASS : MENU_ITEM_CLASS}
            >
              <Icon icon={entry.icon} className={entry.danger ? "" : "text-fg-muted"} />
              {entry.label}
            </Menu.Item>
          ),
        )}
      </MenuPopup>
    </Menu.Root>
  );
}

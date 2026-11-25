import {
  AiBrain01Icon,
  ComputerIcon,
  Folder01Icon,
  KeyboardIcon,
  PaintBoardIcon,
  PlugSocketIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export const SECTION_IDS = [
  "general",
  "appearance",
  "shortcuts",
  "providers",
  "models",
  "projects",
  "environment",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionEntry {
  readonly id: SectionId;
  readonly label: string;
  readonly description: string;
  readonly icon: IconSvgElement;
  readonly keywords: ReadonlyArray<string>;
}

export interface SectionGroup {
  readonly label: string;
  readonly sections: ReadonlyArray<SectionEntry>;
}

export const SETTINGS_GROUPS: ReadonlyArray<SectionGroup> = [
  {
    label: "Workspace",
    sections: [
      {
        id: "general",
        label: "General",
        description: "How the composer behaves and which model new threads start with.",
        icon: Settings02Icon,
        keywords: ["enter", "send", "newline", "composer", "default model"],
      },
      {
        id: "appearance",
        label: "Appearance",
        description: "Background effects and motion.",
        icon: PaintBoardIcon,
        keywords: ["dither", "horizon", "background", "animation", "motion", "theme"],
      },
      {
        id: "shortcuts",
        label: "Shortcuts",
        description: "Keyboard shortcuts available across Scuttle.",
        icon: KeyboardIcon,
        keywords: ["keyboard", "hotkey", "search", "stop", "escape", "keybinding"],
      },
    ],
  },
  {
    label: "Agents",
    sections: [
      {
        id: "providers",
        label: "Providers",
        description: "Agent harnesses Scuttle can run, and how each one launches.",
        icon: PlugSocketIcon,
        keywords: ["claude", "codex", "opencode", "copilot", "antigravity", "binary", "launch"],
      },
      {
        id: "models",
        label: "Models",
        description: "Every model your providers expose. Star favorites to pin them in the picker.",
        icon: AiBrain01Icon,
        keywords: ["favorite", "star", "anthropic", "openai", "google", "openrouter", "default"],
      },
      {
        id: "projects",
        label: "Projects",
        description: "Repositories and folders agents can work in.",
        icon: Folder01Icon,
        keywords: ["repository", "repo", "folder", "branch", "git"],
      },
    ],
  },
  {
    label: "System",
    sections: [
      {
        id: "environment",
        label: "Environment",
        description: "Where Scuttle is running and the state of its local server.",
        icon: ComputerIcon,
        keywords: ["server", "runtime", "version", "database", "desktop", "uptime"],
      },
    ],
  },
];

const ALL_SECTIONS = SETTINGS_GROUPS.flatMap((group) => group.sections);

export const DEFAULT_SECTION: SectionId = "general";

export const parseSectionId = (value: unknown): SectionId | undefined =>
  SECTION_IDS.find((id) => id === value);

export const sectionById = (id: SectionId): SectionEntry => {
  const entry = ALL_SECTIONS.find((section) => section.id === id);
  if (entry === undefined) throw new Error(`Settings section "${id}" is missing from the nav.`);
  return entry;
};

export const filterSettingsGroups = (query: string): ReadonlyArray<SectionGroup> => {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return SETTINGS_GROUPS;
  const matches = (section: SectionEntry) =>
    [section.label, section.description, ...section.keywords].some((text) =>
      text.toLowerCase().includes(q),
    );
  return SETTINGS_GROUPS.map((group) =>
    group.label.toLowerCase().includes(q)
      ? group
      : { ...group, sections: group.sections.filter(matches) },
  ).filter((group) => group.sections.length > 0);
};

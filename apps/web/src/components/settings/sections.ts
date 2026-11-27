import {
  AnalyticsUpIcon,
  CommandIcon,
  ComputerIcon,
  CpuIcon,
  DashboardSpeed02Icon,
  Folder01Icon,
  GitBranchIcon,
  KeyboardIcon,
  PaintBoardIcon,
  PlugSocketIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export const SECTION_IDS = [
  "general",
  "appearance",
  "usage",
  "performance",
  "shortcuts",
  "providers",
  "stack",
  "skills",
  "projects",
  "git",
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
        description: "Color theme, background effects, and motion.",
        icon: PaintBoardIcon,
        keywords: [
          "theme",
          "dark",
          "light",
          "obsidian",
          "midnight",
          "nord",
          "espresso",
          "daylight",
          "paper",
          "dither",
          "horizon",
          "background",
          "animation",
          "motion",
        ],
      },
      {
        id: "usage",
        label: "Usage",
        description: "Token counts, cache efficiency, and per-model breakdown across harnesses.",
        icon: AnalyticsUpIcon,
        keywords: [
          "tokens",
          "usage",
          "cost",
          "cache",
          "spend",
          "claude",
          "codex",
          "antigravity",
          "opencode",
          "chart",
        ],
      },
      {
        id: "performance",
        label: "Performance",
        description: "Model scores, speed, cost, and outcomes by task category.",
        icon: DashboardSpeed02Icon,
        keywords: [
          "performance",
          "leaderboard",
          "score",
          "rating",
          "tok/s",
          "speed",
          "latency",
          "benchmark",
          "rework",
          "model",
        ],
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
        description: "Agent harnesses, launch settings, and enabled models.",
        icon: PlugSocketIcon,
        keywords: [
          "claude",
          "codex",
          "opencode",
          "copilot",
          "antigravity",
          "binary",
          "launch",
          "models",
          "favorite",
          "star",
          "default",
        ],
      },
      {
        id: "stack",
        label: "Model stack",
        description:
          "Map nano, small, medium, large, xlarge, max, design, panel, and council models globally, per project, or per agent.",
        icon: CpuIcon,
        keywords: [
          "astack",
          "tier",
          "nano",
          "small",
          "medium",
          "large",
          "xlarge",
          "max",
          "design",
          "panel",
          "council",
          "budget",
        ],
      },
      {
        id: "skills",
        label: "Skills",
        description: "Default Scuttle-vendored skills available under /scuttle:*.",
        icon: CommandIcon,
        keywords: ["astack", "scuttle:go", "scuttle:design", "slash", "playbook", "skill"],
      },
      {
        id: "projects",
        label: "Projects",
        description: "Repositories and folders agents can work in.",
        icon: Folder01Icon,
        keywords: ["repository", "repo", "folder", "branch", "git"],
      },
      {
        id: "git",
        label: "Git",
        description: "GitHub and GitLab accounts used for pull and merge requests.",
        icon: GitBranchIcon,
        keywords: [
          "github",
          "gitlab",
          "gh",
          "glab",
          "token",
          "oauth",
          "pull request",
          "merge request",
        ],
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

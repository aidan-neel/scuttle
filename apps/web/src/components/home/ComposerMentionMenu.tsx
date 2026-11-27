import { BubbleChatIcon, Folder01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import type { Agent, DirectoryEntry, Thread } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { isAgentThread } from "@/lib/agentState.ts";
import { formatRelativeAge } from "@/lib/format.ts";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import type { PaletteContent, PaletteItem } from "./ComposerPalette.tsx";
import { formatMention } from "./composerTriggers.ts";

export type MentionView =
  | { readonly kind: "root" }
  | { readonly kind: "agents" }
  | { readonly kind: "threads" }
  | { readonly kind: "files"; readonly dir: string };

interface MentionContentOptions {
  readonly view: MentionView;
  readonly query: string;
  readonly filesRoot: string | undefined;
  readonly enabled: boolean;
  readonly drill: (view: MentionView) => void;
  readonly insert: (token: string) => void;
}

type FolderListing =
  | { readonly kind: "loading"; readonly dir: string }
  | {
      readonly kind: "loaded";
      readonly dir: string;
      readonly entries: ReadonlyArray<DirectoryEntry>;
    }
  | { readonly kind: "failed"; readonly dir: string; readonly message: string };

const RECENT_LIMIT = 3;
const SEARCH_LIMIT = 6;

const matches = (text: string, query: string) => text.toLowerCase().includes(query.toLowerCase());

const relativePath = (root: string, path: string) =>
  path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]+/, "") : path;

export function useMentionContent({
  view,
  query,
  filesRoot,
  enabled,
  drill,
  insert,
}: MentionContentOptions): PaletteContent {
  const agents = useWorkspaceSelector((s) => s.agents);
  const threads = useWorkspaceSelector((s) => s.threads);
  const { listDirectory } = useWorkspaceActions();
  const filesDir = enabled && view.kind === "files" ? view.dir : null;
  const [listing, setListing] = useState<FolderListing | null>(null);

  useEffect(() => {
    if (filesDir === null) return;
    let active = true;
    setListing({ kind: "loading", dir: filesDir });
    listDirectory(filesDir)
      .then((result) => {
        if (active) setListing({ kind: "loaded", dir: filesDir, entries: result.entries });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Could not list folders.";
        setListing({ kind: "failed", dir: filesDir, message });
      });
    return () => {
      active = false;
    };
  }, [filesDir]);

  const plainThreads = threads.filter((thread) => !isAgentThread(agents, thread.id));

  const agentItem = (agent: Agent): PaletteItem => ({
    id: `agent:${agent.id}`,
    label: agent.name,
    description: agent.purpose || agent.projectName,
    leading: <Identicon name={agent.name} size="sm" className="shrink-0" />,
    onSelect: () => insert(formatMention(agent.name)),
  });

  const threadItem = (thread: Thread): PaletteItem => ({
    id: `thread:${thread.id}`,
    label: thread.title,
    description: `${thread.projectName} · ${formatRelativeAge(thread.updatedAt)}`,
    icon: BubbleChatIcon,
    onSelect: () => insert(formatMention(thread.title)),
  });

  const categories: ReadonlyArray<PaletteItem> = [
    {
      id: "category:agents",
      label: "Agents",
      description: "Hand work to an agent",
      icon: UserGroupIcon,
      drill: true,
      onSelect: () => drill({ kind: "agents" }),
    },
    {
      id: "category:threads",
      label: "Threads",
      description: "Reference another thread",
      icon: BubbleChatIcon,
      drill: true,
      onSelect: () => drill({ kind: "threads" }),
    },
    ...(filesRoot === undefined
      ? []
      : [
          {
            id: "category:files",
            label: "Files",
            description: "Folders in this workspace",
            icon: Folder01Icon,
            drill: true,
            onSelect: () => drill({ kind: "files", dir: filesRoot }),
          },
        ]),
  ];

  const back = () => drill({ kind: "root" });

  switch (view.kind) {
    case "root": {
      if (query.length === 0) {
        const recent = [
          ...agents.map((agent) => ({ at: agent.updatedAt, item: agentItem(agent) })),
          ...plainThreads.map((thread) => ({ at: thread.updatedAt, item: threadItem(thread) })),
        ]
          .toSorted((a, b) => b.at.localeCompare(a.at))
          .slice(0, RECENT_LIMIT)
          .map((entry) => entry.item);
        return {
          label: "Mention",
          sections: [{ label: "Recent", items: recent }, { items: categories }],
          emptyText: "Nothing to mention yet",
        };
      }
      return {
        label: "Mention",
        sections: [
          {
            label: "Agents",
            items: agents
              .filter((agent) => matches(agent.name, query))
              .slice(0, SEARCH_LIMIT)
              .map(agentItem),
          },
          {
            label: "Threads",
            items: plainThreads
              .filter((thread) => matches(thread.title, query))
              .slice(0, SEARCH_LIMIT)
              .map(threadItem),
          },
          { items: categories.filter((item) => matches(item.label, query)) },
        ],
        emptyText: "No matches",
      };
    }
    case "agents":
      return {
        label: "Agents",
        title: "Agents",
        onBack: back,
        sections: [{ items: agents.filter((agent) => matches(agent.name, query)).map(agentItem) }],
        emptyText: agents.length === 0 ? "No agents yet" : "No matching agents",
      };
    case "threads":
      return {
        label: "Threads",
        title: "Threads",
        onBack: back,
        sections: [
          {
            items: plainThreads.filter((thread) => matches(thread.title, query)).map(threadItem),
          },
        ],
        emptyText: plainThreads.length === 0 ? "No threads yet" : "No matching threads",
      };
    case "files": {
      const root = filesRoot ?? view.dir;
      const relativeDir = relativePath(root, view.dir);
      const current = listing?.dir === view.dir ? listing : null;
      const separator = Math.max(view.dir.lastIndexOf("/"), view.dir.lastIndexOf("\\"));
      const parent = view.dir.slice(0, Math.max(separator, root.length));
      const useFolder: ReadonlyArray<PaletteItem> =
        relativeDir.length === 0 || query.length > 0
          ? []
          : [
              {
                id: `folder-use:${view.dir}`,
                label: `Use ${relativeDir}/`,
                icon: Folder01Icon,
                hint: "folder",
                onSelect: () => insert(formatMention(`${relativeDir}/`)),
              },
            ];
      const entries = current?.kind === "loaded" ? current.entries : [];
      return {
        label: "Files",
        title: relativeDir.length === 0 ? "Files" : `Files / ${relativeDir}`,
        onBack: relativeDir.length === 0 ? back : () => drill({ kind: "files", dir: parent }),
        sections: [
          { items: useFolder },
          {
            items: entries
              .filter((entry) => matches(entry.name, query))
              .map((entry) => ({
                id: `folder:${entry.path}`,
                label: entry.name,
                icon: Folder01Icon,
                drill: true,
                onSelect: () => drill({ kind: "files", dir: entry.path }),
              })),
          },
        ],
        emptyText:
          current === null || current.kind === "loading"
            ? "Loading folders…"
            : current.kind === "failed"
              ? current.message
              : "No folders here",
      };
    }
  }
}

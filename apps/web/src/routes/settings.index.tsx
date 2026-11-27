import { createFileRoute, redirect } from "@tanstack/react-router";
import type { StackScopeKind } from "@/components/settings/ModelStackSection.tsx";
import { DEFAULT_SECTION, parseSectionId } from "@/components/settings/sections.ts";

const parseScope = (value: unknown): StackScopeKind | undefined =>
  value === "global" || value === "project" || value === "agent" ? value : undefined;

export const Route = createFileRoute("/settings/")({
  beforeLoad: ({ search }) => {
    const record = search as Record<string, unknown>;
    const section =
      parseSectionId(record["section"]) ??
      (record["section"] === "models" ? "providers" : DEFAULT_SECTION);
    const scope = parseScope(record["scope"]);
    const projectId = typeof record["projectId"] === "string" ? record["projectId"] : undefined;
    const agentId = typeof record["agentId"] === "string" ? record["agentId"] : undefined;
    throw redirect({
      to: "/settings/$section",
      params: { section },
      search: {
        ...(scope !== undefined ? { scope } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(agentId !== undefined ? { agentId } : {}),
      },
      replace: true,
    });
  },
});

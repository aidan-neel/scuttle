import type { ScuttleSkill } from "@scuttle/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ProjectsSection } from "@/components/settings/AgentSections.tsx";
import { EnvironmentSection } from "@/components/settings/EnvironmentSection.tsx";
import { GitSection } from "@/components/settings/GitSection.tsx";
import {
  ModelStackSection,
  type StackScopeKind,
} from "@/components/settings/ModelStackSection.tsx";
import { SettingsHeader } from "@/components/settings/primitives.tsx";
import { ProvidersSection } from "@/components/settings/ProvidersSection.tsx";
import {
  DEFAULT_SECTION,
  parseSectionId,
  type SectionId,
  sectionById,
} from "@/components/settings/sections.ts";
import { SettingsNavCompact } from "@/components/settings/SettingsNav.tsx";
import { SkillsSection } from "@/components/settings/SkillsSection.tsx";
import { SkillViewerSidebar } from "@/components/settings/SkillViewerSidebar.tsx";
import { PerformanceSection } from "@/components/settings/PerformanceSection.tsx";
import { UsageSection } from "@/components/settings/UsageSection.tsx";
import {
  AppearanceSection,
  GeneralSection,
  ShortcutsSection,
} from "@/components/settings/WorkspaceSections.tsx";
import { useWorkspaceSelector } from "@/lib/workspace.tsx";

interface SettingsSearch {
  scope?: StackScopeKind;
  projectId?: string;
  agentId?: string;
}

const parseScope = (value: unknown): StackScopeKind | undefined =>
  value === "global" || value === "project" || value === "agent" ? value : undefined;

export const Route = createFileRoute("/settings/$section")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => {
    const scope = parseScope(search["scope"]);
    const projectId = typeof search["projectId"] === "string" ? search["projectId"] : undefined;
    const agentId = typeof search["agentId"] === "string" ? search["agentId"] : undefined;
    return {
      ...(scope !== undefined ? { scope } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      ...(agentId !== undefined ? { agentId } : {}),
    };
  },
  beforeLoad: ({ params }) => {
    if (parseSectionId(params.section) === undefined) {
      throw redirect({
        to: "/settings/$section",
        params: { section: params.section === "models" ? "providers" : DEFAULT_SECTION },
        replace: true,
      });
    }
  },
  component: SettingsPage,
});

function SectionBody({
  id,
  scope,
  projectId,
  agentId,
  selectedSkillId,
  onSelectSkill,
}: {
  readonly id: SectionId;
  readonly scope: StackScopeKind | undefined;
  readonly projectId: string | undefined;
  readonly agentId: string | undefined;
  readonly selectedSkillId: string | null;
  readonly onSelectSkill: (skill: ScuttleSkill) => void;
}) {
  switch (id) {
    case "general":
      return <GeneralSection />;
    case "appearance":
      return <AppearanceSection />;
    case "usage":
      return <UsageSection />;
    case "performance":
      return <PerformanceSection />;
    case "shortcuts":
      return <ShortcutsSection />;
    case "providers":
      return <ProvidersSection />;
    case "stack":
      return (
        <ModelStackSection
          key={`${scope ?? "global"}-${projectId ?? ""}-${agentId ?? ""}`}
          initialScope={scope}
          initialProjectId={projectId}
          initialAgentId={agentId}
        />
      );
    case "skills":
      return <SkillsSection selectedSkillId={selectedSkillId} onSelectSkill={onSelectSkill} />;
    case "projects":
      return <ProjectsSection />;
    case "git":
      return <GitSection />;
    case "environment":
      return <EnvironmentSection />;
  }
}

function SettingsPage() {
  const { section: rawSection } = Route.useParams();
  const section = parseSectionId(rawSection) ?? DEFAULT_SECTION;
  const { scope, projectId, agentId } = Route.useSearch();
  const entry = sectionById(section);
  const skills = useWorkspaceSelector((s) => s.skills);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  const openSkill =
    section === "skills" && selectedSkillId !== null
      ? (skills.find((s) => s.id === selectedSkillId) ?? null)
      : null;

  const handleSelectSkill = (skill: ScuttleSkill) => {
    setSelectedSkillId((prev) => (prev === skill.id ? null : skill.id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SettingsNavCompact active={section} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div key={section} className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[40rem] space-y-6 px-4 pt-8 pb-16 md:pt-10">
            <SettingsHeader title={entry.label} />
            <SectionBody
              id={section}
              scope={scope}
              projectId={projectId}
              agentId={agentId}
              selectedSkillId={openSkill?.id ?? null}
              onSelectSkill={handleSelectSkill}
            />
          </div>
        </div>
        <SkillViewerSidebar skill={openSkill} onClose={() => setSelectedSkillId(null)} />
      </div>
    </div>
  );
}

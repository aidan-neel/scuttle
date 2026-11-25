import { createFileRoute } from "@tanstack/react-router";
import { ModelsSection, ProjectsSection } from "@/components/settings/AgentSections.tsx";
import { EnvironmentSection } from "@/components/settings/EnvironmentSection.tsx";
import { GitSection } from "@/components/settings/GitSection.tsx";
import { SettingsHeader } from "@/components/settings/primitives.tsx";
import { ProvidersSection } from "@/components/settings/ProvidersSection.tsx";
import {
  DEFAULT_SECTION,
  parseSectionId,
  type SectionId,
  sectionById,
} from "@/components/settings/sections.ts";
import { SettingsNavCompact } from "@/components/settings/SettingsNav.tsx";
import {
  AppearanceSection,
  GeneralSection,
  ShortcutsSection,
} from "@/components/settings/WorkspaceSections.tsx";

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: SectionId } => {
    const section = parseSectionId(search["section"]);
    return section === undefined ? {} : { section };
  },
  component: SettingsPage,
});

function SectionBody({ id }: { readonly id: SectionId }) {
  switch (id) {
    case "general":
      return <GeneralSection />;
    case "appearance":
      return <AppearanceSection />;
    case "shortcuts":
      return <ShortcutsSection />;
    case "providers":
      return <ProvidersSection />;
    case "models":
      return <ModelsSection />;
    case "projects":
      return <ProjectsSection />;
    case "git":
      return <GitSection />;
    case "environment":
      return <EnvironmentSection />;
  }
}

function SettingsPage() {
  const { section = DEFAULT_SECTION } = Route.useSearch();
  const entry = sectionById(section);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SettingsNavCompact active={section} />
      <div key={section} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[640px] space-y-6 px-4 pt-8 pb-16 md:pt-10">
          <SettingsHeader title={entry.label} />
          <SectionBody id={section} />
        </div>
      </div>
    </div>
  );
}

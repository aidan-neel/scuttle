import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "bun:test";
import {
  type ModelSelection,
  resolveEffectiveModelTiers,
  resolveModelForRole,
} from "@scuttle/contracts";
import { AgentId, ProjectId, ProviderId, ThreadId } from "@scuttle/shared/ids";
import { Database } from "bun:sqlite";
import { applyScuttleMigrations } from "../../src/persistence/migrations.ts";
import { startScuttleServer } from "../../src/server.ts";
import { wrapPromptForThread } from "../../src/services/agent/agentContext.ts";
import {
  readScopedModelTierConfigs,
  writeModelTierScope,
} from "../../src/services/ModelTierService.ts";
import { matchSkillInvocation, scanVendoredSkills } from "../../src/services/SkillService.ts";

const VENDORED_ROOT = NodePath.resolve(import.meta.dir, "../../../../vendor/astack");

const makeSelection = (
  providerId: string,
  providerKind: ModelSelection["providerKind"],
  model: string,
  effort?: ModelSelection["effort"],
): ModelSelection => ({
  providerId: ProviderId.make(providerId),
  providerKind,
  model,
  ...(effort ? { effort } : {}),
});

describe("astack vendored skills and scoped model tiers", () => {
  it("loads vendored /scuttle:* skills including go and design and resolves command invocations", () => {
    const skills = scanVendoredSkills(VENDORED_ROOT);
    expect(skills.length).toBeGreaterThan(20);

    const goSkill = skills.find((s) => s.id === "go");
    const designSkill = skills.find((s) => s.id === "design");
    expect(goSkill?.command).toBe("/scuttle:go");
    expect(designSkill?.command).toBe("/scuttle:design");

    const parsedGo = matchSkillInvocation(skills, "/scuttle:go fix the composer");
    expect(parsedGo?.skill.id).toBe("go");
    expect(parsedGo?.remainder).toBe("fix the composer");

    const parsedAlias = matchSkillInvocation(skills, "/skuttle:design polish the sidebar");
    expect(parsedAlias?.skill.id).toBe("design");
    expect(parsedAlias?.remainder).toBe("polish the sidebar");

    expect(matchSkillInvocation(skills, "plain message")).toBeNull();
  });

  it("persists global, project, and agent model tier overrides with inheritance", () => {
    const db = new Database(":memory:");
    applyScuttleMigrations(db);

    const projectId = ProjectId.make("proj-1");
    const agentId = AgentId.make("agent-1");
    const nano = makeSelection("antigravity", "antigravity", "gemini-4-flash");
    const globalMedium = makeSelection("codex", "codex", "gpt-6.2-sol", "medium");
    const projectMedium = makeSelection("claude", "claude", "claude-sonnet-5-5", "high");
    const agentDesign = makeSelection("claude", "claude", "claude-opus-5-5", "high");

    writeModelTierScope(
      db,
      { kind: "global" },
      {
        budget: "large",
        nano,
        medium: globalMedium,
        panel: [globalMedium, agentDesign],
      },
    );
    writeModelTierScope(
      db,
      { kind: "project", projectId },
      {
        medium: projectMedium,
      },
    );
    writeModelTierScope(
      db,
      { kind: "agent", agentId },
      {
        design: agentDesign,
      },
    );

    const all = readScopedModelTierConfigs(db);
    const resolved = resolveEffectiveModelTiers(all, { projectId, agentId });
    expect(resolved.budget).toEqual({ value: "large", source: "global" });
    expect(resolved.sizes.nano).toEqual({ value: nano, source: "global" });
    expect(resolved.sizes.medium).toEqual({ value: projectMedium, source: "project" });
    expect(resolved.sizes.design).toEqual({ value: agentDesign, source: "agent" });
    expect(resolved.sizes.max).toEqual({ value: undefined, source: "inherit" });
    expect(resolveModelForRole(resolved, "workhorse")?.model).toBe("claude-sonnet-5-5");
    expect(resolveModelForRole(resolved, "fast")?.model).toBe("gemini-4-flash");
    expect(resolveModelForRole(resolved, "review")?.model).toBe("gpt-6.2-sol");

    // Clearing project override falls back to global medium
    writeModelTierScope(db, { kind: "project", projectId }, {});
    const afterClear = resolveEffectiveModelTiers(readScopedModelTierConfigs(db), {
      projectId,
      agentId,
    });
    expect(afterClear.sizes.medium).toEqual({ value: globalMedium, source: "global" });
    db.close();
  });

  it("wraps /scuttle:go prompts with the vendored skill directive and resolved model tiers", () => {
    const db = new Database(":memory:");
    applyScuttleMigrations(db);
    const projectId = ProjectId.make("proj-wrap");
    const medium = makeSelection("codex", "codex", "gpt-6.2-sol", "high");
    writeModelTierScope(db, { kind: "global" }, { budget: "large", medium });

    const wrapped = wrapPromptForThread({
      db,
      thread: {
        id: ThreadId.make("thread-wrap"),
        projectId,
        projectName: "scuttle",
        title: "Test",
        runtime: "local",
        branch: "main",
        cwd: "/tmp",
        modelSelection: medium,
        runtimeMode: "auto",
        interactionMode: "default",
        status: { kind: "idle" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      userPrompt: "/scuttle:go wire model tiers",
      apiBaseUrl: "http://127.0.0.1:4310",
      skillsRoot: VENDORED_ROOT,
    });

    expect(wrapped.prompt).toContain('<scuttle_skill command="/scuttle:go" name="go"');
    expect(wrapped.prompt).toContain("skills/go/SKILL.md");
    expect(wrapped.prompt).toContain("medium: codex/gpt-6.2-sol effort=high (global)");
    expect(wrapped.prompt).toContain("wire model tiers");
    db.close();
  });

  it("serves /api/skills, /api/model-tiers, and includes both in /api/workspace", async () => {
    const tmpDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-astack-test-"));
    const dbPath = NodePath.join(tmpDir, "state.sqlite");
    const server = await startScuttleServer({
      port: 0,
      dbPath,
      skillsRoot: VENDORED_ROOT,
    });
    try {
      const skillsRes = await fetch(`${server.url}/api/skills`);
      expect(skillsRes.status).toBe(200);
      const skills = (await skillsRes.json()) as Array<{ id: string; command: string }>;
      expect(skills.some((s) => s.command === "/scuttle:go")).toBe(true);
      expect(skills.some((s) => s.command === "/scuttle:design")).toBe(true);

      const nano = makeSelection("claude", "claude", "claude-haiku-4-5");
      const putRes = await fetch(`${server.url}/api/model-tiers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: { kind: "global" }, config: { budget: "medium", nano } }),
      });
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as {
        global: { budget?: string; nano?: ModelSelection };
      };
      expect(updated.global.budget).toBe("medium");
      expect(updated.global.nano?.model).toBe("claude-haiku-4-5");

      const wsRes = await fetch(`${server.url}/api/workspace`);
      expect(wsRes.status).toBe(200);
      const ws = (await wsRes.json()) as {
        skills: Array<{ command: string }>;
        modelTiers: { global: { budget?: string } };
      };
      expect(ws.skills.some((s) => s.command === "/scuttle:go")).toBe(true);
      expect(ws.modelTiers.global.budget).toBe("medium");

      const detailRes = await fetch(`${server.url}/api/skills/go`);
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as {
        skill: { id: string; command: string };
        activeFile: string;
        content: string;
        files: string[];
      };
      expect(detail.skill.id).toBe("go");
      expect(detail.activeFile).toBe("SKILL.md");
      expect(detail.content.startsWith("---")).toBe(false);
      expect(detail.content.length).toBeGreaterThan(100);
      expect(detail.files[0]).toBe("SKILL.md");

      const traversalRes = await fetch(`${server.url}/api/skills/go?file=../../AGENTS.md`);
      expect(traversalRes.status).toBe(404);
    } finally {
      await server.stop();
      NodeFS.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

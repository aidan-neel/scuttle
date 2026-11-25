import type { ForgeKind } from "@scuttle/contracts";
import { siGithub, siGitlab } from "simple-icons";
import { cn } from "@/lib/utils";

const LOGOS: Record<
  ForgeKind,
  { readonly title: string; readonly path: string; readonly fill: string }
> = {
  github: { title: siGithub.title, path: siGithub.path, fill: "currentColor" },
  gitlab: { title: siGitlab.title, path: siGitlab.path, fill: `#${siGitlab.hex}` },
};

export const FORGE_NAME: Record<ForgeKind, string> = { github: "GitHub", gitlab: "GitLab" };

export function ForgeLogo({
  forge,
  className,
}: {
  readonly forge: ForgeKind;
  readonly className?: string;
}) {
  const logo = LOGOS[forge];
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      aria-label={logo.title}
      className={cn("shrink-0 text-fg", className)}
    >
      <path d={logo.path} fill={logo.fill} />
    </svg>
  );
}

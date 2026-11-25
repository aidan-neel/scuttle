const targets = [
  "packages/contracts",
  "packages/shared",
  "packages/client-runtime",
  "apps/server",
  "apps/web",
  "apps/desktop",
];

for (const target of targets) {
  const proc = Bun.spawn(["bunx", "tsc", "--project", `${target}/tsconfig.json`, "--noEmit"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.exit(code);
  }
}

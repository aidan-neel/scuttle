const server = Bun.spawn(["bun", "--filter", "@scuttle/server", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const web = Bun.spawn(["bun", "--filter", "@scuttle/web", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const shutdown = () => {
  server.kill();
  web.kill();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const exitCode = await Promise.race([server.exited, web.exited]);
shutdown();
process.exit(exitCode);

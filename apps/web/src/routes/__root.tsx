import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/shell/AppShell.tsx";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

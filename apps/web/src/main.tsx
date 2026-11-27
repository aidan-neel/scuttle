import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initTheme } from "./components/settings/preferences.ts";
import { initRenderMode } from "./lib/renderMode.ts";
import { routeTree } from "./routeTree.gen.ts";

initTheme();
initRenderMode();

const router = createRouter({
  routeTree,
  ...(window.location.protocol === "views:" ? { history: createHashHistory() } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

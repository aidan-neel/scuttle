import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const serverTarget = process.env.SCUTTLE_SERVER_PROXY_TARGET ?? "http://127.0.0.1:4310";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react({ compiler: true }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react/compiler-runtime",
    ],
  },
  optimizeDeps: {
    entries: ["index.html", "src/routes/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react/compiler-runtime",
      "@tanstack/react-router",
      "motion/react",
      "skullet/react",
      "@base-ui/react/button",
      "@base-ui/react/combobox",
      "@base-ui/react/context-menu",
      "@base-ui/react/dialog",
      "@base-ui/react/menu",
      "@base-ui/react/popover",
      "@base-ui/react/switch",
      "@base-ui/react/tabs",
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
      "lexical",
      "@lexical/react/LexicalComposer",
      "@lexical/react/LexicalComposerContext",
      "@lexical/react/LexicalContentEditable",
      "@lexical/react/LexicalEditorRefPlugin",
      "@lexical/react/LexicalErrorBoundary",
      "@lexical/react/LexicalHistoryPlugin",
      "@lexical/react/LexicalPlainTextPlugin",
      "@lexical/react/useLexicalNodeSelection",
      "marked",
      "simple-icons",
      "cn",
      "effect/Effect",
      "effect/Option",
      "effect/Schema",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: serverTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: serverTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

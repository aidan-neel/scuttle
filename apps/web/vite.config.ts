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

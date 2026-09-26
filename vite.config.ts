import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath: process.env.NOTES_CONFIG ?? "wrangler.jsonc",
      viteEnvironment: { name: "worker" },
      persistState: process.env.KEEP_E2E_STATE
        ? { path: process.env.KEEP_E2E_STATE }
        : true,
    }),
  ],
});

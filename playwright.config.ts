import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 30000,
  },
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  reporter: "list",
  timeout: 30000,
});

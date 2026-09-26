import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

// Only the README screenshot script; never part of the normal test run.
export default defineConfig({
  ...base,
  testDir: "./scripts",
  testMatch: "readme-screenshots.spec.ts",
});

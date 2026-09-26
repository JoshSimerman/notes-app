import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";
import { validateDeployment } from "../scripts/check-deploy.mjs";

const template = parse(readFileSync("wrangler.jsonc", "utf8"));
const valid = {
  ...template,
  routes: [{ pattern: "notes.my-domain.dev", custom_domain: true }],
  vars: {
    ...template.vars,
    APP_ORIGIN: "https://notes.my-domain.dev",
    ACCESS_TEAM_DOMAIN: "my-team.cloudflareaccess.com",
    ACCESS_AUD: "0123456789abcdef".repeat(4),
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: "notes-app",
      database_id: "12345678-1234-1234-1234-123456789abc",
    },
  ],
};

describe("portable deployment configuration", () => {
  it("rejects the public template but accepts an independent custom domain", () => {
    expect(validateDeployment(template).length).toBeGreaterThan(0);
    expect(validateDeployment(valid)).toEqual([]);
  });
  it("rejects insecure, mismatched, or incomplete configuration", () => {
    for (const patch of [
      { vars: { ...valid.vars, APP_ORIGIN: "http://notes.my-domain.dev" } },
      { vars: { ...valid.vars, APP_ORIGIN: "https://notes.my-domain.dev/" } },
      { vars: { ...valid.vars, ENVIRONMENT: "development" } },
      { vars: { ...valid.vars, ACCESS_TEAM_DOMAIN: "" } },
      { vars: { ...valid.vars, ACCESS_TEAM_DOMAIN: "my-team.example.com" } },
      { vars: { ...valid.vars, ACCESS_AUD: "" } },
      { vars: { ...valid.vars, ACCESS_AUD: "not-an-aud-tag" } },
      { routes: [{ pattern: "other.my-domain.dev", custom_domain: true }] },
      { workers_dev: true },
      { preview_urls: true },
    ])
      expect(validateDeployment({ ...valid, ...patch }).length).toBeGreaterThan(
        0,
      );
  });
  it("creates a private template once and preserves an existing config", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "notes-config-"));
    try {
      copyFileSync("wrangler.jsonc", path.join(dir, "wrangler.jsonc"));
      const script = path.resolve("scripts/setup-deploy.mjs");
      expect(spawnSync(process.execPath, [script], { cwd: dir }).status).toBe(
        0,
      );
      const original = readFileSync(
        path.join(dir, "wrangler.production.jsonc"),
        "utf8",
      );
      expect(original).toBe(readFileSync("wrangler.jsonc", "utf8"));
      expect(spawnSync(process.execPath, [script], { cwd: dir }).status).toBe(
        0,
      );
      expect(
        readFileSync(path.join(dir, "wrangler.production.jsonc"), "utf8"),
      ).toBe(original);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

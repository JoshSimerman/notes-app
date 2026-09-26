import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "vite";
import path from "node:path";

// Each browser run has its own D1 database, separate from personal local notes.
// Earlier runs' databases are discarded so they don't accumulate.
for (const entry of existsSync(".wrangler")
  ? readdirSync(".wrangler", { withFileTypes: true })
  : [])
  if (entry.isDirectory() && entry.name.startsWith("e2e-"))
    rmSync(path.join(".wrangler", entry.name), {
      recursive: true,
      force: true,
    });
process.env.KEEP_E2E_STATE = path.resolve(".wrangler", `e2e-${Date.now()}`);
const migration = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    process.env.KEEP_E2E_STATE,
  ],
  { stdio: "inherit" },
);
if (migration.status !== 0) process.exit(1);
const server = await createServer({
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
await server.listen();
server.printUrls();

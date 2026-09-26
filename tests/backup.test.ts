import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeNote } from "../shared/notes";

let mf: Miniflare;
const origin = "http://localhost";
const headers = {
  Origin: origin,
  "X-Keep-Request": "1",
  "Content-Type": "application/json",
};
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/worker/index.js",
      compatibilityDate: "2026-09-23",
      bindings: { APP_ORIGIN: origin, ENVIRONMENT: "development" },
      d1Databases: ["DB"],
      r2Buckets: ["BACKUPS"],
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const statement of readFileSync(`migrations/${file}`, "utf8")
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
const save = async (patch: Record<string, unknown>) => {
  const note = { ...makeNote(), ...patch };
  const response = await mf.dispatchFetch(`${origin}/api/notes/${note.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ note, mutationId: crypto.randomUUID() }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { note: typeof note }).note;
};
const exported = async () => {
  const response = await mf.dispatchFetch(`${origin}/api/export`);
  expect(response.status).toBe(200);
  return {
    disposition: response.headers.get("Content-Disposition"),
    data: (await response.json()) as {
      format: string;
      version: number;
      exportedAt: string;
      noteWidth: number;
      notes: { id: string; title: string; status: string }[];
    },
  };
};

describe("export and backups", () => {
  it("exports every note, including archive and trash, as a download", async () => {
    const active = await save({ title: "Active it's here" });
    const archived = await save({ title: "Archived", status: "archived" });
    const trashed = await save({ title: "Trashed", status: "trashed" });
    const { disposition, data } = await exported();
    expect(disposition).toMatch(
      /^attachment; filename="notes-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(data).toMatchObject({
      format: "notes-app-export",
      version: 1,
      noteWidth: 300,
    });
    expect(data.notes.map((n) => n.id).sort()).toEqual(
      [active.id, archived.id, trashed.id].sort(),
    );
  });
  it("writes a nightly backup to R2 and prunes copies older than 30 days", async () => {
    const bucket = await mf.getR2Bucket("BACKUPS");
    await bucket.put("backups/notes-2000-01-01.json", "{}");
    const recent = new Date(Date.now() - 5 * 86400000)
      .toISOString()
      .slice(0, 10);
    await bucket.put(`backups/notes-${recent}.json`, "{}");
    const worker = await mf.getWorker();
    await worker.scheduled({ cron: "17 5 * * *" });
    const keys = (await bucket.list({ prefix: "backups/" })).objects.map(
      (o) => o.key,
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(keys).toContain(`backups/notes-${today}.json`);
    expect(keys).toContain(`backups/notes-${recent}.json`);
    expect(keys).not.toContain("backups/notes-2000-01-01.json");
    const stored = JSON.parse(
      await (await bucket.get(`backups/notes-${today}.json`))!.text(),
    );
    expect(stored.format).toBe("notes-app-export");
    expect(stored.notes.length).toBeGreaterThan(0);
  });
  it("restores a backup through the generated SQL", async () => {
    const { data: before } = await exported();
    const dir = mkdtempSync(path.join(tmpdir(), "notes-restore-"));
    try {
      const file = path.join(dir, "backup.json");
      const sql = path.join(dir, "restore.sql");
      writeFileSync(file, JSON.stringify(before));
      const result = spawnSync(
        process.execPath,
        ["scripts/restore-backup.mjs", file, sql],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      const db = await mf.getD1Database("DB");
      await db.prepare("DELETE FROM notes").run();
      await db.prepare("UPDATE settings SET note_width = 440").run();
      for (const statement of readFileSync(sql, "utf8")
        .split("\n")
        .filter(Boolean))
        await db.prepare(statement).run();
      const { data: after } = await exported();
      expect(after.notes).toEqual(before.notes);
      expect(after.noteWidth).toBe(before.noteWidth);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("refuses files that are not exports", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "notes-restore-"));
    try {
      const file = path.join(dir, "other.json");
      writeFileSync(file, JSON.stringify({ notes: [] }));
      const result = spawnSync(
        process.execPath,
        ["scripts/restore-backup.mjs", file, path.join(dir, "x.sql")],
        { encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

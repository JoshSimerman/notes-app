import type { Env } from "./env";
import { RETENTION } from "./notes";

export const BACKUP_DAYS = 30;

// One JSON document holds everything needed to rebuild the workspace:
// every note still in the database (including unexpired trash) and settings.
export async function snapshot(env: Env) {
  const [notes, settings] = await Promise.all([
    env.DB.prepare(
      "SELECT document FROM notes WHERE deleted_at IS NULL OR deleted_at > ? ORDER BY id",
    )
      .bind(Date.now() - RETENTION)
      .all<{ document: string }>(),
    env.DB.prepare("SELECT note_width FROM settings WHERE id = 1").first<{
      note_width: number;
    }>(),
  ]);
  return {
    format: "notes-app-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    noteWidth: settings?.note_width ?? 300,
    notes: notes.results.map((row) => JSON.parse(row.document)),
  };
}

export const backupKey = (date: Date) =>
  `backups/notes-${date.toISOString().slice(0, 10)}.json`;

// Writes today's snapshot to R2 and prunes copies older than BACKUP_DAYS.
// Installations without the BACKUPS binding simply skip this step.
export async function backup(env: Env, now = new Date()) {
  if (!env.BACKUPS) return;
  await env.BACKUPS.put(backupKey(now), JSON.stringify(await snapshot(env)), {
    httpMetadata: { contentType: "application/json" },
  });
  const oldest = backupKey(new Date(now.getTime() - BACKUP_DAYS * 86400000));
  const expired: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: "backups/", cursor });
    expired.push(
      ...page.objects.map((o) => o.key).filter((key) => key < oldest),
    );
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (expired.length) await env.BACKUPS.delete(expired);
}

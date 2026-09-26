import { Hono } from "hono";
import { z } from "zod";
import { noteSchema, type Note } from "../shared/notes";
import type { Bindings, Env } from "./env";

export const RETENTION = 90 * 86400000;
type Row = { document: string; version: number; last_mutation: string };
export const notes = new Hono<Bindings>();
notes.get("/notes", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT document FROM notes WHERE deleted_at IS NULL OR deleted_at > ?",
  )
    .bind(Date.now() - RETENTION)
    .all<{ document: string }>();
  const settings = await c.env.DB.prepare(
    "SELECT note_width FROM settings WHERE id = 1",
  ).first<{ note_width: number }>();
  return c.json({
    notes: result.results.map((r) => JSON.parse(r.document)),
    noteWidth: settings?.note_width ?? 300,
  });
});
notes.put("/notes/:id", async (c) => {
  const parsed = z
    .object({ note: noteSchema, mutationId: z.uuid() })
    .safeParse(await c.req.json());
  if (!parsed.success || parsed.data.note.id !== c.req.param("id"))
    return c.json(
      { error: "This note contains invalid or oversized fields." },
      400,
    );
  const { note, mutationId } = parsed.data;
  const existing = await c.env.DB.prepare(
    "SELECT document, version, last_mutation FROM notes WHERE id = ?",
  )
    .bind(note.id)
    .first<Row>();
  const previous: Note | null = existing ? JSON.parse(existing.document) : null;
  if (previous?.deletedAt && previous.deletedAt <= Date.now() - RETENTION)
    return c.json({ error: "This note has expired from trash." }, 410);
  if (existing?.last_mutation === mutationId) return c.json({ note: previous });
  if (existing ? existing.version !== note.version : note.version !== 0)
    return c.json(
      { error: "This note changed on another device.", current: previous },
      409,
    );
  const now = Date.now();
  const saved: Note = {
    ...note,
    version: note.version + 1,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    deletedAt: note.status === "trashed" ? (previous?.deletedAt ?? now) : null,
  };
  const result = existing
    ? await c.env.DB.prepare(
        "UPDATE notes SET document = ?, version = ?, status = ?, deleted_at = ?, updated_at = ?, last_mutation = ? WHERE id = ? AND version = ?",
      )
        .bind(
          JSON.stringify(saved),
          saved.version,
          saved.status,
          saved.deletedAt,
          now,
          mutationId,
          note.id,
          note.version,
        )
        .run()
    : await c.env.DB.prepare(
        "INSERT INTO notes(id, document, version, status, deleted_at, updated_at, last_mutation) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
        .bind(
          note.id,
          JSON.stringify(saved),
          saved.version,
          saved.status,
          saved.deletedAt,
          now,
          mutationId,
        )
        .run();
  if (!result.meta.changes) {
    const current = await c.env.DB.prepare(
      "SELECT document, last_mutation FROM notes WHERE id = ?",
    )
      .bind(note.id)
      .first<Row>();
    if (current?.last_mutation === mutationId)
      return c.json({ note: JSON.parse(current.document) });
    return c.json(
      {
        error: "This note changed on another device.",
        current: current ? JSON.parse(current.document) : null,
      },
      409,
    );
  }
  return c.json({ note: saved });
});
notes.put("/settings", async (c) => {
  const parsed = z
    .object({ noteWidth: z.number().int().min(240).max(440) })
    .safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ error: "Choose a note width between 240 and 440." }, 400);
  await c.env.DB.prepare("UPDATE settings SET note_width = ? WHERE id = 1")
    .bind(parsed.data.noteWidth)
    .run();
  return c.json(parsed.data);
});
export async function cleanup(env: Env) {
  await env.DB.prepare("DELETE FROM notes WHERE deleted_at <= ?")
    .bind(Date.now() - RETENTION)
    .run();
}

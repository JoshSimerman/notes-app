import { test, expect } from "@playwright/test";
import { makeNote } from "../shared/notes";
const headers = { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" };

test("notes API: request guards, conflict protection, and idempotent retries", async ({
  request,
}) => {
  const session = await request.get("/api/session");
  expect(await session.json()).toEqual({ email: null, local: true });
  const note = { ...makeNote(), title: "API test" };
  const mutationId = crypto.randomUUID();
  const save = await request.put(`/api/notes/${note.id}`, {
    headers,
    data: { note, mutationId },
  });
  expect(save.ok()).toBeTruthy();
  const first = (await save.json()).note;
  expect(first.version).toBe(1);
  const retry = await request.put(`/api/notes/${note.id}`, {
    headers,
    data: { note, mutationId },
  });
  expect((await retry.json()).note.version).toBe(1);
  const stale = await request.put(`/api/notes/${note.id}`, {
    headers,
    data: { note, mutationId: crypto.randomUUID() },
  });
  expect(stale.status()).toBe(409);
  const bad = await request.put(`/api/notes/${note.id}`, {
    headers,
    data: {
      note: { ...first, color: "<script>" },
      mutationId: crypto.randomUUID(),
    },
  });
  expect(bad.status()).toBe(400);
  const trash = await request.put(`/api/notes/${note.id}`, {
    headers,
    data: {
      note: { ...first, status: "trashed" },
      mutationId: crypto.randomUUID(),
    },
  });
  expect((await trash.json()).note.deletedAt).toBeGreaterThan(0);
  const unguarded = await request.put(`/api/notes/${note.id}`, {
    data: { note: { ...first, version: 2 }, mutationId: crypto.randomUUID() },
  });
  expect(unguarded.status()).toBe(403);
});

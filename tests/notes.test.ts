import { describe, expect, it } from "vitest";
import {
  noteSchema,
  makeNote,
  sortNotes,
  dueStatus,
  convertNote,
  colors,
  darkNoteColor,
  dueAttention,
  matchesNoteView,
  type Note,
} from "../shared/notes";

describe("note contracts", () => {
  it("renders legacy and custom colors as stable dark shades", () => {
    expect(darkNoteColor("#FFFFFF")).toBe(colors[0]);
    expect(darkNoteColor("#fff3b8")).toBe(colors[1]);
    expect(darkNoteColor("#10392f")).toBe("#10392f");
    for (const color of [...colors, "#ff6600", "#aabbcc", "#000000"]) {
      const dark = darkNoteColor(color);
      expect(dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(darkNoteColor(dark)).toBe(dark);
      expect(
        Math.max(...[1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16))),
      ).toBeLessThanOrEqual(80);
    }
  });
  it("starts with a medium-priority checklist and visible completed items", () => {
    expect(makeNote()).toMatchObject({
      kind: "list",
      priority: "medium",
      showCompleted: true,
      status: "active",
      version: 0,
    });
  });
  it("rejects impossible dates, unsafe colors, and oversized titles", () => {
    for (const patch of [
      { dueDate: "2026-02-30" },
      { color: "url(evil)" },
      { title: "x".repeat(301) },
    ]) {
      expect(noteSchema.safeParse({ ...makeNote(), ...patch }).success).toBe(
        false,
      );
    }
  });
  it("sorts priority first and nearest due date next", () => {
    const low = { ...makeNote(), priority: "low" as const };
    const highLater = {
      ...makeNote(),
      priority: "high" as const,
      dueDate: "2026-10-01",
    };
    const highSoon = {
      ...makeNote(),
      priority: "high" as const,
      dueDate: "2026-09-24",
    };
    expect(sortNotes([low, highLater, highSoon]).map((n) => n.id)).toEqual([
      highSoon.id,
      highLater.id,
      low.id,
    ]);
  });
  it("keeps creation order when completion and save timestamps change", () => {
    const older = { ...makeNote(), createdAt: 100, updatedAt: 100 };
    const newer = { ...makeNote(), createdAt: 200, updatedAt: 200 };
    const saved = {
      ...older,
      updatedAt: 300,
      items: [{ id: crypto.randomUUID(), text: "Finished", done: true }],
    };
    expect(sortNotes([older, newer]).map((note) => note.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(sortNotes([saved, newer]).map((note) => note.id)).toEqual([
      newer.id,
      older.id,
    ]);
  });
  it("uses calendar days across month boundaries", () => {
    const now = new Date(2026, 8, 30, 23, 59);
    expect(dueStatus("2026-09-29", now)?.tone).toBe("overdue");
    expect(dueStatus("2026-09-30", now)?.label).toBe("Today");
    expect(dueStatus("2026-10-01", now)?.label).toBe("Tomorrow");
    expect(dueStatus(null, now)).toBeNull();
  });
  it("flags unfinished active work through the third calendar day", () => {
    const now = new Date(2026, 8, 30, 23, 59);
    const pending: Note = {
      ...makeNote(),
      items: [{ id: crypto.randomUUID(), text: "Finish this", done: false }],
    };
    for (const [dueDate, expected] of [
      [null, null],
      ["2026-09-29", "overdue"],
      ["2026-09-30", "soon"],
      ["2026-10-03", "soon"],
      ["2026-10-04", null],
    ] as const) {
      expect(dueAttention({ ...pending, dueDate }, now)).toBe(expected);
    }
    for (const patch of [
      { status: "archived" },
      { status: "trashed" },
      { items: [] },
      { items: pending.items.map((item) => ({ ...item, done: true })) },
    ] as Partial<Note>[]) {
      expect(
        dueAttention({ ...pending, dueDate: "2026-09-29", ...patch }, now),
      ).toBeNull();
    }
    expect(
      dueAttention(
        { ...pending, kind: "text", items: [], dueDate: "2026-09-29" },
        now,
      ),
    ).toBe("overdue");
  });
  it("limits priority and due views to active notes and separates due soon from past due", () => {
    const now = new Date(2026, 8, 30);
    const note: Note = {
      ...makeNote(),
      kind: "text",
      priority: "critical",
      dueDate: "2026-09-30",
    };
    expect(matchesNoteView(note, "critical", now)).toBe(true);
    expect(matchesNoteView(note, "high", now)).toBe(false);
    expect(matchesNoteView(note, "due-soon", now)).toBe(true);
    expect(matchesNoteView(note, "past-due", now)).toBe(false);
    expect(
      matchesNoteView({ ...note, dueDate: "2026-09-29" }, "past-due", now),
    ).toBe(true);
    expect(
      matchesNoteView({ ...note, status: "archived" }, "critical", now),
    ).toBe(false);
    expect(
      matchesNoteView({ ...note, status: "trashed" }, "due-soon", now),
    ).toBe(false);
    expect(
      matchesNoteView({ ...note, status: "archived" }, "archived", now),
    ).toBe(true);
    expect(matchesNoteView({ ...note, status: "trashed" }, "active", now)).toBe(
      false,
    );
  });
  it("converts long text lines into valid checklist items without losing text", () => {
    const text = "a".repeat(5001);
    const converted = convertNote(
      { ...makeNote(), kind: "text", content: text },
      "list",
    );
    expect(converted?.items.map((i) => i.text).join("")).toBe(text);
    expect(noteSchema.safeParse(converted).success).toBe(true);
    expect(
      convertNote(
        { ...makeNote(), kind: "text", content: "x\n".repeat(1001) },
        "list",
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  noteSchema,
  makeNote,
  sortNotes,
  dueStatus,
  convertNote,
  colors,
  noteColor,
  dueAttention,
  matchesNoteView,
  listLines,
  mergeIntoPrevious,
  splitItem,
  pasteIntoItem,
  textInsertion,
  normalizeItems,
  listRows,
  arrangeActive,
  indentItem,
  toggleItem,
  trimTrailingEmpty,
  moveItem,
  type Item,
  type Note,
} from "../shared/notes";

describe("note contracts", () => {
  it("maps legacy colors to dark ones and keeps custom colors exact", () => {
    expect(noteColor("#FFFFFF")).toBe(colors[0]);
    expect(noteColor("#fff3b8")).toBe(colors[1]);
    for (const color of colors) expect(noteColor(color)).toBe(color);
    expect(noteColor("#10392f")).toBe("#10392f");
    expect(noteColor("#FF9900")).toBe("#ff9900");
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

describe("checklist editing", () => {
  const item = (text: string, done = false) => ({
    id: crypto.randomUUID(),
    text,
    done,
  });
  it("reads pasted bullets, numbers, and checkboxes as plain lines", () => {
    expect(
      listLines(
        "- 1 L water\r\n* 1/4 tsp salt\n\n• 1 tbsp honey\n2. Juice of 1 lemon\n3) Stir\n- [ ] Chill\n[x] Serve  \n1.5 g potassium\n-5 degrees",
      ),
    ).toEqual([
      "1 L water",
      "1/4 tsp salt",
      "1 tbsp honey",
      "Juice of 1 lemon",
      "Stir",
      "Chill",
      "Serve",
      "1.5 g potassium",
      "-5 degrees",
    ]);
  });
  it("splits an item at the caret, moving the rest into a new item below", () => {
    const [first, second, third] = [
      item("Before"),
      item("Salt, honey"),
      item("After"),
    ];
    const edit = splitItem([first, second, third], second.id, 5, 5);
    expect(edit.items.map((i) => i.text)).toEqual([
      "Before",
      "Salt,",
      "honey",
      "After",
    ]);
    expect(edit.items[1].id).toBe(second.id);
    expect(edit).toMatchObject({ focusId: edit.items[2].id, offset: 0 });
    expect(
      splitItem([second], second.id, 11, 11).items.map((i) => i.text),
    ).toEqual(["Salt, honey", ""]);
    expect(
      splitItem([second], second.id, 4, 6).items.map((i) => i.text),
    ).toEqual(["Salt", "honey"]);
  });
  it("joins an item onto the one shown above it", () => {
    const [done, first, doneLater, second] = [
      item("Done", true),
      item("Salt,"),
      item("Later", true),
      item("honey"),
    ];
    const items = [done, first, doneLater, second];
    const edit = mergeIntoPrevious(items, second.id)!;
    expect(edit.items.map((i) => i.text)).toEqual([
      "Done",
      "Salt,honey",
      "Later",
    ]);
    expect(edit).toMatchObject({ focusId: first.id, offset: 5 });
    expect(
      splitItem(edit.items, first.id, 5, 5).items.map((i) => i.text),
    ).toEqual(["Done", "Salt,", "honey", "Later"]);
    expect(mergeIntoPrevious(items, first.id)).toBeNull();
    expect(mergeIntoPrevious(items, doneLater.id)?.items[0].text).toBe(
      "DoneLater",
    );
    expect(
      mergeIntoPrevious([item("a".repeat(4999)), second], second.id),
    ).toBeNull();
  });
  it("pastes multi-line text as one item per line around the caret", () => {
    const [before, target, after] = [
      item("Before"),
      item("Start end", true),
      item("After"),
    ];
    const edit = pasteIntoItem(
      [before, target, after],
      target.id,
      6,
      6,
      "- one\n- two\n- three\n",
    )!;
    expect(edit.items.map((i) => i.text)).toEqual([
      "Before",
      "Start one",
      "two",
      "threeend",
      "After",
    ]);
    expect(edit.items[1]).toMatchObject({ id: target.id, done: true });
    expect(edit.items[3].done).toBe(false);
    expect(edit).toMatchObject({ focusId: edit.items[3].id, offset: 5 });
    expect(pasteIntoItem([target], target.id, 0, 0, "no break")).toBeNull();
    expect(
      pasteIntoItem([target], target.id, 0, 9, "\n\n")?.items.map(
        (i) => i.text,
      ),
    ).toEqual([""]);
  });
  it("keeps pasted items within the item length and count limits", () => {
    const target = item("");
    const long = "a".repeat(5003);
    const edit = pasteIntoItem([target], target.id, 0, 0, `x\n${long}`)!;
    expect(edit.items.map((i) => i.text.length)).toEqual([1, 5000, 3]);
    expect(edit).toMatchObject({ focusId: edit.items[2].id, offset: 3 });
    expect(
      noteSchema.safeParse({ ...makeNote(), items: edit.items }).success,
    ).toBe(true);
    const full = Array.from({ length: 999 }, () => item("x"));
    expect(pasteIntoItem(full, full[0].id, 1, 1, "a\nb")).not.toBeNull();
    expect(pasteIntoItem(full, full[0].id, 1, 1, "a\nb\nc")).toBeNull();
  });
  it("finds the text an input event inserted", () => {
    expect(textInsertion("Salt", "Sa\nlt")).toEqual({
      start: 2,
      end: 2,
      text: "\n",
    });
    expect(textInsertion("aXa", "aa\nba")).toEqual({
      start: 1,
      end: 2,
      text: "a\nb",
    });
    expect(textInsertion("", "one\ntwo")).toEqual({
      start: 0,
      end: 0,
      text: "one\ntwo",
    });
  });
});

// Compact list notation: "a" is top-level, ">b" nests, "a*" is checked.
function list(...specs: string[]): Item[] {
  let top: string | undefined;
  return specs.map((spec) => {
    const nested = spec.startsWith(">");
    const id = spec.replace(/[>*]/g, "");
    if (!nested) top = id;
    return {
      id,
      text: id,
      done: spec.endsWith("*"),
      ...(nested ? { parentId: top } : {}),
    };
  });
}
function show(items: Item[]) {
  return items.map(
    (i) => `${i.parentId ? ">" : ""}${i.text || "_"}${i.done ? "*" : ""}`,
  );
}

describe("nested list items", () => {
  it("keeps children right after their parent and fixes broken links", () => {
    const items = list("a", "b", ">c");
    // A child stranded away from its parent moves back under it.
    expect(show(normalizeItems([items[2], items[0], items[1]]))).toEqual([
      "a",
      "b",
      ">c",
    ]);
    // A child whose parent is gone joins the nearest top-level item above.
    expect(
      show(normalizeItems([...list("a"), { ...items[2], parentId: "gone" }])),
    ).toEqual(["a", ">c"]);
    // Only one level: a grandchild becomes a child of the top-level item.
    expect(
      show(
        normalizeItems([...list("a", ">b"), { ...items[2], parentId: "b" }]),
      ),
    ).toEqual(["a", ">b", ">c"]);
  });
  it("splits rows into unchecked and checked sections", () => {
    const { active, completed } = listRows(list("a", ">b*", ">c", "d*", ">e*"));
    expect(active.map((r) => [r.item.id, r.level])).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
    // b's parent is unchecked, so b shows top-level among the checked items.
    expect(completed.map((r) => [r.item.id, r.level])).toEqual([
      ["b", 0],
      ["d", 0],
      ["e", 1],
    ]);
  });
  it("moves a parent with its children and keeps checked items in place", () => {
    const items = list("a", ">a1", ">a2*", "x*", "b", ">b1");
    const moved = arrangeActive(items, [
      { id: "b", level: 0 },
      { id: "b1", level: 1 },
      { id: "a", level: 0 },
      { id: "a1", level: 1 },
    ]);
    // x keeps its slot; a's checked child stays in a's group.
    expect(show(moved)).toEqual(["b", ">b1", "x*", "a", ">a2*", ">a1"]);
  });
  it("drags a child out to the top level or into another group", () => {
    const items = list("a", ">a1", "b");
    expect(
      show(
        arrangeActive(items, [
          { id: "a", level: 0 },
          { id: "b", level: 0 },
          { id: "a1", level: 1 },
        ]),
      ),
    ).toEqual(["a", "b", ">a1"]);
    expect(
      show(
        arrangeActive(items, [
          { id: "a", level: 0 },
          { id: "b", level: 0 },
          { id: "a1", level: 0 },
        ]),
      ),
    ).toEqual(["a", "b", "a1"]);
  });
  it("indents under the item above and outdents with the siblings below", () => {
    const items = list("a", "b", "c");
    const indented = indentItem(items, "b", 1)!;
    expect(show(indented)).toEqual(["a", ">b", "c"]);
    expect(indentItem(items, "a", 1)).toBeNull();
    expect(indentItem(indented, "b", 1)).toBeNull();
    // A parent with children can't be nested itself.
    expect(indentItem(list("a", "b", ">b1"), "b", 1)).toBeNull();
    expect(show(indentItem(list("a", ">b", ">c", ">d"), "c", 0)!)).toEqual([
      "a",
      ">b",
      "c",
      ">d",
    ]);
  });
  it("drops a dragged item or group where it can land", () => {
    const items = list("a", ">a1", ">a2", "b", "c");
    // b moved between a1 and a2 joins a's group.
    expect(show(moveItem(items, "b", 2, 0)!)).toEqual([
      "a",
      ">a1",
      ">b",
      ">a2",
      "c",
    ]);
    // c dropped above b and moved right nests in a's group.
    expect(show(moveItem(items, "c", 3, 1)!)).toEqual([
      "a",
      ">a1",
      ">a2",
      ">c",
      "b",
    ]);
    // Group a moved down one spot lands after b, children and all.
    expect(show(moveItem(items, "a", 1, 0)!)).toEqual([
      "b",
      "a",
      ">a1",
      ">a2",
      "c",
    ]);
    // A group dropped inside another group snaps past it.
    const two = list("a", ">a1", ">a2", "b", ">b1");
    expect(show(moveItem(two, "b", 1, 0)!)).toEqual([
      "b",
      ">b1",
      "a",
      ">a1",
      ">a2",
    ]);
    expect(show(moveItem(two, "a", 1, 0)!)).toEqual([
      "b",
      ">b1",
      "a",
      ">a1",
      ">a2",
    ]);
    // A parent can't be nested, and nothing nests above the first row.
    expect(moveItem(two, "b", 3, 1)).toBeNull();
    expect(show(moveItem(items, "a1", 0, 1)!).slice(0, 2)).toEqual(["a1", "a"]);
  });
  it("checks a group together and brings a parent back with its child", () => {
    const items = list("a", ">b", ">c");
    expect(show(toggleItem(items, "a"))).toEqual(["a*", ">b*", ">c*"]);
    expect(show(toggleItem(items, "b"))).toEqual(["a", ">b*", ">c"]);
    const checked = toggleItem(items, "a");
    expect(show(toggleItem(checked, "c"))).toEqual(["a", ">b*", ">c"]);
    expect(show(toggleItem(checked, "a"))).toEqual(["a", ">b", ">c"]);
  });
  it("trims only empty unchecked items at the end of the list", () => {
    const blank = (id: string, extra: Partial<Item> = {}): Item => ({
      id,
      text: "",
      done: false,
      ...extra,
    });
    const items = [
      ...list("a"),
      blank("e1"),
      ...list("b", "c*"),
      blank("e2"),
      blank("e3", { text: "  ", parentId: "b" }),
      blank("e4", { done: true }),
    ];
    expect(show(trimTrailingEmpty(items))).toEqual(["a", "_", "b", "c*", "_*"]);
    const full = list("a", "b");
    expect(trimTrailingEmpty(full)).toBe(full);
  });
  it("keeps new items from Enter and paste in the same group", () => {
    const items = list("a", ">b");
    expect(show(splitItem(items, "b", 1, 1).items)).toEqual(["a", ">b", ">_"]);
    // Enter on a parent starts its first child rather than stealing children.
    expect(show(splitItem(items, "a", 1, 1).items)).toEqual(["a", ">_", ">b"]);
    expect(
      show(pasteIntoItem(items, "b", 1, 1, "x\ny")!.items).slice(1),
    ).toEqual([">bx", ">y"]);
    // Backspace at the start of a parent merges it up; its children follow.
    const merged = mergeIntoPrevious(list("a", ">b", "c", ">d"), "c")!;
    expect(show(merged.items)).toEqual(["a", ">bc", ">d"]);
  });
  it("accepts a parent link in saved notes", () => {
    const note = makeNote();
    const [parent, child] = [crypto.randomUUID(), crypto.randomUUID()];
    note.items = [
      { id: parent, text: "Fruit", done: false },
      { id: child, text: "Apples", done: false, parentId: parent },
    ];
    expect(noteSchema.safeParse(note).success).toBe(true);
    expect(
      noteSchema.safeParse({
        ...note,
        items: [{ ...note.items[1], parentId: "not-a-uuid" }],
      }).success,
    ).toBe(false);
  });
});

import { z } from "zod";

export const priorities = ["low", "medium", "high", "critical"] as const;
export const colorPalette = [
  { name: "Charcoal", color: "#24272b" },
  { name: "Ochre", color: "#403923" },
  { name: "Forest", color: "#203b33" },
  { name: "Denim", color: "#24384a" },
  { name: "Rose", color: "#452b34" },
  { name: "Plum", color: "#372e46" },
  { name: "Graphite", color: "#30353b" },
  { name: "Terracotta", color: "#4b3028" },
  { name: "Copper", color: "#503921" },
  { name: "Olive", color: "#3d4023" },
  { name: "Moss", color: "#2f462a" },
  { name: "Teal", color: "#204849" },
  { name: "Ocean", color: "#203f50" },
  { name: "Indigo", color: "#2c3050" },
  { name: "Berry", color: "#492345" },
];
const itemTextLimit = 5000;
const maxItems = 1000;
export const colors = colorPalette.map(({ color }) => color);
const legacyColors = [
  "#ffffff",
  "#fff3b8",
  "#dff3e7",
  "#dfedfa",
  "#fbe2e7",
  "#eee5f7",
  "#e9edef",
];
// Light-theme palette colors map to their dark replacements; custom colors
// show exactly as picked.
export function noteColor(hex: string) {
  const normalized = hex.toLowerCase();
  const legacyIndex = legacyColors.indexOf(normalized);
  return legacyIndex === -1 ? normalized : colors[legacyIndex];
}
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  });
export const noteSchema = z.object({
  id: z.uuid(),
  title: z.string().max(300),
  content: z.string().max(100000),
  kind: z.enum(["list", "text"]),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        text: z.string().max(itemTextLimit),
        done: z.boolean(),
        // Set on nested items: the top-level item they sit under.
        parentId: z.uuid().optional(),
      }),
    )
    .max(maxItems),
  pinned: z.boolean(),
  status: z.enum(["active", "archived", "trashed"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  priority: z.enum(priorities),
  dueDate: dateOnly.nullable(),
  showCompleted: z.boolean(),
  // Older notes and older app versions don't send this, so it defaults off.
  collapsed: z.boolean().default(false),
  version: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().nullable(),
});
export type Note = z.infer<typeof noteSchema>;
export type View = Note["status"];
export type NoteView = View | Note["priority"] | "due-soon" | "past-due";
export type Item = Note["items"][number];
export function makeNote(): Note {
  return {
    id: crypto.randomUUID(),
    title: "",
    content: "",
    kind: "list",
    items: [],
    pinned: false,
    status: "active",
    color: colors[0],
    priority: "medium",
    dueDate: null,
    showCompleted: true,
    collapsed: false,
    version: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  };
}
export function sortNotes(notes: Note[]) {
  return [...notes].sort(
    (a, b) =>
      priorities.indexOf(b.priority) - priorities.indexOf(a.priority) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id),
  );
}
export function dueStatus(value: string | null, now = new Date()) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  const days = Math.round(
    (Date.UTC(y, m - 1, d) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000,
  );
  if (days < 0)
    return {
      tone: "overdue",
      label: days === -1 ? "Yesterday" : `${-days} days overdue`,
    };
  if (days === 0) return { tone: "soon", label: "Today" };
  if (days === 1) return { tone: "soon", label: "Tomorrow" };
  return {
    tone: days <= 3 ? "soon" : "later",
    label: new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(y !== now.getFullYear() ? { year: "numeric" } : {}),
    }),
  };
}
export function dueAttention(note: Note, now = new Date()) {
  if (
    note.status !== "active" ||
    (note.kind === "list" && !note.items.some((item) => !item.done))
  )
    return null;
  const tone = dueStatus(note.dueDate, now)?.tone;
  return tone === "soon" || tone === "overdue" ? tone : null;
}
export function matchesNoteView(note: Note, view: NoteView, now = new Date()) {
  if (view === "active" || view === "archived" || view === "trashed") {
    return note.status === view;
  }
  if (note.status !== "active") return false;
  if (view === "due-soon") return dueAttention(note, now) === "soon";
  if (view === "past-due") return dueAttention(note, now) === "overdue";
  return note.priority === view;
}
export function inkColor(hex: string) {
  const values = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722 > 0.179
    ? "#24272b"
    : "#e7e9ec";
}
export function convertNote(note: Note, kind: Note["kind"]): Note | null {
  if (kind === note.kind) return note;
  const candidate =
    kind === "text"
      ? {
          ...note,
          kind,
          content: note.items.map((i) => i.text).join("\n"),
          items: [],
        }
      : {
          ...note,
          kind,
          content: "",
          items: note.content
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => chunkText(line).map(newItem)),
        };
  return noteSchema.safeParse(candidate).success ? candidate : null;
}
function newItem(text: string): Item {
  return { id: crypto.randomUUID(), text, done: false };
}
function chunkText(text: string) {
  const chunks: string[] = [];
  let start = 0;
  do chunks.push(text.slice(start, (start += itemTextLimit)));
  while (start < text.length);
  return chunks;
}
// One checklist line per non-blank line, without the bullet, number, or
// checkbox marker that text copied from another list usually carries.
export function listLines(text: string) {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+•◦▪‣]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s+)?/, "")
        .trim(),
    )
    .filter(Boolean);
}
export type ItemRow = { item: Item; level: 0 | 1 };
export function withParent(item: Item, parentId: string | undefined): Item {
  const { parentId: _old, ...rest } = item;
  return parentId ? { ...rest, parentId } : rest;
}
// One level of nesting: each child follows its top-level parent. A child whose
// parent is missing or nested itself joins the nearest top-level item above.
export function normalizeItems(items: Item[]): Item[] {
  const topLevel = new Set(items.filter((i) => !i.parentId).map((i) => i.id));
  const children = new Map<string, Item[]>();
  const order: Item[] = [];
  let lastTop: string | undefined;
  for (const item of items) {
    const parentId =
      item.parentId && item.parentId !== item.id && topLevel.has(item.parentId)
        ? item.parentId
        : item.parentId
          ? lastTop
          : undefined;
    if (!parentId) {
      lastTop = item.id;
      order.push(withParent(item, undefined));
    } else {
      const fixed = withParent(item, parentId);
      children.set(parentId, [...(children.get(parentId) ?? []), fixed]);
    }
  }
  return order.flatMap((item) => [item, ...(children.get(item.id) ?? [])]);
}
// Unchecked rows in display order, then checked ones. A child shows nested
// only when its parent is in the same section.
export function listRows(items: Item[]) {
  const normalized = normalizeItems(items);
  const byId = new Map(normalized.map((i) => [i.id, i]));
  const rows = (done: boolean) =>
    normalized
      .filter((i) => i.done === done)
      .map((item): ItemRow => ({
        item,
        level: item.parentId && byId.get(item.parentId)!.done === done ? 1 : 0,
      }));
  return { active: rows(false), completed: rows(true) };
}
// Rebuilds the list from a new order and nesting of the unchecked rows. A row
// at level 1 nests under the nearest top-level row above it. Checked items
// keep their slots; only a checked child moves, to stay with its parent.
export function arrangeActive(
  items: Item[],
  rows: { id: string; level: number }[],
): Item[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  let top: string | undefined;
  const next = rows.map(({ id, level }) => {
    const parentId = level && top ? top : undefined;
    if (!parentId) top = id;
    return withParent(byId.get(id)!, parentId);
  });
  let slot = 0;
  return normalizeItems(items.map((i) => (i.done ? i : next[slot++])));
}
export function hasChildren(items: Item[], id: string) {
  return items.some((i) => i.parentId === id);
}
// Tab nests an item under the top-level item above it; Shift+Tab lifts it back
// out, taking the siblings below it along as its own children. Items that
// already have children stay top-level. Returns null when nothing changes.
export function indentItem(
  items: Item[],
  id: string,
  level: 0 | 1,
): Item[] | null {
  const rows = listRows(items).active;
  const index = rows.findIndex((r) => r.item.id === id);
  if (index === -1 || rows[index].level === level) return null;
  if (level === 1 && (index === 0 || hasChildren(items, id))) return null;
  return arrangeActive(
    items,
    rows.map((r, i) => ({
      id: r.item.id,
      level: i === index ? level : r.level,
    })),
  );
}
// The unchecked rows a drag picks up: an item, plus its children if it's a
// parent, so a group always moves together.
export function dragBlock(rows: ItemRow[], id: string) {
  const from = rows.findIndex((r) => r.item.id === id);
  let size = 1;
  if (rows[from].level === 0) while (rows[from + size]?.level === 1) size++;
  return { from, size };
}
// Where a dragged block lands. `to` counts the other rows above the drop
// point. A group can't land inside another group, so it snaps past the group
// in the direction it was moving. A single item dropped inside a group joins
// it, and an item with children always stays top-level.
export function dropTarget(
  items: Item[],
  id: string,
  to: number,
  level: 0 | 1,
): { to: number; level: 0 | 1 } {
  const rows = listRows(items).active;
  const { from, size } = dragBlock(rows, id);
  const others = [...rows.slice(0, from), ...rows.slice(from + size)];
  if (hasChildren(items, id)) {
    if (others[to]?.level === 1) {
      if (to > from) while (others[to]?.level === 1) to++;
      else {
        while (others[to - 1]?.level === 1) to--;
        to--;
      }
    }
    return { to, level: 0 };
  }
  if (to === 0) return { to, level: 0 };
  return { to, level: others[to]?.level === 1 ? 1 : level };
}
// Applies a drop from dropTarget; null when the list would not change.
export function moveItem(
  items: Item[],
  id: string,
  to: number,
  level: 0 | 1,
): Item[] | null {
  const rows = listRows(items).active;
  const { from, size } = dragBlock(rows, id);
  const target = dropTarget(items, id, to, level);
  if (target.to === from && target.level === rows[from].level) return null;
  const block = rows.slice(from, from + size).map((r, i) => ({
    id: r.item.id,
    level: i === 0 ? target.level : r.level,
  }));
  const others = [...rows.slice(0, from), ...rows.slice(from + size)].map(
    (r) => ({ id: r.item.id, level: r.level }),
  );
  others.splice(target.to, 0, ...block);
  return arrangeActive(items, others);
}
// Checking a parent checks its children too. Unchecking a child brings its
// parent back, so the child returns to its group.
export function toggleItem(items: Item[], id: string): Item[] {
  const item = items.find((i) => i.id === id)!;
  const done = !item.done;
  return items.map((i) =>
    i.id === id || (!item.parentId && i.parentId === id)
      ? { ...i, done }
      : !done && i.id === item.parentId
        ? { ...i, done: false }
        : i,
  );
}
// Empty unchecked items left at the bottom of the list, dropped when the
// editor closes.
export function trimTrailingEmpty(items: Item[]): Item[] {
  const active = listRows(items).active;
  const drop = new Set<string>();
  for (let i = active.length - 1; i >= 0 && !active[i].item.text.trim(); i--)
    drop.add(active[i].item.id);
  return drop.size ? items.filter((i) => !drop.has(i.id)) : items;
}
// The nesting for an item inserted right after `item`: it stays in the same
// group, or starts one under a parent that already has children.
function siblingParent(items: Item[], item: Item) {
  return item.parentId ?? (hasChildren(items, item.id) ? item.id : undefined);
}
export type ItemEdit = { items: Item[]; focusId: string; offset: number };
// Enter moves the text after the caret into a new item below.
export function splitItem(
  items: Item[],
  id: string,
  start: number,
  end: number,
): ItemEdit {
  const index = items.findIndex((i) => i.id === id);
  const item = items[index];
  const next = withParent(
    newItem(item.text.slice(end).trimStart()),
    siblingParent(items, item),
  );
  return {
    items: [
      ...items.slice(0, index),
      { ...item, text: item.text.slice(0, start).trimEnd() },
      next,
      ...items.slice(index + 1),
    ],
    focusId: next.id,
    offset: 0,
  };
}
// Backspace at the start of an item joins it onto the end of the item shown
// above it (checked and unchecked items are listed separately).
export function mergeIntoPrevious(items: Item[], id: string): ItemEdit | null {
  const index = items.findIndex((i) => i.id === id);
  const item = items[index];
  const previous = items
    .slice(0, index)
    .reverse()
    .find((i) => i.done === item.done);
  if (!previous || previous.text.length + item.text.length > itemTextLimit)
    return null;
  return {
    items: normalizeItems(
      items
        .filter((i) => i.id !== id)
        .map((i) =>
          i.id === previous.id ? { ...i, text: i.text + item.text } : i,
        ),
    ),
    focusId: previous.id,
    offset: previous.text.length,
  };
}
// Multi-line text pasted into an item becomes one item per line; returns null
// for single-line text (or too many lines) so the paste happens normally.
export function pasteIntoItem(
  items: Item[],
  id: string,
  start: number,
  end: number,
  pasted: string,
): ItemEdit | null {
  if (!/[\r\n]/.test(pasted)) return null;
  const index = items.findIndex((i) => i.id === id);
  const item = items[index];
  const lines = listLines(pasted);
  const texts = [
    item.text.slice(0, start) + (lines[0] ?? ""),
    ...lines.slice(1),
  ];
  const caret = texts[texts.length - 1].length;
  texts[texts.length - 1] += item.text.slice(end);
  const chunks = texts.map(chunkText);
  const [first, ...rest] = chunks.flat();
  if (items.length + rest.length > maxItems) return null;
  const parentId = siblingParent(items, item);
  const replaced = [
    { ...item, text: first },
    ...rest.map((text) => withParent(newItem(text), parentId)),
  ];
  const lastChunks = chunks[chunks.length - 1].length;
  const caretChunk = Math.min(
    Math.floor(caret / itemTextLimit),
    lastChunks - 1,
  );
  return {
    items: [...items.slice(0, index), ...replaced, ...items.slice(index + 1)],
    focusId: replaced[replaced.length - lastChunks + caretChunk].id,
    offset: caret - caretChunk * itemTextLimit,
  };
}
// The range of `before` that an edit replaced, and the text it inserted.
export function textInsertion(before: string, after: string) {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let end = before.length;
  let to = after.length;
  while (end > start && to > start && before[end - 1] === after[to - 1]) {
    end--;
    to--;
  }
  return { start, end, text: after.slice(start, to) };
}

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
export function darkNoteColor(hex: string) {
  const normalized = hex.toLowerCase();
  const legacyIndex = legacyColors.indexOf(normalized);
  if (legacyIndex !== -1) return colors[legacyIndex];
  // Keep custom hues, but cap their brightness for the permanent dark theme.
  const channels = [1, 3, 5].map((i) =>
    parseInt(normalized.slice(i, i + 2), 16),
  );
  const scale = Math.min(1, 80 / Math.max(...channels));
  return `#${channels
    .map((value) =>
      Math.round(value * scale)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
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
      z.object({ id: z.uuid(), text: z.string().max(5000), done: z.boolean() }),
    )
    .max(1000),
  pinned: z.boolean(),
  status: z.enum(["active", "archived", "trashed"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  priority: z.enum(priorities),
  dueDate: dateOnly.nullable(),
  showCompleted: z.boolean(),
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
            .flatMap((line) => {
              const chunks: Item[] = [];
              for (let start = 0; start < line.length; start += 5000)
                chunks.push({
                  id: crypto.randomUUID(),
                  text: line.slice(start, start + 5000),
                  done: false,
                });
              return chunks;
            }),
        };
  return noteSchema.safeParse(candidate).success ? candidate : null;
}

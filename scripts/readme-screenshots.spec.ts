// Regenerates the README screenshots with demo notes: npm run screenshots
import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { colorPalette, makeNote, type Item, type Note } from "../shared/notes";

const color = (name: string) =>
  colorPalette.find((c) => c.name === name)!.color;
// An item starting with ">" nests under the item above it.
const list = (
  title: string,
  items: string[],
  done: string[],
  patch: Partial<Note> = {},
): Note => {
  let top: string | undefined;
  const item = (text: string, checked: boolean): Item => {
    const id = crypto.randomUUID();
    if (!text.startsWith(">")) top = id;
    return {
      id,
      text: text.replace(/^>/, ""),
      done: checked,
      ...(text.startsWith(">") ? { parentId: top } : {}),
    };
  };
  return {
    ...makeNote(),
    title,
    version: 1,
    items: [
      ...items.map((text) => item(text, false)),
      ...done.map((text) => item(text, true)),
    ],
    ...patch,
  };
};
const text = (title: string, content: string, patch: Partial<Note> = {}) => ({
  ...makeNote(),
  title,
  kind: "text" as const,
  content,
  version: 1,
  ...patch,
});

// The clock is fixed to Thursday 2026-09-24, so due badges always read the same.
const notes: Note[] = [
  list(
    "This week",
    [
      "Send the quarterly report",
      "Book a dentist appointment",
      "Renew the car registration",
    ],
    ["Pick up the dry cleaning"],
    {
      pinned: true,
      color: color("Ochre"),
      priority: "high",
      dueDate: "2026-09-24",
    },
  ),
  list(
    "Trip to Kyoto",
    [
      "Book a ryokan near Gion",
      "Pack",
      ">Rain jacket",
      ">Walking shoes",
      "Buy a rail pass",
      "Fall foliage forecast https://www.japan-guide.com/sp/autumn/",
    ],
    ["Renew passport", "Request time off"],
    { pinned: true, color: color("Teal"), dueDate: "2026-10-12" },
  ),
  list(
    "Home repairs",
    ["Fix the dripping kitchen tap", "Replace smoke alarm batteries"],
    ["Order a new furnace filter"],
    {
      color: color("Terracotta"),
      priority: "critical",
      dueDate: "2026-09-22",
    },
  ),
  list(
    "Groceries",
    ["Oat milk", "Sourdough", "Lemons", "Coffee beans", "Basil"],
    ["Eggs", "Spinach"],
    { color: color("Forest"), priority: "low" },
  ),
  text(
    "Blog post idea",
    "Small tools that do one thing well.\n\nWhy a notes app with no accounts, no sidebar, and no sync conflicts to babysit is the one I actually open every day.",
    { color: color("Plum") },
  ),
  list(
    "Reading list",
    ["The Design of Everyday Things", "A Philosophy of Software Design"],
    ["Designing Data-Intensive Applications"],
    { color: color("Denim"), priority: "low" },
  ),
  text(
    "Garden",
    "Plant garlic before the first frost. Move the rosemary somewhere sunnier.",
    { color: color("Moss"), dueDate: "2026-10-20" },
  ),
];

async function open(page: Page, width: number, height: number) {
  await page.clock.setFixedTime(new Date("2026-09-24T17:00:00"));
  await page.setViewportSize({ width, height });
  await page.route("**/api/notes", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { notes, noteWidth: 300 } })
      : route.continue(),
  );
  await page.goto("/");
  await expect(page.locator("article")).toHaveCount(notes.length);
  await expect(page.getByRole("status", { name: "All saved" })).toBeVisible();
  await page.mouse.move(0, 0);
}
async function save(page: Page, name: string) {
  const png = await page.screenshot();
  await sharp(png)
    .png({ compressionLevel: 9 })
    .toFile(`docs/screenshots/${name}.png`);
}
async function openEditor(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await expect(editor).toBeVisible();
  // Show the drag handle on one row, as when hovering with a mouse.
  await editor.locator(".editor-item").nth(1).hover();
  return editor;
}

test.use({ colorScheme: "dark" });

test("desktop", async ({ page }) => {
  await open(page, 1280, 760);
  await save(page, "workspace");
  await openEditor(page, "Trip to Kyoto");
  await save(page, "editor");
});

test("mobile", async ({ browser }) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await open(page, 390, 844);
  await save(page, "mobile");
  await openEditor(page, "This week");
  await save(page, "mobile-editor");
  await context.close();
});

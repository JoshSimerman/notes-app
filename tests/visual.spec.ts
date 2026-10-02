import { test, expect } from "@playwright/test";
import { makeNote, type Note } from "../shared/notes";

test("desktop and mobile workspace with representative notes", async ({
  page,
}) => {
  const list = (
    title: string,
    items: string[],
    patch: Partial<Note> = {},
  ): Note => ({
    ...makeNote(),
    title,
    version: 1,
    items: items.map((text, i) => ({
      id: crypto.randomUUID(),
      text,
      done: i === items.length - 1,
    })),
    ...patch,
  });
  const notes = [
    list(
      "This week",
      [
        "Send the proposal",
        "Book a dentist appointment",
        "Water the plants",
        "Pick up the parcel",
      ],
      {
        pinned: true,
        color: "#fff3b8",
        priority: "high",
        dueDate: new Date().toISOString().slice(0, 10),
      },
    ),
    {
      ...makeNote(),
      title: "A thought to keep",
      kind: "text" as const,
      content:
        "Make room for the things that matter.\n\nA slower morning. A good conversation. A little time outside.",
      pinned: true,
      color: "#dff3e7",
      version: 1,
    },
    list(
      "Weekend away",
      [
        "Find a place near the coast",
        "Save a few walking routes",
        "Charge the camera",
      ],
      { color: "#dfedfa" },
    ),
    list("At the market", [
      "Avocados",
      "Sourdough",
      "Lemons",
      "Coffee beans",
      "Fresh flowers",
    ]),
    {
      ...makeNote(),
      title: "The next small project",
      kind: "text" as const,
      content:
        "A shelf for the records.\n\nMeasure the corner by the window, then find some wood with a little character.",
      color: "#eee5f7",
      version: 1,
    },
    list(
      "Before Friday",
      [
        "Review the final draft",
        "Send notes to the team",
        "Set aside an hour to think",
      ],
      { color: "#fbe2e7", priority: "critical" },
    ),
    {
      ...makeNote(),
      title: "Good places",
      kind: "text" as const,
      content:
        "The little cafe on the corner.\nThe quiet beach after the bend.\nThe bookshop with the blue door.",
      color: "#ffffff",
      version: 1,
    },
  ];
  await page.route("**/api/notes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ notes, noteWidth: 280 }),
    }),
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.locator("article")).toHaveCount(notes.length);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: "test-results/settings-desktop.png" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "This week", exact: true }).click();
  await page.screenshot({ path: "test-results/editor-mobile.png" });
  await page.getByLabel("Note color", { exact: true }).click();
  await page.screenshot({ path: "test-results/colors-mobile.png" });
});

test("short notes fill the gap under shorter columns", async ({ page }) => {
  // Newest first, so createdAt fixes the order: Hardware store comes last.
  const list = (title: string, count: number, createdAt: number): Note => ({
    ...makeNote(),
    title,
    createdAt,
    version: 1,
    items: Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      text: `${title} ${i + 1}`,
      done: false,
    })),
  });
  const notes = [
    list("Packing", 7, 4),
    list("Reading", 12, 3),
    list("Chores", 13, 2),
    list("Hardware store", 1, 1),
  ];
  await page.route("**/api/notes", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ notes, noteWidth: 300 }),
    }),
  );
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto("/");
  const card = (title: string) =>
    page.locator("article").filter({ hasText: title }).first();
  await expect(page.locator("article")).toHaveCount(4);
  const packing = (await card("Packing").boundingBox())!;
  const reading = (await card("Reading").boundingBox())!;
  const hardware = (await card("Hardware store").boundingBox())!;
  expect(hardware.x).toBe(packing.x);
  expect(hardware.y).toBeLessThan(reading.y + reading.height);
  expect(hardware.y - (packing.y + packing.height)).toBeGreaterThanOrEqual(18);
  expect(hardware.y - (packing.y + packing.height)).toBeLessThan(18 + 4);
  await page.screenshot({ path: "test-results/masonry-desktop.png" });
});

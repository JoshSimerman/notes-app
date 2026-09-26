import { test, expect } from "@playwright/test";
import { makeNote, type Note } from "../shared/notes";

test.use({ timezoneId: "Pacific/Honolulu" });
const headers = { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" };

test("priority and due filters, live warnings, and 15 persisted color choices", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-24T22:00:00Z"));
  await page.goto("/");
  await expect(page.locator(".new-note")).toBeEnabled();
  const prefix = "Filter fixture ";
  const list = (title: string, patch: Partial<Note> = {}): Note => ({
    ...makeNote(),
    title: prefix + title,
    items: [
      { id: crypto.randomUUID(), text: prefix + title + " task", done: false },
    ],
    ...patch,
  });
  const notes = [
    list("Low", { priority: "low" }),
    list("Today", { dueDate: "2026-09-24", pinned: true }),
    list("Third day", { priority: "high", dueDate: "2026-09-27" }),
    list("Overdue", {
      priority: "critical",
      dueDate: "2026-09-23",
      pinned: true,
    }),
    list("Finished", {
      dueDate: "2026-09-23",
      items: [{ id: crypto.randomUUID(), text: "Already done", done: true }],
    }),
    list("Archived", {
      status: "archived",
      priority: "high",
      dueDate: "2026-09-23",
    }),
    list("Trashed", {
      status: "trashed",
      priority: "critical",
      dueDate: "2026-09-23",
    }),
    list("Text reminder", {
      kind: "text",
      items: [],
      content: "Call tomorrow",
      dueDate: "2026-09-25",
    }),
    list("Fourth day", { priority: "low", dueDate: "2026-09-28" }),
    list("Empty", { items: [], dueDate: "2026-09-23" }),
  ];
  for (const note of notes) {
    const response = await page.request.put(`/api/notes/${note.id}`, {
      headers,
      data: { note, mutationId: crypto.randomUUID() },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  const nav = page.getByRole("navigation", { name: "Notes views" });
  const cards = page.locator("article").filter({ hasText: prefix });
  await expect(cards).toHaveCount(8);
  await expect(nav.getByRole("button", { name: /^Due Soon/ })).toHaveText(
    "Due Soon3",
  );
  await expect(nav.getByRole("button", { name: /^Past Due/ })).toHaveText(
    "Past Due1",
  );
  for (const [name, count] of [
    ["Low", 2],
    ["Med", 4],
    ["High", 1],
    ["Crit", 1],
  ] as const) {
    await nav.getByRole("button", { name, exact: true }).click();
    await expect(cards).toHaveCount(count);
    await expect(
      nav.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
  await nav.getByRole("button", { name: /^Due Soon/ }).click();
  await expect(cards).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "Pinned", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search notes").fill("Third day");
  await expect(cards).toHaveCount(1);
  await expect(nav.getByRole("button", { name: /^Due Soon/ })).toHaveText(
    "Due Soon3",
  );
  await nav.getByRole("button", { name: /^Past Due/ }).click();
  await expect(cards).toHaveCount(1);
  await cards.getByRole("checkbox").click();
  await expect(cards).toHaveCount(0);
  await expect(nav.getByRole("button", { name: /^Past Due/ })).toHaveText(
    "Past Due0",
  );
  await expect(page.getByRole("status", { name: "All saved" })).toBeVisible();
  await nav.getByRole("button", { name: /^All Notes/ }).click();
  const overdue = cards.filter({ hasText: prefix + "Overdue" });
  await overdue.getByRole("checkbox").click();
  await expect(nav.getByRole("button", { name: /^Past Due/ })).toHaveText(
    "Past Due1",
  );
  await overdue
    .getByRole("button", { name: "Archive note", exact: true })
    .click();
  await expect(nav.getByRole("button", { name: /^Past Due/ })).toHaveText(
    "Past Due0",
  );
  await nav.getByRole("button", { name: /^Archive/ }).click();
  await expect(cards).toHaveCount(2);
  await overdue
    .getByRole("button", { name: "Unarchive note", exact: true })
    .click();
  await expect(nav.getByRole("button", { name: /^Past Due/ })).toHaveText(
    "Past Due1",
  );
  await nav.getByRole("button", { name: /^Trash/ }).click();
  await expect(cards).toHaveCount(1);
  await nav.getByRole("button", { name: /^All Notes/ }).click();
  await page.getByRole("button", { name: prefix + "Low", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await editor.getByLabel("Note color", { exact: true }).click();
  await expect(editor.locator(".swatches button")).toHaveCount(15);
  await editor.getByRole("button", { name: "Berry", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await page.reload();
  await page.getByRole("button", { name: prefix + "Low", exact: true }).click();
  await editor.getByLabel("Note color", { exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Berry", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.screenshot({ path: "test-results/palette-mobile.png" });
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await nav.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].left).toBeGreaterThanOrEqual(0);
      expect(boxes[i].right).toBeLessThanOrEqual(width);
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          boxes[i].right <= boxes[j].left ||
            boxes[j].right <= boxes[i].left ||
            boxes[i].bottom <= boxes[j].top ||
            boxes[j].bottom <= boxes[i].top,
        ).toBeTruthy();
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({ path: `test-results/filters-${width}.png` });
  }
});

test("due warnings cross local midnight without a reload", async ({ page }) => {
  const note = {
    ...makeNote(),
    title: "Midnight reminder",
    kind: "text",
    dueDate: "2026-09-24",
  };
  await page.clock.install({ time: new Date("2026-09-25T09:59:30Z") });
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [note], noteWidth: 300 } }),
  );
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Notes views" });
  await expect(nav.getByRole("button", { name: /^Due Soon/ })).toHaveText(
    "Due Soon1",
  );
  await expect(nav.getByRole("button", { name: /^Past Due/ })).toHaveText(
    "Past Due0",
  );
  await nav.getByRole("button", { name: /^Due Soon/ }).click();
  await page.clock.fastForward(61000);
  await expect(nav.getByRole("button", { name: /^Past Due/ })).toHaveText(
    "Past Due1",
  );
  await expect(nav.getByRole("button", { name: /^Due Soon/ })).toHaveText(
    "Due Soon0",
  );
  await expect(page.locator("article")).toHaveCount(0);
  await nav.getByRole("button", { name: /^Past Due/ }).click();
  await expect(
    page.getByRole("button", { name: "Midnight reminder", exact: true }),
  ).toBeVisible();
});

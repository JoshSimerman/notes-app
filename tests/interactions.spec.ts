import { test, expect, type Page } from "@playwright/test";
import { makeNote } from "../shared/notes";

async function workspace(page: Page) {
  const prefix = `Interactions ${crypto.randomUUID().slice(0, 8)}`;
  const older = `${prefix} older`;
  const newer = `${prefix} newer`;
  await page.goto("/");
  await expect(page.locator(".new-note")).toBeEnabled();
  for (const title of [older, newer]) {
    const note = {
      ...makeNote(),
      title,
      items: [
        { id: crypto.randomUUID(), text: "A task to finish", done: false },
      ],
    };
    const response = await page.request.put(`/api/notes/${note.id}`, {
      headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
      data: { note, mutationId: crypto.randomUUID() },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByLabel("Search notes").fill(prefix);
  await expect(page.locator("article")).toHaveCount(2);
  return {
    prefix,
    older,
    newer,
    card: page.locator("article").filter({
      has: page.getByRole("button", { name: older, exact: true }),
    }),
  };
}

test("only the checkbox toggles a task; autosave and reload preserve note order", async ({
  page,
}) => {
  const { card, prefix, older, newer } = await workspace(page);
  const titles = page.locator("article .note-title");
  const original = await titles.allTextContents();
  expect(original).toEqual([newer, older]);
  const checkbox = card.getByRole("checkbox");
  const box = await checkbox.boundingBox();
  expect(box).not.toBeNull();
  // A near miss beside the checkbox opens the note like the rest of the card,
  // but never checks the item.
  await page.mouse.click(box!.x + box!.width + 3, box!.y + box!.height / 2);
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await expect(editor).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.locator(".check-row > span").click();
  await expect(editor.getByRole("checkbox")).not.toBeChecked();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await checkbox.check();
  await expect(page.locator(".sync-status")).toHaveAttribute(
    "aria-label",
    "All saved",
  );
  await expect(checkbox).toBeChecked();
  await expect(titles).toHaveText(original);
  await page.reload();
  await page.getByLabel("Search notes").fill(prefix);
  await expect(titles).toHaveText(original);
  await expect(checkbox).toBeChecked();
});

test("priority is a persistent one-click choice on cards and in the editor", async ({
  page,
}) => {
  const { card, older } = await workspace(page);
  const picker = card.getByRole("group", { name: "Priority", exact: true });
  await expect(
    picker.getByRole("button", { name: "Medium priority" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Low", "High", "Critical", "Medium"]) {
    await picker.getByRole("button", { name: `${name} priority` }).click();
    await expect(
      picker.getByRole("button", { name: `${name} priority` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await picker.getByRole("button", { name: "Medium priority" }).click();
  await expect(
    picker.getByRole("button", { name: "Medium priority" }),
  ).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "Critical priority" }).click();
  await expect(page.locator(".sync-status")).toHaveAttribute(
    "aria-label",
    "All saved",
  );
  await expect(page.locator("article .note-title").first()).toHaveText(older);
  await card.locator(".note-title").click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await expect(
    editor.getByRole("button", { name: "Critical priority" }),
  ).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("button", { name: "High priority" }).click();
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    picker.getByRole("button", { name: "High priority" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 320, height: 720 });
  // On a phone, search opens from its icon and takes over the top row.
  await expect(page.getByLabel("Search notes")).toBeHidden();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByLabel("Search notes")).toBeFocused();
  await page.getByLabel("Search notes").fill(older);
  await page.screenshot({
    path: "test-results/priority-mobile-card.png",
    fullPage: true,
  });
  await card.locator(".note-title").click();
  await expect(
    editor.getByRole("button", { name: "High priority" }),
  ).toBeVisible();
  expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/priority-mobile-editor.png",
    fullPage: true,
  });
});

test("list items reorder by dragging the handle or with arrow keys", async ({
  page,
}) => {
  const title = `Reorder ${crypto.randomUUID().slice(0, 8)}`;
  const item = (text: string, done = false) => ({
    id: crypto.randomUUID(),
    text,
    done,
  });
  const note = {
    ...makeNote(),
    title,
    items: [item("Alpha"), item("Done", true), item("Bravo"), item("Charlie")],
  };
  await page.goto("/");
  const response = await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const saved = async () =>
    (
      (await (await page.request.get("/api/notes")).json()).notes.find(
        (n: { id: string }) => n.id === note.id,
      ).items as { text: string }[]
    ).map((i) => i.text);
  const handles = editor.locator(".drag-handle");
  await expect(handles).toHaveCount(3);

  const from = (await handles.nth(0).boundingBox())!;
  const below = (await editor
    .locator(".editor-item")
    .filter({ has: page.getByRole("button", { name: "Reorder Charlie" }) })
    .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, below.y + below.height, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(editor.getByLabel("List item").first()).toHaveValue("Bravo");
  await expect(editor.getByRole("status")).toHaveText("All saved");
  // Checked items keep their position among the stored items.
  expect(await saved()).toEqual(["Bravo", "Done", "Charlie", "Alpha"]);

  await editor.getByRole("button", { name: "Reorder Alpha" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    editor.getByRole("button", { name: "Reorder Alpha" }),
  ).toBeFocused();
  await expect(editor.getByRole("status")).toHaveText("All saved");
  expect(await saved()).toEqual(["Bravo", "Done", "Alpha", "Charlie"]);
});

test("web addresses in notes are links that open without opening the editor", async ({
  page,
  context,
}) => {
  const title = `Links ${crypto.randomUUID().slice(0, 8)}`;
  const note = {
    ...makeNote(),
    title,
    kind: "text" as const,
    content: "Recipe at https://example.com/soup. Enjoy",
  };
  await page.goto("/");
  await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "Soup recipe" }),
  );
  await page.reload();
  const card = page.locator("article").filter({ hasText: title });
  const link = card.getByRole("link", { name: "https://example.com/soup" });
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const popup = page.waitForEvent("popup");
  await link.click();
  await expect(await popup).toHaveURL("https://example.com/soup");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.locator(".note-content").click({ position: { x: 5, y: 5 } });
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await expect(
    editor.getByRole("link", { name: /example\.com\/soup/ }),
  ).toHaveAttribute("href", "https://example.com/soup");
});

test("the due date can be set, changed, and cleared from the card", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-24T22:00:00Z"));
  const title = `Card due ${crypto.randomUUID().slice(0, 8)}`;
  const note = { ...makeNote(), title };
  await page.goto("/");
  await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  await page.reload();
  const card = page.locator("article").filter({ hasText: title });
  const saved = async () =>
    (await (await page.request.get("/api/notes")).json()).notes.find(
      (n: { id: string }) => n.id === note.id,
    ).dueDate;
  await card.getByRole("button", { name: "Set due date" }).click();
  await card.getByLabel("Due date", { exact: true }).fill("2026-10-05");
  const badge = card.getByRole("button", { name: /Change due date/ });
  await expect(badge).toHaveText("Oct 5");
  await expect(card.getByRole("button", { name: "Set due date" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(saved).toBe("2026-10-05");
  await badge.click();
  await card.getByLabel("Due date", { exact: true }).fill("2026-09-25");
  await expect(badge).toHaveText("Tomorrow");
  await expect.poll(saved).toBe("2026-09-25");
  await card.getByLabel("Due date", { exact: true }).fill("");
  await expect(badge).toHaveCount(0);
  await expect.poll(saved).toBeNull();
});

test("archiving or trashing a note can be undone", async ({ page }) => {
  const title = `Undo ${crypto.randomUUID().slice(0, 8)}`;
  const note = { ...makeNote(), title };
  await page.goto("/");
  await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  await page.reload();
  const card = page.locator("article").filter({ hasText: title });
  const saved = async () =>
    (await (await page.request.get("/api/notes")).json()).notes.find(
      (n: { id: string }) => n.id === note.id,
    ).status;
  const toast = page.locator(".undo-toast");

  await card.getByRole("button", { name: "Move to trash" }).click();
  await expect(toast).toContainText("Note moved to trash");
  await expect(card).toHaveCount(0);
  await expect.poll(saved).toBe("trashed");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect.poll(saved).toBe("active");

  await card.getByRole("button", { name: title, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive note", exact: true })
    .click();
  await expect(toast).toContainText("Note archived");
  await expect.poll(saved).toBe("archived");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();
  await expect.poll(saved).toBe("active");

  await card.getByRole("button", { name: "Archive note" }).click();
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 8000 });
  await expect.poll(saved).toBe("archived");
});

test("settings exports all notes as a JSON download", async ({ page }) => {
  const title = `Export ${crypto.randomUUID().slice(0, 8)}`;
  const note = { ...makeNote(), title, status: "archived" as const };
  await page.goto("/");
  await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^notes-export-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const data = JSON.parse(
    await (
      await file.createReadStream()
    )
      .toArray()
      .then((c) => Buffer.concat(c).toString("utf8")),
  );
  expect(data.format).toBe("notes-app-export");
  expect(data.notes.map((n: { title: string }) => n.title)).toContain(title);
});

test("keyboard shortcuts create notes, search, and switch views", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".new-note")).toBeEnabled();
  const nav = page.getByRole("navigation", { name: "Notes views" });
  await page.keyboard.press("2");
  await expect(nav.getByRole("button", { name: /^Archive/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("3");
  await expect(nav.getByRole("button", { name: /^Trash/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("/");
  const search = page.getByLabel("Search notes");
  await expect(search).toBeFocused();
  // Typing in search must not trigger shortcuts.
  await page.keyboard.type("c1");
  await expect(search).toHaveValue("c1");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).not.toBeFocused();
  await page.keyboard.press("1");
  await expect(nav.getByRole("button", { name: /^All Notes/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("c");
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Note title")).toBeFocused();
  // Shortcut keys typed inside a note are just text.
  await page.keyboard.type("n2/");
  await expect(editor.getByLabel("Note title")).toHaveValue("n2/");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
});

import { test, expect, type Page } from "@playwright/test";
import { makeNote, type Note } from "../shared/notes";

async function openChecklist(page: Page, texts: string[]) {
  await page.goto("/");
  await expect(page.locator(".new-note")).toBeEnabled();
  const note: Note = {
    ...makeNote(),
    title: `List editing ${crypto.randomUUID().slice(0, 8)}`,
    items: texts.map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
    })),
  };
  const response = await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: note.title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const items = editor.getByRole("textbox", { name: "List item", exact: true });
  const saved = async () => {
    const { notes } = await (await page.request.get("/api/notes")).json();
    return (notes as Note[])
      .find((n) => n.id === note.id)!
      .items.map((i) => i.text);
  };
  return { items, saved };
}

async function caretAt(page: Page, offset: number) {
  await page.evaluate((offset) => {
    const input = document.activeElement as HTMLTextAreaElement;
    input.setSelectionRange(offset, offset);
  }, offset);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("pasting a copied list makes one checklist item per line", async ({
  page,
}) => {
  const { items, saved } = await openChecklist(page, ["Electrolytes: "]);
  await items.first().click();
  await items.first().press("End");
  await items.first().evaluate((input) => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      "- 1 L water\n- 1/4 tsp sea salt\n\n- 1 tbsp honey\n- Juice of 1 lemon\n",
    );
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(items).toHaveCount(4);
  await expect(items.last()).toBeFocused();
  await page.keyboard.type(" (fresh)");
  await expect
    .poll(saved)
    .toEqual([
      "Electrolytes: 1 L water",
      "1/4 tsp sea salt",
      "1 tbsp honey",
      "Juice of 1 lemon (fresh)",
    ]);
});

test("keyboards that insert multi-line text without a paste event still split it", async ({
  page,
}) => {
  const { items, saved } = await openChecklist(page, [""]);
  await items.first().click();
  await page.keyboard.insertText("Water\nSalt\nHoney");
  await expect(items).toHaveCount(3);
  await expect(items.last()).toBeFocused();
  await expect.poll(saved).toEqual(["Water", "Salt", "Honey"]);
});

test("Enter moves the text after the caret into a new item", async ({
  page,
}) => {
  const { items, saved } = await openChecklist(page, [
    "Salt, honey, lemon",
    "Last",
  ]);
  await items.first().click();
  await caretAt(page, "Salt,".length);
  await page.keyboard.press("Enter");
  await expect(items.nth(1)).toBeFocused();
  await caretAt(page, "honey,".length);
  await page.keyboard.press("Enter");
  await expect(items.nth(2)).toBeFocused();
  expect(
    await items
      .nth(2)
      .evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
  ).toBe(0);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Ice");
  await expect.poll(saved).toEqual(["Salt,", "honey,", "lemon", "Ice", "Last"]);

  await items.last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two");
  await expect
    .poll(saved)
    .toEqual(["Salt,", "honey,", "lemon", "Ice", "Last\nline two"]);
});

test("Backspace at the start of an item joins it onto the item above", async ({
  page,
}) => {
  const { items, saved } = await openChecklist(page, ["Salt,", " honey", ""]);
  await items.nth(1).click();
  await caretAt(page, 0);
  await page.keyboard.press("Backspace");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toBeFocused();
  await page.keyboard.type(" sea salt,");
  await expect.poll(saved).toEqual(["Salt, sea salt, honey", ""]);

  await items.last().click();
  await page.keyboard.press("Backspace");
  await expect(items).toHaveCount(1);
  await page.keyboard.type(", lemon");
  await expect.poll(saved).toEqual(["Salt, sea salt, honey, lemon"]);
});

test("a deleted item can be restored in place, and the phone editor closes from the top left", async ({
  page,
}) => {
  const { items, saved } = await openChecklist(page, [
    "Water",
    "Sea salt",
    "Honey",
  ]);
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await editor.getByRole("button", { name: "Remove item" }).nth(1).click();
  await expect(items).toHaveCount(2);
  const toast = editor.locator(".undo-toast");
  await expect(toast).toContainText("Item deleted");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toBeHidden();
  await expect(items).toHaveCount(3);
  await expect.poll(saved).toEqual(["Water", "Sea salt", "Honey"]);

  await editor.getByRole("button", { name: "Remove item" }).last().click();
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toBeHidden();
  await expect.poll(saved).toEqual(["Water", "Sea salt"]);

  const close = editor.getByRole("button", { name: "Close", exact: true });
  const pin = editor.getByRole("button", { name: "Pin note" });
  expect((await close.boundingBox())!.x).toBeLessThan(
    (await pin.boundingBox())!.x,
  );
  await close.click();
  await expect(editor).toBeHidden();
});

test("the color palette closes after a pick, a tap outside, or Escape", async ({
  page,
}) => {
  const { items } = await openChecklist(page, ["Water"]);
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const palette = editor.locator(".color-popover");
  const toggle = editor.getByLabel("Note color", { exact: true });
  await toggle.click();
  await expect(palette).toBeVisible();
  await editor.getByRole("button", { name: "Berry", exact: true }).click();
  await expect(palette).toBeHidden();

  await toggle.click();
  await expect(palette).toBeVisible();
  await items.first().click();
  await expect(palette).toBeHidden();

  await toggle.click();
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(editor).toBeVisible();
  await toggle.click();
  await expect(
    editor.getByRole("button", { name: "Berry", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a card shows every unchecked item of a long list", async ({ page }) => {
  const texts = Array.from({ length: 14 }, (_, i) => `Ingredient ${i + 1}`);
  await openChecklist(page, texts);
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  const card = page.locator("article").filter({ hasText: "Ingredient 14" });
  await expect(card.locator(".check-row")).toHaveCount(14);
  await expect(card.getByText(/more items/)).toHaveCount(0);
});

async function showList(page: Page, texts: string[]) {
  await page.goto("/");
  await expect(page.locator(".new-note")).toBeEnabled();
  const note: Note = {
    ...makeNote(),
    title: `Long list ${crypto.randomUUID().slice(0, 8)}`,
    items: texts.map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
    })),
  };
  const response = await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  const card = page.locator("article").filter({
    has: page.getByRole("button", { name: note.title, exact: true }),
  });
  const collapsed = async () => {
    const { notes } = await (await page.request.get("/api/notes")).json();
    return (notes as Note[]).find((n) => n.id === note.id)!.collapsed;
  };
  return { note, card, collapsed };
}

test("a long card collapses to 8 items and stays collapsed", async ({
  page,
}) => {
  const texts = Array.from({ length: 14 }, (_, i) => `Book ${i + 1}`);
  const { note, card, collapsed } = await showList(page, texts);
  const rows = card.locator(".check-row");
  await expect(rows).toHaveCount(14);
  await card.getByRole("button", { name: "Show less", exact: true }).click();
  await expect(rows).toHaveCount(8);
  await expect(rows.last()).toContainText("Book 8");
  const expand = card.getByRole("button", { name: "6 more items" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  // The choice is saved with the note, so it survives a reload.
  await expect.poll(collapsed).toBe(true);
  await page.reload();
  await expect(rows).toHaveCount(8);
  // The editor still shows every item.
  await card.getByRole("button", { name: note.title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await expect(editor.locator(".check-row")).toHaveCount(14);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expand.click();
  await expect(rows).toHaveCount(14);
  await expect.poll(collapsed).toBe(false);
  await page.reload();
  await expect(rows).toHaveCount(14);
});

test("cards with 10 or fewer unchecked items have no collapse toggle", async ({
  page,
}) => {
  const texts = Array.from({ length: 10 }, (_, i) => `Errand ${i + 1}`);
  const { card } = await showList(page, texts);
  await expect(card.locator(".check-row")).toHaveCount(10);
  await expect(
    card.getByRole("button", { name: /Show less|more items/ }),
  ).toHaveCount(0);
});

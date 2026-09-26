import { test, expect, type Locator, type Page } from "@playwright/test";
import { makeNote, type Note } from "../shared/notes";

async function openWorkspace(page: Page, patch: Partial<Note>) {
  await page.goto("/");
  await expect(page.locator(".new-note")).toBeEnabled();
  const note = { ...makeNote(), ...patch };
  const response = await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" },
    data: { note, mutationId: crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  return page.locator("article").filter({
    has: page.getByRole("button", { name: note.title, exact: true }),
  });
}

async function clickText(
  page: Page,
  text: Locator,
  offset: number,
  touch = false,
) {
  await text.scrollIntoViewIfNeeded();
  const point = await text.evaluate((element, offset) => {
    const range = document.createRange();
    range.setStart(element.firstChild!, offset);
    range.setEnd(element.firstChild!, offset + 1);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + Math.min(1, rect.width / 10),
      y: rect.top + rect.height / 2,
    };
  }, offset);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

test("opening the second item preserves its insertion point through autosave", async ({
  page,
}) => {
  const values = [
    "First item stays unchanged",
    "Second item needs a reply",
    "Third item stays unchanged",
  ];
  const card = await openWorkspace(page, {
    title: "Caret checklist",
    items: values.map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
    })),
  });
  await clickText(page, card.locator(".check-row > span").nth(1), 7);
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const item = editor
    .getByRole("textbox", { name: "List item", exact: true })
    .nth(1);
  await expect(item).toBeFocused();
  expect(
    await item.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
  ).toBe(7);
  await page.keyboard.type("updated ");
  await expect(item).toHaveValue("Second updated item needs a reply");
  await page.keyboard.press("ArrowLeft");
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await expect(item).toBeFocused();
  expect(
    await item.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
  ).toBe(14);
  await expect(
    editor.getByRole("textbox", { name: "List item", exact: true }).first(),
  ).toHaveValue(values[0]);
  await expect(
    editor.getByRole("textbox", { name: "List item", exact: true }).last(),
  ).toHaveValue(values[2]);
  await expect(editor.getByRole("checkbox").nth(1)).not.toBeChecked();
  await page.screenshot({ path: "test-results/caret-desktop.png" });
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    card.getByText("Second updated item needs a reply", { exact: true }),
  ).toBeVisible();
});

test("title and multiline text open at the clicked character, with a keyboard fallback", async ({
  page,
}) => {
  const title = "Caret plain text";
  const content = "First line\nSecond line with \u{1f680} launch details";
  const card = await openWorkspace(page, { title, kind: "text", content });
  await clickText(
    page,
    card.getByRole("button", { name: title, exact: true }),
    6,
  );
  const editor = page.getByRole("dialog", { name: "Note editor" });
  await expect(editor.getByLabel("Note title")).toBeFocused();
  expect(
    await editor
      .getByLabel("Note title")
      .evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
  ).toBe(6);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await clickText(
    page,
    card.locator(".note-content"),
    content.indexOf("launch"),
  );
  await expect(editor.getByLabel("Note content")).toBeFocused();
  await page.keyboard.type("new ");
  await expect(editor.getByLabel("Note content")).toHaveValue(
    content.replace("launch", "new launch"),
  );
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await card.getByRole("button", { name: title, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(editor.getByLabel("Note title")).toBeFocused();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".new-note").click();
  await expect(editor.getByLabel("Note title")).toBeFocused();
});

test.describe("touch editing", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("tapping wrapped or completed item text focuses that item using the Safari-compatible fallback", async ({
    page,
  }) => {
    const wrapped =
      "A longer second item that wraps across several lines on a phone, with a target word near its end.";
    const card = await openWorkspace(page, {
      title: "Caret touch checklist",
      items: ["First item", wrapped, "Completed item"].map((text, i) => ({
        id: crypto.randomUUID(),
        text,
        done: i === 2,
      })),
    });
    await page.evaluate(() =>
      Object.defineProperty(document, "caretPositionFromPoint", {
        value: undefined,
        configurable: true,
      }),
    );
    await clickText(
      page,
      card.locator(".check-row > span").nth(1),
      wrapped.indexOf("target"),
      true,
    );
    const editor = page.getByRole("dialog", { name: "Note editor" });
    const item = editor
      .getByRole("textbox", { name: "List item", exact: true })
      .nth(1);
    await expect(item).toBeFocused();
    expect(
      await item.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
    ).toBe(wrapped.indexOf("target"));
    await page.keyboard.type("new ");
    await expect(item).toHaveValue(wrapped.replace("target", "new target"));
    await expect(editor.getByRole("status")).toHaveText("All saved");
    await page.screenshot({ path: "test-results/caret-mobile.png" });
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await clickText(page, card.locator(".check-row > span").last(), 10, true);
    const completed = editor
      .getByRole("textbox", { name: "List item", exact: true })
      .last();
    await expect(completed).toBeFocused();
    expect(
      await completed.evaluate(
        (el) => (el as HTMLTextAreaElement).selectionStart,
      ),
    ).toBe(10);
    await expect(editor.getByRole("checkbox").last()).toBeChecked();
  });
});

import { test, expect, type Page } from "@playwright/test";
import { makeNote, type Item, type Note } from "../shared/notes";

const headers = { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" };
const tag = () => crypto.randomUUID().slice(0, 8);

// "Fruit" is a top-level item, ">Apples" nests under the item above it,
// and a trailing "*" marks an item checked.
function items(...specs: string[]): Item[] {
  let top: string | undefined;
  return specs.map((spec) => {
    const nested = spec.startsWith(">");
    const item: Item = {
      id: crypto.randomUUID(),
      text: spec.replace(/^>|\*$/g, ""),
      done: spec.endsWith("*"),
    };
    if (nested) item.parentId = top;
    else top = item.id;
    return item;
  });
}
async function seed(page: Page, ...notes: Note[]) {
  await page.goto("/");
  await expect(page.locator(".new-note")).toBeEnabled();
  for (const note of notes) {
    const response = await page.request.put(`/api/notes/${note.id}`, {
      headers,
      data: { note, mutationId: crypto.randomUUID() },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  await expect(page.locator(".new-note")).toBeEnabled();
}
async function saved(page: Page, id: string) {
  const { notes } = await (await page.request.get("/api/notes")).json();
  return (notes as Note[]).find((n) => n.id === id);
}
// The saved list in the same notation as items().
async function outline(page: Page, id: string) {
  const note = await saved(page, id);
  return note!.items.map(
    (i) => `${i.parentId ? ">" : ""}${i.text}${i.done ? "*" : ""}`,
  );
}
function card(page: Page, title: string) {
  return page.locator("article").filter({
    has: page.getByRole("button", { name: title, exact: true }),
  });
}
function nav(page: Page, view: string) {
  return page
    .getByRole("navigation", { name: "Notes views" })
    .getByRole("button", { name: new RegExp(`^${view}`) });
}
function localDate(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("closing a note drops empty items left at the end of the list", async ({
  page,
}) => {
  const note = {
    ...makeNote(),
    title: `Trim ${tag()}`,
    items: items("Milk", "", "Eggs"),
  };
  await seed(page, note);
  await page.getByRole("button", { name: note.title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const add = editor.getByRole("button", { name: "List item", exact: true });
  await add.click();
  await add.click();
  await expect(editor.getByLabel("List item", { exact: true })).toHaveCount(5);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  // The empty item in the middle stays; the two at the end are gone.
  await expect.poll(() => outline(page, note.id)).toEqual(["Milk", "", "Eggs"]);
});

test("cards due soon or past due get a thicker colored outline", async ({
  page,
}) => {
  const due = (title: string, dueDate: string, list = items("Task")) => ({
    ...makeNote(),
    title: `${title} ${tag()}`,
    dueDate,
    items: list,
  });
  const soon = due("Soon", localDate(1));
  const overdue = due("Overdue", localDate(-2));
  const later = due("Later", localDate(10));
  const finished = due("Finished", localDate(-2), items("Task*"));
  await seed(page, soon, overdue, later, finished);
  const border = (note: Note) =>
    card(page, note.title).evaluate((el) => {
      const css = getComputedStyle(el);
      return [css.borderTopColor, css.boxShadow];
    });
  const [soonColor, soonRing] = await border(soon);
  expect(soonColor).toBe("rgb(240, 168, 48)");
  expect(soonRing).toContain("0px 0px 0px 1px");
  const [overdueColor, overdueRing] = await border(overdue);
  expect(overdueColor).toBe("rgb(255, 59, 59)");
  expect(overdueRing).toContain("0px 0px 0px 2px");
  // Notes due later, or with nothing left to do, keep the plain outline.
  for (const note of [later, finished])
    expect((await border(note))[1]).toBe("none");
});

test("clicking anywhere on a card that isn't a control opens it", async ({
  page,
}) => {
  const note = {
    ...makeNote(),
    title: `Open anywhere ${tag()}`,
    items: items("Bread", "Jam"),
  };
  await seed(page, note);
  const target = card(page, note.title);
  const editor = page.getByRole("dialog", { name: "Note editor" });
  // The checkbox only checks the item.
  await target.getByRole("checkbox", { name: "Bread" }).click();
  await expect(editor).toHaveCount(0);
  await expect(target.getByRole("checkbox", { name: "Bread" })).toBeChecked();
  // The padding at the card's top corner and the gap beside the footer
  // controls both open the note.
  await target.click({ position: { x: 6, y: 6 } });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const footer = (await target.locator(".card-footer").boundingBox())!;
  const actions = (await target.locator(".card-actions").boundingBox())!;
  await page.mouse.click(actions.x - 12, footer.y + footer.height / 2);
  await expect(editor).toBeVisible();
});

test("the archive groups pinned notes apart from the others", async ({
  page,
}) => {
  const pinned = {
    ...makeNote(),
    title: `Archived pinned ${tag()}`,
    status: "archived" as const,
    pinned: true,
  };
  const other = {
    ...makeNote(),
    title: `Archived other ${tag()}`,
    status: "archived" as const,
  };
  await seed(page, pinned, other);
  await nav(page, "Archive").click();
  const section = (label: string) =>
    page.getByRole("region", { name: label, exact: true });
  await expect(
    section("Pinned").getByRole("button", { name: pinned.title }),
  ).toBeVisible();
  await expect(
    section("Others").getByRole("button", { name: other.title }),
  ).toBeVisible();
  await expect(
    section("Pinned").getByRole("button", { name: other.title }),
  ).toHaveCount(0);
});

test("empty trash permanently deletes only the notes in the trash", async ({
  page,
}) => {
  const trashed = [1, 2].map((n) => ({
    ...makeNote(),
    title: `Trashed ${n} ${tag()}`,
    status: "trashed" as const,
  }));
  const kept = { ...makeNote(), title: `Kept ${tag()}` };
  await seed(page, ...trashed, kept);
  // The server only deletes notes that are still in the trash.
  const guarded = await page.request.delete("/api/trash", {
    headers,
    data: { ids: [kept.id] },
  });
  expect(await guarded.json()).toEqual({ deleted: 0 });
  await nav(page, "Trash").click();
  const empty = page.getByRole("button", { name: "Empty trash" });
  const dialog = page.getByRole("dialog", { name: "Empty trash" });
  await empty.click();
  await expect(dialog).toContainText("permanently deleted");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: trashed[0].title }),
  ).toBeVisible();
  await empty.click();
  await dialog.getByRole("button", { name: "Delete forever" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("The trash is empty")).toBeVisible();
  await expect(empty).toHaveCount(0);
  for (const note of trashed)
    expect(await saved(page, note.id)).toBeUndefined();
  expect(await saved(page, kept.id)).toBeDefined();
  await page.reload();
  await nav(page, "Trash").click();
  await expect(page.getByText("The trash is empty")).toBeVisible();
});

test("Tab nests list items and checking a parent checks its group", async ({
  page,
}) => {
  const note = {
    ...makeNote(),
    title: `Nesting ${tag()}`,
    items: items("Fruit", "Apples", "Pears", "Vegetables", "Carrots"),
  };
  await seed(page, note);
  await page.getByRole("button", { name: note.title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const item = (text: string) =>
    editor.locator(".editor-item").filter({
      has: page.locator(`textarea:text-is("${text}")`),
    });
  const field = (text: string) => item(text).getByLabel("List item");
  for (const text of ["Apples", "Pears", "Carrots"]) {
    await field(text).click();
    await page.keyboard.press("Tab");
    await expect(item(text)).toHaveClass(/nested/);
  }
  await expect(field("Carrots")).toBeFocused();
  // Shift+Tab lifts an item back out; the caret stays put.
  await field("Pears").click();
  await page.keyboard.press("Shift+Tab");
  await expect(item("Pears")).not.toHaveClass(/nested/);
  await page.keyboard.press("Tab");
  await expect
    .poll(() => outline(page, note.id))
    .toEqual(["Fruit", ">Apples", ">Pears", "Vegetables", ">Carrots"]);
  // Backspace at the start of a nested item un-nests it first.
  await field("Carrots").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(item("Carrots")).not.toHaveClass(/nested/);
  await expect(field("Carrots")).toHaveValue("Carrots");
  await page.keyboard.press("Tab");

  // Checking the parent checks the whole group.
  await item("Fruit").getByRole("checkbox").check();
  await expect(editor.getByText("3 of 5 completed")).toBeVisible();
  // Unchecking a child brings it and its parent back.
  await item("Pears").getByRole("checkbox").uncheck();
  await expect(item("Fruit").getByRole("checkbox")).not.toBeChecked();
  await expect(item("Pears")).toHaveClass(/nested/);
  await expect
    .poll(() => outline(page, note.id))
    .toEqual(["Fruit", ">Apples*", ">Pears", "Vegetables", ">Carrots"]);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  // The card shows the nesting too.
  await expect(card(page, note.title).locator(".check-row.nested")).toHaveCount(
    2,
  );
});

test("dragging moves a group with its children, and sideways nests", async ({
  page,
}) => {
  const note = {
    ...makeNote(),
    title: `Drag groups ${tag()}`,
    items: items("Fruit", ">Apples", "Vegetables", ">Carrots", "Snacks"),
  };
  await seed(page, note);
  await page.getByRole("button", { name: note.title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const handle = (text: string) =>
    editor.getByRole("button", { name: `Reorder ${text}`, exact: true });
  const fields = editor.getByLabel("List item", { exact: true });
  async function drag(text: string, dx: number, dy: number) {
    const box = (await handle(text).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    await page.mouse.up();
    await expect(editor.getByRole("status")).toHaveText("All saved");
  }
  // Vegetables and its child move above Fruit together.
  const fruit = (await handle("Fruit").boundingBox())!;
  const vegetables = (await handle("Vegetables").boundingBox())!;
  await drag("Vegetables", 0, fruit.y - vegetables.y - 10);
  await expect(fields).toHaveText([
    "Vegetables",
    "Carrots",
    "Fruit",
    "Apples",
    "Snacks",
  ]);
  expect(await outline(page, note.id)).toEqual([
    "Vegetables",
    ">Carrots",
    "Fruit",
    ">Apples",
    "Snacks",
  ]);
  // Dragging Snacks to the right nests it in the group above.
  await drag("Snacks", 60, 0);
  expect(await outline(page, note.id)).toEqual([
    "Vegetables",
    ">Carrots",
    "Fruit",
    ">Apples",
    ">Snacks",
  ]);
  // Dragging Carrots to the left lifts it to the top level.
  await drag("Carrots", -60, 0);
  expect(await outline(page, note.id)).toEqual([
    "Vegetables",
    "Carrots",
    "Fruit",
    ">Apples",
    ">Snacks",
  ]);
  // Arrow keys on the handle do the same without a pointer.
  await handle("Carrots").focus();
  await page.keyboard.press("ArrowRight");
  await expect(editor.getByRole("status")).toHaveText("All saved");
  expect((await outline(page, note.id))[1]).toBe(">Carrots");
});

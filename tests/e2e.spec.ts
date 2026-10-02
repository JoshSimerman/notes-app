import { test, expect } from "@playwright/test";

test("mobile-friendly checklist, autosave, archive, trash, restore, settings and Access sign out", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "New note", exact: true }).first(),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog", { name: "Note editor" });
  const title = `Weekend list ${Date.now()}`;
  await editor.getByLabel("Note title").fill(title);
  await editor.getByRole("button", { name: "List item", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "List item", exact: true })
    .fill("Book a table");
  await editor
    .getByRole("textbox", { name: "List item", exact: true })
    .press("Enter");
  await editor
    .getByRole("textbox", { name: "List item", exact: true })
    .last()
    .fill("Pick up groceries");
  await editor
    .getByRole("button", { name: "High priority", exact: true })
    .click();
  await editor.getByLabel("Due date", { exact: true }).fill("2026-10-01");
  await editor.getByRole("button", { name: "Pin note", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(
    editor.getByRole("textbox", { name: "List item", exact: true }),
  ).toHaveCount(2);
  await editor.getByRole("checkbox", { name: "Complete Book a table" }).check();
  await editor
    .getByRole("button", { name: "1 of 2 completed", exact: true })
    .click();
  await expect(
    editor.getByRole("textbox", { name: "List item", exact: true }),
  ).toHaveCount(1);
  await expect(editor.getByRole("status")).toHaveText("All saved");
  const noteCard = page.locator("article").filter({ hasText: title });
  await expect(
    noteCard.getByRole("button", { name: "1 of 2 completed", exact: true }),
  ).toBeVisible();
  await expect(noteCard.getByText("1/2", { exact: true })).toHaveCount(0);
  const tab = (name: string) =>
    page
      .getByRole("navigation", { name: "Notes views" })
      .getByRole("button", { name: new RegExp(`^${name}`) });
  const count = async (name: string) =>
    Number(await tab(name).locator(".tab-count").textContent());
  const archived = await count("Archive");
  const trashed = await count("Trash");
  await editor
    .getByRole("button", { name: "Archive note", exact: true })
    .click();
  await expect(page.getByRole("status", { name: "All saved" })).toBeVisible();
  await expect(tab("Archive").locator(".tab-count")).toHaveText(
    String(archived + 1),
  );
  await tab("Archive").click();
  await page.getByRole("button", { name: title, exact: true }).click();
  await editor.getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByRole("status", { name: "All saved" })).toBeVisible();
  await expect(tab("Archive").locator(".tab-count")).toHaveText(
    String(archived),
  );
  await expect(tab("Trash").locator(".tab-count")).toHaveText(
    String(trashed + 1),
  );
  await tab("Trash").click();
  const card = page.locator("article").filter({ hasText: title });
  await card.getByRole("button", { name: "Restore note" }).click();
  await expect(page.getByRole("status", { name: "All saved" })).toBeVisible();
  await expect(tab("Trash").locator(".tab-count")).toHaveText(String(trashed));
  await page.getByRole("button", { name: /^All Notes/ }).click();
  await page.getByLabel("Search notes").fill(title);
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("slider").fill("360");
  await page.getByRole("slider").press("ArrowRight");
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("button", { name: "Close" })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.route("**/cdn-cgi/access/logout", (route) =>
    route.fulfill({ contentType: "text/html", body: "Signed out of Access" }),
  );
  // On a phone, settings and sign out live in the header menu.
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeHidden();
  // An active search keeps the top row until it is closed.
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Signed out of Access")).toBeVisible();
});

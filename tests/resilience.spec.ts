import { test, expect, type Page } from "@playwright/test";
import { makeNote } from "../shared/notes";
const headers = { Origin: "http://127.0.0.1:5174", "X-Keep-Request": "1" };
async function login(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "New note", exact: true }).first(),
  ).toBeEnabled();
}

test("retains offline edits through refresh and retries a lost successful response", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await page.route("**/api/notes/*", (route) =>
    route.abort("internetdisconnected"),
  );
  const title = `Offline draft ${Date.now()}`;
  await editor.getByLabel("Note title").fill(title);
  await expect(editor.getByRole("status")).toHaveText("Waiting to sync");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/notes/*");
  let first = true;
  await page.route("**/api/notes/*", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await expect(page.getByRole("status", { name: "All saved" })).toBeVisible({
    timeout: 18000,
  });
  await page.unroute("**/api/notes/*");
  await page.reload();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText(/recovered copy/)).toHaveCount(0);
});

test("preserves a second device version alongside a recovered local draft", async ({
  page,
}) => {
  await login(page);
  const initial = { ...makeNote(), title: `Shared ${Date.now()}` };
  const localTitle = `My simultaneous version ${initial.id.slice(0, 8)}`;
  const remoteTitle = `Other device version ${initial.id.slice(0, 8)}`;
  const response = await page.request.put(`/api/notes/${initial.id}`, {
    headers,
    data: { note: initial, mutationId: crypto.randomUUID() },
  });
  const saved = (await response.json()).note;
  await page.reload();
  await page.getByRole("button", { name: initial.title, exact: true }).click();
  await page.request.put(`/api/notes/${initial.id}`, {
    headers,
    data: {
      note: { ...saved, title: remoteTitle },
      mutationId: crypto.randomUUID(),
    },
  });
  await page.getByLabel("Note title").fill(localTitle);
  await expect(
    page.getByText(
      "This note changed elsewhere. Your edits are preserved in a recovered copy.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `${localTitle} (recovered)`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: remoteTitle, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Note title")).toHaveValue(
    `${localTitle} (recovered)`,
  );
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "All saved",
  );
});

test("sign out waits for pending edits before leaving through Access", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("status")).toHaveText("All saved");
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/notes/*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.route("**/cdn-cgi/access/logout", (route) =>
    route.fulfill({ contentType: "text/html", body: "Signed out of Access" }),
  );
  const title = `Pending at sign out ${Date.now()}`;
  await editor.getByLabel("Note title").fill(title);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".new-note")).toBeDisabled();
  await expect(page.getByText("Signed out of Access")).toBeHidden();
  release();
  await expect(page.getByText("Signed out of Access")).toBeVisible();
  const saved = await page.request.get("/api/notes");
  expect(JSON.stringify(await saved.json())).toContain(title);
});

test("a delayed refresh cannot replace newer acknowledged edits", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  const title = `Latest saved ${Date.now()}`;
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("status")).toHaveText("All saved");
  let release: () => void = () => {};
  let captured: () => void = () => {};
  const capturedPromise = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/notes", async (route) => {
    const old = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response: old });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await capturedPromise;
  await editor.getByLabel("Note title").fill(title);
  await expect(editor.getByRole("status")).toHaveText("All saved");
  const received = page.waitForResponse((r) => r.url().endsWith("/api/notes"));
  release();
  await received;
  await expect(editor.getByLabel("Note title")).toHaveValue(title);
});

test("an expired Access session keeps unsynced drafts for after signing in again", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "All saved",
  );
  await page.route("**/api/notes/*", (route) =>
    route.abort("internetdisconnected"),
  );
  const title = `Draft across sign-in ${Date.now()}`;
  await page.getByLabel("Note title").fill(title);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("keep.pending.v1")))
    .toContain(title);
  // Once its session expires, Access redirects API calls to its login page.
  await page.route("**/api/notes", (route) =>
    route.fulfill({
      status: 302,
      headers: {
        Location: "https://team.cloudflareaccess.com/cdn-cgi/access/login",
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("Your Cloudflare Access session has expired."),
  ).toBeVisible();
  await page.unrouteAll();
  await page
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await expect(
    page.locator("article").filter({ hasText: title }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      JSON.stringify(await (await page.request.get("/api/notes")).json()),
    )
    .toContain(title);
});

test("plain text, custom color, and long content fit desktop and mobile", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Note title").fill("A".repeat(200));
  await editor.getByRole("button", { name: "Plain text", exact: true }).click();
  await editor.getByLabel("Note content").fill("Long note content ".repeat(60));
  await editor.getByLabel("Note color", { exact: true }).click();
  await editor.getByLabel("Custom color").fill("#10392f");
  await editor.getByLabel("Note color", { exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await page.setViewportSize({ width: 320, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/mobile-editor.png" });
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
});

test("a custom color shows exactly as picked, live and after reload", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  const title = `Custom color ${Date.now()}`;
  await editor.getByLabel("Note title").fill(title);
  await editor.getByLabel("Note color", { exact: true }).click();
  const picker = editor.getByLabel("Custom color");
  const surface = editor.locator(".editor-surface");
  const card = page.locator("article").filter({ hasText: title });
  // Each step of a drag through the picker previews on the note right away.
  for (const [pick, rgb] of [
    ["#e05050", "rgb(224, 80, 80)"],
    ["#ff9900", "rgb(255, 153, 0)"],
  ]) {
    await picker.fill(pick);
    await expect(picker).toHaveValue(pick);
    await expect(surface).toHaveCSS("background-color", rgb);
    await expect(card).toHaveCSS("background-color", rgb);
  }
  await expect(surface).toHaveCSS("color", "rgb(231, 233, 236)");
  await expect(editor.getByRole("status")).toHaveText("All saved");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(card).toHaveCSS("background-color", "rgb(255, 153, 0)");
  await expect(card).toHaveCSS("color", "rgb(231, 233, 236)");
});

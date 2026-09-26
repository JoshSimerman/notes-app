import { test, expect } from "@playwright/test";

test("the app can be installed to a home screen", async ({ page, request }) => {
  await page.goto("/");
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveAttribute("crossorigin", "use-credentials");
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "Notes",
    start_url: "/",
    display: "standalone",
  });
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBeTruthy();
    expect(image.headers()["content-type"]).toBe("image/png");
  }
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual([
    "192x192",
    "512x512",
  ]);
});

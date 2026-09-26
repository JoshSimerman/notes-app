import { copyFile, constants } from "node:fs/promises";

try {
  await copyFile(
    "wrangler.jsonc",
    "wrangler.production.jsonc",
    constants.COPYFILE_EXCL,
  );
  console.log(
    "Created ignored wrangler.production.jsonc. Set your domain, D1 ID, and Cloudflare Access settings there. See README.md.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Existing production configuration preserved.");
}

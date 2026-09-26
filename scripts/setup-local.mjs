import { copyFile, access } from "node:fs/promises";
try {
  await access(".dev.vars");
  console.log("Existing local configuration preserved.");
} catch {
  await copyFile(".dev.vars.example", ".dev.vars");
  console.log("Local configuration created.");
}

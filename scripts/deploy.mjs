import { spawnSync } from "node:child_process";
import { checkDeployment, productionConfig } from "./check-deploy.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run")) {
  console.error("Supported option: --dry-run");
  process.exit(1);
}
try {
  await checkDeployment();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function run(script, parameters) {
  const result = spawnSync(process.execPath, [script, ...parameters], {
    stdio: "inherit",
    env: { ...process.env, NOTES_CONFIG: productionConfig },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Always build the chosen private config before uploading its generated output.
run(process.env.npm_execpath, ["run", "build"]);
run("node_modules/wrangler/bin/wrangler.js", [
  "deploy",
  "--config",
  "dist/worker/wrangler.json",
  ...args,
]);

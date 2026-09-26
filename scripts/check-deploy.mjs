import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "jsonc-parser";

export const productionConfig = "wrangler.production.jsonc";

export function validateDeployment(config) {
  const problems = [];
  const vars = config?.vars ?? {};
  const database = config?.d1_databases?.find(
    (binding) => binding.binding === "DB",
  );
  let origin;
  try {
    origin = new URL(vars.APP_ORIGIN);
  } catch {
    /* Report invalid origin below. */
  }
  if (
    !origin ||
    origin.protocol !== "https:" ||
    origin.origin !== vars.APP_ORIGIN ||
    !origin.hostname.includes(".") ||
    /(^|\.)(example\.(com|net|org)|localhost|test|invalid)$/.test(
      origin.hostname,
    )
  ) {
    problems.push(
      "Set APP_ORIGIN to your HTTPS origin, without a path or trailing slash.",
    );
  }
  if (!config?.name || !/^[a-z0-9][a-z0-9-]*$/.test(config.name)) {
    problems.push("Set a valid Worker name.");
  }
  if (
    !database?.database_name ||
    !/^[0-9a-f-]{36}$/i.test(database.database_id ?? "") ||
    database.database_id === "00000000-0000-0000-0000-000000000000"
  ) {
    problems.push("Set the name and ID of your provisioned D1 database.");
  }
  if (
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_TEAM_DOMAIN ?? "")
  ) {
    problems.push(
      "Set ACCESS_TEAM_DOMAIN to your Zero Trust team domain, like myteam.cloudflareaccess.com.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(vars.ACCESS_AUD ?? "")) {
    problems.push(
      "Set ACCESS_AUD to the Access application's Application Audience (AUD) tag.",
    );
  }
  if (vars.ENVIRONMENT !== "production")
    problems.push("ENVIRONMENT must be production.");
  if (config?.workers_dev !== false || config?.preview_urls !== false) {
    problems.push("Keep workers_dev and preview_urls disabled.");
  }
  if (
    !Array.isArray(config?.routes) ||
    config.routes.length !== 1 ||
    config.routes[0].custom_domain !== true ||
    config.routes[0].pattern !== origin?.hostname
  ) {
    problems.push("Declare exactly one Custom Domain matching APP_ORIGIN.");
  }
  return problems;
}

export async function checkDeployment() {
  let input;
  try {
    input = await readFile(productionConfig, "utf8");
  } catch {
    throw new Error(
      "Run npm run setup:deploy and configure wrangler.production.jsonc first.",
    );
  }
  const errors = [];
  const config = parse(input, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error("Invalid production JSONC configuration.");
  const problems = validateDeployment(config);
  if (problems.length) throw new Error(problems.join("\n"));
  return config;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await checkDeployment();
    console.log("Production configuration is valid.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

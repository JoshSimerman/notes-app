import { Jwt } from "hono/utils/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import type { Env } from "./env";

export function isLocal(env: Env, url: URL) {
  return (
    env.ENVIRONMENT === "development" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}
export function configured(env: Env, local: boolean) {
  return (
    local ||
    (/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN ?? "") &&
      /^[0-9a-f]{64}$/.test(env.ACCESS_AUD ?? ""))
  );
}
// Access signing keys rotate every few weeks; cache them per isolate and
// refetch early (at most once a minute) when a token names an unknown key.
let certs: { team: string; keys: HonoJsonWebKey[]; fetchedAt: number } | null =
  null;
async function accessKeys(team: string, kid: string) {
  const age = certs?.team === team ? Date.now() - certs.fetchedAt : Infinity;
  const known = certs?.keys.some((key) => key.kid === kid);
  if (certs && age < 3600000 && (known || age < 60000)) return certs.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(10000),
  });
  const data = response.ok
    ? ((await response.json()) as { keys?: unknown })
    : null;
  if (!Array.isArray(data?.keys))
    throw new Error("Cloudflare Access certificates are unavailable.");
  certs = { team, keys: data.keys, fetchedAt: Date.now() };
  return certs.keys;
}
export function clearAccessKeys() {
  certs = null;
}
// Verifies the token Cloudflare Access adds to every request it allows, so the
// Worker stays closed even if the Access application is removed or misconfigured.
export async function accessIdentity(
  request: Request,
  env: Env,
  local: boolean,
): Promise<{ email: string | null } | null> {
  if (local) return { email: null };
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !configured(env, local)) return null;
  let kid: unknown;
  try {
    kid = Jwt.decode(token).header.kid;
  } catch {
    return null;
  }
  if (typeof kid !== "string") return null;
  const keys = await accessKeys(env.ACCESS_TEAM_DOMAIN, kid);
  try {
    const payload = await Jwt.verifyWithJwks(token, {
      keys,
      allowedAlgorithms: ["RS256"],
      verification: {
        iss: `https://${env.ACCESS_TEAM_DOMAIN}`,
        aud: env.ACCESS_AUD,
      },
    });
    if (typeof payload.exp !== "number") return null;
    return { email: typeof payload.email === "string" ? payload.email : null };
  } catch {
    return null;
  }
}

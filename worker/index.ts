import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { notes, cleanup } from "./notes";
import { backup, snapshot } from "./backup";
import { accessIdentity, configured, isLocal } from "./security";
import type { Bindings, Env } from "./env";

const app = new Hono<Bindings>();
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const local = isLocal(c.env, url);
  if (!local && url.origin !== c.env.APP_ORIGIN) {
    if (
      url.protocol === "http:" &&
      `https://${url.host}` === c.env.APP_ORIGIN &&
      ["GET", "HEAD"].includes(c.req.method)
    )
      return c.redirect(`${c.env.APP_ORIGIN}${url.pathname}${url.search}`, 308);
    return c.text("HTTPS on the configured host is required.", 403);
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!local) c.header("Strict-Transport-Security", "max-age=31536000");
  c.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${local ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${local ? " ws: wss:" : ""}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  );
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: "This note is too large." }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const url = new URL(c.req.url);
    const origin = isLocal(c.env, url) ? url.origin : c.env.APP_ORIGIN;
    if (
      c.req.header("Origin") !== origin ||
      c.req.header("X-Keep-Request") !== "1" ||
      !c.req.header("Content-Type")?.startsWith("application/json")
    )
      return c.json({ error: "Request could not be verified." }, 403);
  }
  await next();
});
app.use("/api/*", async (c, next) => {
  const local = isLocal(c.env, new URL(c.req.url));
  if (!configured(c.env, local))
    return c.json(
      { error: "Cloudflare Access is not configured for this installation." },
      503,
    );
  const identity = await accessIdentity(c.req.raw, c.env, local);
  if (!identity)
    return c.json({ error: "Sign in through Cloudflare Access." }, 401);
  c.set("email", identity.email);
  await next();
});
app.get("/api/session", (c) =>
  c.json({
    email: c.get("email"),
    local: isLocal(c.env, new URL(c.req.url)),
  }),
);
app.get("/api/export", async (c) => {
  const data = await snapshot(c.env);
  c.header(
    "Content-Disposition",
    `attachment; filename="notes-export-${data.exportedAt.slice(0, 10)}.json"`,
  );
  return c.json(data);
});
app.route("/api", notes);
app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  if (error instanceof SyntaxError)
    return c.json({ error: "Invalid request." }, 400);
  console.error("Request failed", error.name);
  return c.json(
    { error: "Temporarily unavailable. Your edits will retry." },
    503,
  );
});
export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(Promise.all([cleanup(env), backup(env)])),
};

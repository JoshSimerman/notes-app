import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { Jwt } from "hono/utils/jwt";
import {
  accessIdentity,
  clearAccessKeys,
  configured,
} from "../worker/security";
import type { Env } from "../worker/env";
import { makeNote } from "../shared/notes";

const team = "test-team.cloudflareaccess.com";
const aud = "a".repeat(64);
const bindings = {
  APP_ORIGIN: "https://notes.example.com",
  ENVIRONMENT: "production",
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: aud,
};
const env = bindings as unknown as Env;

async function signingKey(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = async (key: CryptoKey) => ({
    ...(await crypto.subtle.exportKey("jwk", key)),
    kid,
    alg: "RS256",
  });
  return {
    private: await jwk(pair.privateKey),
    public: await jwk(pair.publicKey),
  };
}
let key: Awaited<ReturnType<typeof signingKey>>;
let impostor: Awaited<ReturnType<typeof signingKey>>;
const now = () => Math.floor(Date.now() / 1000);
const token = (claims: Record<string, unknown> = {}, signer = key) =>
  Jwt.sign(
    {
      iss: `https://${team}`,
      aud: [aud],
      email: "owner@example.com",
      iat: now() - 10,
      exp: now() + 3600,
      ...claims,
    },
    signer.private,
  );
const withToken = (value: string) =>
  new Request("https://notes.example.com/api/notes", {
    headers: { "Cf-Access-Jwt-Assertion": value },
  });

let mf: Miniflare;
beforeAll(async () => {
  key = await signingKey("current");
  impostor = await signingKey("current");
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/worker/index.js",
      compatibilityDate: "2026-09-23",
      bindings,
      d1Databases: ["DB"],
      outboundService: (request: Request) =>
        new URL(request.url).href === `https://${team}/cdn-cgi/access/certs`
          ? Response.json({ keys: [key.public] })
          : new Response("Unexpected outbound request", { status: 500 }),
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const statement of readFileSync(`migrations/${file}`, "utf8")
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
const request = async (
  path: string,
  { method = "GET", body, origin = bindings.APP_ORIGIN, auth = true } = {} as {
    method?: string;
    body?: string;
    origin?: string;
    auth?: boolean;
  },
) =>
  mf.dispatchFetch(`https://notes.example.com/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Keep-Request": "1",
      Origin: origin,
      ...(auth ? { "Cf-Access-Jwt-Assertion": await token() } : {}),
    },
    body,
  });

describe("Cloudflare Access verification", () => {
  let fetch: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    clearAccessKeys();
    fetch?.mockRestore();
    fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ keys: [key.public] }));
  });
  it("requires a real team domain and AUD tag in production", () => {
    expect(configured(env, false)).toBe(true);
    expect(configured(env, true)).toBe(true);
    for (const patch of [
      { ACCESS_AUD: "" },
      { ACCESS_AUD: "not-a-tag" },
      { ACCESS_TEAM_DOMAIN: "" },
      { ACCESS_TEAM_DOMAIN: "evil.example.com" },
    ])
      expect(configured({ ...env, ...patch }, false)).toBe(false);
    expect(configured({ ...env, ACCESS_AUD: "" }, true)).toBe(true);
  });
  it("accepts a valid token and fetches keys from the team domain", async () => {
    expect(await accessIdentity(withToken(await token()), env, false)).toEqual({
      email: "owner@example.com",
    });
    expect(String(fetch.mock.calls[0][0])).toBe(
      `https://${team}/cdn-cgi/access/certs`,
    );
  });
  it("rejects missing, forged, expired, and misaddressed tokens", async () => {
    const rejected = [
      new Request("https://notes.example.com/api/notes"),
      withToken("not-a-jwt"),
      withToken(await token({}, impostor)),
      withToken(await token({ aud: ["b".repeat(64)] })),
      withToken(await token({ iss: "https://other.cloudflareaccess.com" })),
      withToken(await token({ exp: now() - 1 })),
      withToken(await token({ exp: undefined })),
      withToken(
        await Jwt.sign({ aud: [aud], iss: `https://${team}` }, "secret"),
      ),
    ];
    for (const candidate of rejected)
      expect(await accessIdentity(candidate, env, false)).toBeNull();
  });
  it("refetches keys when Access rotates them and fails closed when unavailable", async () => {
    await accessIdentity(withToken(await token()), env, false);
    const rotated = await signingKey("rotated");
    fetch.mockImplementation(async () =>
      Response.json({ keys: [key.public, rotated.public] }),
    );
    vi.useFakeTimers({ now: Date.now() + 61000, toFake: ["Date"] });
    try {
      expect(
        await accessIdentity(withToken(await token({}, rotated)), env, false),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    clearAccessKeys();
    fetch.mockImplementation(async () => new Response("down", { status: 502 }));
    await expect(
      accessIdentity(withToken(await token()), env, false),
    ).rejects.toThrow();
  });
  it("skips Access only for local development", async () => {
    expect(
      await accessIdentity(new Request("http://127.0.0.1/"), env, true),
    ).toEqual({ email: null });
  });
});

describe("real Worker and D1 security boundaries", () => {
  it("requires a verified Access token for every API route", async () => {
    expect((await request("/notes", { auth: false })).status).toBe(401);
    expect((await request("/session", { auth: false })).status).toBe(401);
    expect((await request("/export", { auth: false })).status).toBe(401);
    const session = await request("/session");
    expect(await session.json()).toEqual({
      email: "owner@example.com",
      local: false,
    });
  });
  it("rejects hostile origins and malformed JSON", async () => {
    const note = makeNote();
    const body = JSON.stringify({ note, mutationId: crypto.randomUUID() });
    expect(
      (
        await request(`/notes/${note.id}`, {
          method: "PUT",
          body,
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(`/notes/${note.id}`, { method: "PUT", body: "{" })).status,
    ).toBe(400);
    expect(
      (await request(`/notes/${note.id}`, { method: "PUT", body })).status,
    ).toBe(200);
  });
  it("hides expired trash immediately and prevents restoring it", async () => {
    const note = {
      ...makeNote(),
      version: 1,
      status: "trashed",
      deletedAt: Date.now() - 91 * 86400000,
    };
    const db = await mf.getD1Database("DB");
    await db
      .prepare("INSERT INTO notes VALUES(?, ?, 1, ?, ?, ?, ?)")
      .bind(
        note.id,
        JSON.stringify(note),
        note.status,
        note.deletedAt,
        Date.now(),
        crypto.randomUUID(),
      )
      .run();
    const list = (await (await request("/notes")).json()) as {
      notes: { id: string }[];
    };
    expect(list.notes.map((n) => n.id)).not.toContain(note.id);
    const restore = await request(`/notes/${note.id}`, {
      method: "PUT",
      body: JSON.stringify({
        note: { ...note, status: "active" },
        mutationId: crypto.randomUUID(),
      }),
    });
    expect(restore.status).toBe(410);
  });
  it("rejects plaintext and alternate hostnames", async () => {
    expect(
      (
        await mf.dispatchFetch("http://notes.example.com/api/notes", {
          redirect: "manual",
        })
      ).status,
    ).toBe(308);
    expect(
      (await mf.dispatchFetch("https://alternate.example/api/session")).status,
    ).toBe(403);
    expect((await mf.dispatchFetch("http://localhost/api/notes")).status).toBe(
      403,
    );
  });
});

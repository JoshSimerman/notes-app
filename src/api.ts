export class ApiError extends Error {
  constructor(
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(String(data.error ?? "Unable to connect."));
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Keep-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // Once the Access session expires, Access answers with a redirect to its
    // login page. Surface that as a sign-in error instead of following it.
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (response.type === "opaqueredirect")
    throw new ApiError(401, {
      error: "Your Cloudflare Access session has expired.",
    });
  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new Error("Unable to connect. Retrying shortly.");
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}
export type Session = { email: string | null; local: boolean };

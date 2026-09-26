# Cloudflare Access

This app has no login of its own. Sign-in is handled by [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/): every request to the hostname has to pass an Access login at Cloudflare's edge before it reaches the Worker, and the Worker then verifies the signed token Access attaches. **Access is required in production.** Without a matching Access application and configuration the API refuses every request.

Who can sign in, with which login methods (email one-time PIN, Google, GitHub, a passkey-capable identity provider, and so on), and for how long a session lasts are all decided by the Access application and its policy, not by the app.

The steps below use placeholder names. Replace `notes.example.com` with your hostname and `<team>` with your Zero Trust team name, so that `<team>.cloudflareaccess.com` is your team domain.

## Prerequisites

- The domain's DNS is on Cloudflare and the app is attached as a Workers **Custom Domain** (see [Deploy on your own domain](../README.md#deploy-on-your-own-domain)). Custom Domains are always proxied, which Access requires. Access never sees requests to a DNS record that is not proxied.
- Zero Trust is enabled on the account. The Free plan covers up to 50 users; Cloudflare may ask for a payment method even for the $0 plan.

## Setup

Steps 1 to 3 are in the Cloudflare dashboard under **Zero Trust (Cloudflare One)**.

### 1. Add login methods (once per account)

**Integrations → Identity providers → Add an identity provider**

- **One-time PIN** needs no configuration. Cloudflare emails the user a code.
- **Cloudflare** is usually already listed. It signs you in with your Cloudflare dashboard account.

Any other supported identity provider (Google, GitHub, a passkey-capable IdP, and so on) works the same way. Multi-factor authentication and passkeys come from the identity provider you choose.

### 2. Create a reusable policy (once per account)

**Access controls → Policies → Add a policy**

- Name: something like `Owner only`
- Action: `Allow`
- Include → **Emails** → add each allowed address. To use the Cloudflare login method, include your Cloudflare account email as well.
- Session duration: `Same as application session duration`

Everyone the policy allows gets full access to the one shared workspace. The app has no per-user data or roles.

### 3. Create the application (once per site)

**Access controls → Applications → Create new application → Self-hosted**

1. **Destinations:** the subdomain and domain of your installation (for example `notes` and `example.com`). Leave the path blank so the whole site, including `/api/*`, is covered.
2. **Access policies:** under _Add existing policy_, pick the policy from step 2.
3. **Login methods:** select every method you want to offer. A new application does not always pick up a newly added provider on its own.
4. **Details:** a name, and a session duration such as `1 month`. This is how long a browser stays signed in.
5. Click **Create**.

### 4. Configure and deploy the Worker

The Worker needs two values from Zero Trust. Neither is a secret; both go in the `vars` of your private `wrangler.production.jsonc`:

| Variable             | Where to find it                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | **Settings → Team name and domain**, for example `<team>.cloudflareaccess.com`. Host name only, without `https://` or a path.   |
| `ACCESS_AUD`         | The application's **Application Audience (AUD) Tag**, shown in its settings (Overview or Basic information). 64 hex characters. |

Dashboard labels change over time. Both values also appear in the redirect Access sends to an anonymous visitor: the `Location` host is the team domain, and its `kid` query parameter is the AUD tag.

```sh
curl -sI https://notes.example.com/ | grep -i ^location
```

Then validate and deploy:

```sh
npm run check:deploy
npm run deploy
```

`check:deploy` rejects a missing or malformed team domain or AUD tag. It cannot tell whether they belong to the application that actually protects your hostname; step 5 checks that.

### 5. Verify

From a terminal, confirm that anonymous requests to the page and the API are both redirected to Access:

```sh
curl -sI https://notes.example.com/ | grep -i -E "^(HTTP|location)"
curl -sI https://notes.example.com/api/notes | grep -i -E "^(HTTP|location)"
```

Both should return `302` with a `Location` on `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/...`. Then open the site in a private window and sign in through Access with an allowed email. The notes workspace should load directly, with no second login. If it shows **Sign in through Cloudflare Access** or **Cloudflare Access is not configured**, see [Troubleshooting](#troubleshooting).

## What the Worker verifies

Access adds a signed `Cf-Access-Jwt-Assertion` header to every request it lets through. The Worker checks it on every `/api/*` request, so the API stays closed even if the Access application were deleted, pointed at another hostname, or had its policy loosened by mistake:

- **Signature:** RS256, against the team's public keys at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. Keys are cached per Worker isolate for up to an hour. A token signed by an unknown key triggers an early refetch, at most once a minute, so Access key rotation does not lock you out.
- **Issuer:** `https://<team>.cloudflareaccess.com`, from `ACCESS_TEAM_DOMAIN`.
- **Audience:** the application's AUD tag, from `ACCESS_AUD`. A token issued for a different Access application is rejected.
- **Expiry:** the token must carry an `exp` claim and must not have expired.

It fails closed:

| Condition                                                                   | Response                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` missing or malformed                   | `503` "Cloudflare Access is not configured for this installation." |
| Token missing, malformed, wrongly signed, wrong issuer/audience, or expired | `401` "Sign in through Cloudflare Access."                         |
| The team's public keys cannot be fetched                                    | `503`. The app treats it as temporary and retries saves.           |

The signed-in email from the token is returned by `GET /api/session` and shown on the sign-out button. It is not used for authorization; the Access policy decides who gets in.

Static app files are served without this check, but they are still behind Access at the edge and contain no note data.

## How it interacts with the app

- **One session.** The only session is Access's own `CF_Authorization` cookie, with the duration set in step 3. The app issues no cookie of its own and stores no sessions.
- **Signing out.** The header's sign-out icon waits for pending edits to sync, then goes to `/cdn-cgi/access/logout`, which ends the Access session on that browser. If edits cannot sync, it stays signed in and says so.
- **Expiry while the app is open.** When the Access session expires, API requests are redirected to the Access login. The app detects this and shows **Your Cloudflare Access session has expired.** with a **Sign in again** button that reloads the page into the Access login. Unsynced edits are kept in the tab's `sessionStorage` and sync after you sign back in, as long as the same tab is reloaded.
- **Signing out everywhere.** Revoking a user's Access sessions in the Zero Trust dashboard signs out every device. To remove someone, take their email out of the policy and revoke their sessions; an existing session otherwise lasts until it expires. There are no app credentials to rotate.
- **Local development** (`ENVIRONMENT=development` on `localhost` or `127.0.0.1`) skips Access entirely, and the browser tests run in that mode. This exemption never applies on a public hostname.
- **Scheduled cleanup** is a Cron Trigger, not an HTTP request, so Access does not affect it.
- **Automated checks** such as `curl` against `/api/*` receive the Access redirect instead of the app's `401`. That is expected.
- **No bypass paths.** `workers.dev` and preview URLs are disabled in the Wrangler config, and the Worker has no other public origin, so the Custom Domain is the only way in.

## Adding another site

Repeat step 3 with the new hostname and attach the same policy. Steps 1 and 2 do not need to be repeated. A change to the policy applies to every application that uses it. Each application has its own AUD tag, so another installation of this app needs its own `ACCESS_AUD`.

## Useful URLs

- Log out of Access: `https://notes.example.com/cdn-cgi/access/logout`
- Current Access identity (JSON): `https://notes.example.com/cdn-cgi/access/get-identity`

## Troubleshooting

| Symptom                                                                   | Cause / fix                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "That account does not have access"                                       | You signed in with an identity that is not in the policy, often the Cloudflare login under a different email. Add that email to the policy, or log out and use One-time PIN.                                                         |
| No Access login, app loads directly                                       | The application's hostname or path does not match the site, or the hostname is not proxied. The API still refuses requests without a valid token, but fix the application.                                                           |
| PIN email never arrives                                                   | The address is not in the policy. Access only sends codes to addresses a policy allows. Also check spam.                                                                                                                             |
| Only one login option shows                                               | The application's Login methods list is missing a provider (step 3.3).                                                                                                                                                               |
| App says "Sign in through Cloudflare Access" / API `401` after signing in | The token does not match the Worker's configuration. Compare `ACCESS_AUD` with the AUD tag of the application protecting this hostname, and `ACCESS_TEAM_DOMAIN` with the team domain in Zero Trust settings. Redeploy after fixing. |
| App says "Cloudflare Access is not configured"                            | `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing or malformed in the deployed config. Run `npm run check:deploy`, fix the private config, and redeploy.                                                                               |
| "Your Cloudflare Access session has expired."                             | The Access session ended. Click **Sign in again**; unsynced edits in that tab sync afterwards. Lengthen the application's session duration if it happens too often.                                                                  |
| Notes stuck on Waiting to sync                                            | Check connectivity and Worker/D1 health. A persistent `503` can also mean the Worker cannot fetch the team's certificates; check `ACCESS_TEAM_DOMAIN` and Cloudflare status.                                                         |

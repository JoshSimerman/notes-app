# Deployment and Operations

The [README](../README.md#deploy-on-your-own-domain) is the complete fresh-install guide and architecture overview. This runbook is generic: it contains no installation's domain, account ID, database ID, Access team domain, AUD tag, or credentials. [Cloudflare Access](CLOUDFLARE-ACCESS.md) covers sign-in setup.

## Configuration Boundaries

| File or store                          | Purpose                                                                                               | Publish?     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------ |
| `wrangler.jsonc`                       | Generic local/build config and template for a fresh deployment.                                       | Yes.         |
| `.dev.vars.example`                    | Public loopback-only development values (`ENVIRONMENT`, `APP_ORIGIN`).                                | Yes.         |
| `wrangler.production.jsonc`            | Real Worker name, account, D1, origin, domain, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.                    | No; ignored. |
| `.dev.vars`                            | Local development bindings.                                                                           | No; ignored. |
| Cloudflare Access (Zero Trust)         | Access application, policy (allowed emails), login methods, session duration. Lives in the dashboard. | Not a file.  |
| Worker secrets                         | None. The app reads only public `vars`; do not add credentials to them.                               | Never.       |
| `.private/`                            | Optional restricted local deployment records and backups.                                             | Never.       |
| `dist/`, `.wrangler/`, `test-results/` | Generated output, local databases, tool state, screenshots, traces.                                   | No; ignored. |

Use `npm run setup:deploy` to create the private config without replacing an existing one. Relative paths assume it stays in the project root. The deployment wrapper selects it using `NOTES_CONFIG`, uses Vite to build `dist/worker`, and passes that generated config explicitly to Wrangler. This avoids deploying the generic template or a previous installation's stale build.

The Vite plugin can copy local development bindings into ignored `dist/worker/.dev.vars` for local preview. They are not in `dist/client`, are not static assets, and are not production configuration. Do not publish the entire `dist` directory as a source archive or upload it to a different static host.

## Routine Update

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run check:deploy
npm run deploy -- --dry-run
npm run deploy
```

Before a release with new migrations, take a backup and run `npm run db:remote`. Existing migrations are tracked by D1; do not edit an already-applied migration or recreate the database. The deploy command itself does not apply migrations.

Preserve the live Worker name and D1 ID. Renaming the npm package or UI title does not require renaming Cloudflare resources. Do not use a bare `wrangler deploy` after an ordinary generic build; use the wrapper above.

Verify HTTPS, that anonymous requests to `/` and `/api/notes` redirect to the Access login, that signing in through Access loads the workspace, saved notes on a second device, and sign out. Tests run in local development mode, which skips Access, so they do not prove that the production `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` match your Access application.

## Rotate Credentials

The app has no password, session secret, or other credentials of its own, so there is nothing to rotate in the Worker. Sign-in is controlled in Cloudflare Zero Trust:

- **Sign out every device:** revoke the user's Access sessions in the Zero Trust dashboard. Their next request goes back to the Access login.
- **Remove someone:** take their email out of the Access policy, then revoke their sessions. Without revocation an existing session lasts until the application's session duration runs out.
- **Change session length or login methods:** edit the Access application. No redeploy is needed.
- **Replace the Access application:** its new AUD tag must go into `ACCESS_AUD` in the private config, followed by `npm run check:deploy` and `npm run deploy`. Until then the API rejects tokens from the new application with `401`.

Access signing keys rotate automatically; the Worker picks up new keys without a redeploy. Anyone who controls the Cloudflare account can change the Access policy and read the database, so protect the account itself with strong authentication and scoped API tokens.

## Database Backup and Recovery

Create a restricted `.private/` directory, then:

```sh
npx wrangler d1 export DB --remote --config wrangler.production.jsonc --output .private/notes-backup.sql
```

Backups contain notes and settings. Protect them like the database, with restricted access and encryption where appropriate.

### Restore a JSON export or nightly backup

Download the file (Settings → Export notes, or `backups/notes-YYYY-MM-DD.json` from the `BACKUPS` R2 bucket in the dashboard or with `npx wrangler r2 object get <bucket-name>/backups/notes-YYYY-MM-DD.json --remote --file .private/backup.json`), then generate and review the SQL:

```sh
npm run restore -- .private/backup.json .private/restore.sql
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --file .private/restore.sql
```

Each note in the backup replaces the stored note with the same ID, and the note width is restored. Notes created after the backup are kept. Consider an SQL export first so the restore itself can be undone. Open browsers pick up the restored notes on their next refresh; an edit made against a newer copy of a restored note is kept as a recovered copy.

D1 [Time Travel and recovery](https://developers.cloudflare.com/d1/reference/time-travel/) provide additional recovery options subject to current plan limits. For a SQL export, create a separate recovery database, import with `wrangler d1 execute <recovery-database-name> --remote --file <private-backup-path> --config wrangler.production.jsonc`, verify its contents privately, and only then repoint the private `DB` binding and redeploy. Do not import into an existing production database blindly. A restore can revert migration history and revive old note records; review migration state afterward. A backup taken before migration `0002` still contains the old password-login tables, so run `npm run db:remote` against the restored database before using it.

Restoring the entire database is an operational action, not an in-app undo. A code rollback also does not roll back D1 data or migrations. Prefer backward-compatible schema changes and verify code/schema compatibility before any rollback.

## Change the Domain

1. Confirm ownership of the new hostname and check for conflicting DNS records.
2. Add the new hostname as a destination of the existing Access application, or create a new application for it with the same policy. A new application has a new AUD tag, which must go into `ACCESS_AUD`.
3. Update the Custom Domain route and exact HTTPS `APP_ORIGIN` in the private config together.
4. Validate and deploy. Verify the new certificate, that anonymous requests redirect to Access, a real Access sign-in, and notes.
5. Remove the obsolete Custom Domain and its Access destination only after verifying the replacement. Do not delete unrelated DNS records.
6. Update bookmarks. Each browser signs in through Access again at the new host.

Keep the Worker and database identity unless intentionally migrating resources. Zone-wide settings such as minimum TLS, WAF, or redirects affect other sites too; they are outside this app's deployment scripts.

## Troubleshooting

| Symptom                                              | Checks                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy refuses the config                            | Run `npm run check:deploy`. Replace placeholders in the private file, keep HTTPS and matching route/origin, and set a valid `ACCESS_TEAM_DOMAIN` and 64-character `ACCESS_AUD`.                                                                                                 |
| Wrangler selects the wrong account                   | Stop before creating/deploying. Check `wrangler whoami` and the private `account_id`. Renew authorization if needed.                                                                                                                                                            |
| "Cloudflare Access is not configured"                | `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing or malformed in the deployed config. Fix the private config, run `npm run check:deploy`, and redeploy.                                                                                                                          |
| "Sign in through Cloudflare Access" after signing in | The Access token does not match the Worker's config. Compare `ACCESS_AUD` with the AUD tag of the application protecting this hostname and `ACCESS_TEAM_DOMAIN` with the Zero Trust team domain. See [Cloudflare Access troubleshooting](CLOUDFLARE-ACCESS.md#troubleshooting). |
| No Access login; site loads directly                 | The Access application's destination does not cover this hostname, or the hostname is not proxied. The API still refuses requests without a valid token, but fix the application before relying on it.                                                                          |
| "Your Cloudflare Access session has expired."        | The Access session ended. Click **Sign in again**; unsynced edits in that tab sync afterwards. Adjust the Access application's session duration if needed.                                                                                                                      |
| HTTPS or hostname error                              | Check DNS activation, Custom Domain/certificate status, exact origin, port/path mistakes, and DNS caches. Never disable certificate verification as a workaround.                                                                                                               |
| Notes show Waiting to sync                           | Keep the tab open, restore connectivity, check Worker/D1 health and limits, and wait for All saved. Persistent `503` responses can also mean the Worker cannot fetch the Access signing keys. Sign in again if prompted. Avoid clearing storage with pending drafts.            |
| A recovered note appears                             | Two revisions conflicted or a stale note expired from trash. Compare the preserved versions and keep the desired content; this is intentional loss prevention.                                                                                                                  |
| Notes move after an action                           | Priority, due date, pinning, and view membership affect position. Checkbox completion and save time are not sort keys. Completing a due note removes it from a due filter.                                                                                                      |
| A reminder is missing                                | Only active unfinished checklists and dated plain-text notes count. Check the viewing device's local date. There are no background notifications.                                                                                                                               |
| Browser tests cannot connect                         | Stop other local Cloudflare/Vite servers, free 5174, install Chromium, run `setup:local`, and check that `.dev.vars` still matches `.dev.vars.example`. Read the first failure, not just subsequent connection errors.                                                          |
| Local notes seem different from live                 | Local D1, test D1, and remote D1 are deliberately separate. Never use remote data as a browser-test fixture.                                                                                                                                                                    |

## Release Safety

The source tree has no embedded live account, hostname, database, or Access configuration. Before any publication, still inspect the exact staged files and history: `.gitignore` does not untrack files or scrub old commits. Do not archive the working directory wholesale. Keep credentials, local databases, logs, screenshots of personal notes, generated builds, and agent memory private.

Use Cloudflare account protections and scoped deployment access. Store CI tokens in the CI secret store if adding automation; do not bake them into scripts. Review current usage and quotas in the dashboard. The application logs no intentional note bodies or tokens, but infrastructure logs and backups still need access control and retention policies.

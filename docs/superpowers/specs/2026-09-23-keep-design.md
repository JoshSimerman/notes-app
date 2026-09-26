# Notes Design

Build a private, single-user notes application on an owner-configured HTTPS domain. It runs entirely on Cloudflare. Mobile note capture and reliable automatic saving take priority over configuration. See the README for current setup and behavior.

## Architecture

Use current stable React and TypeScript, Vite with the official Cloudflare plugin, a Hono Worker API, and a D1 SQLite database. Workers static assets serve the browser application. No third-party application servers, accounts, or analytics. Cloudflare Custom Domains supplies DNS and TLS. Disable workers.dev and preview URLs.

Alternatives considered: a server-rendered framework adds unnecessary routing and hydration machinery; browser-only storage does not provide cross-device persistence. A same-origin SPA and small Worker is the simplest fit.

## Interface

A compact header contains the Notes identity, search, New note, All Notes/Archive/Trash navigation, settings, and sign out. Priority links (Low/Med/High/Crit) and Due Soon/Past Due links filter active notes. No sidebar. On mobile the header wraps into compact rows with every filter visible. Notes dominate the screen in a responsive grid with adjustable desktop note width. Pinned and Others remain separate sections in filtered views. Priority order is critical, high, medium, low; ties use due date then newest creation time. Completion and autosave do not change sort order. Both cards and the editor offer one-click priority selection with Medium as the default.

Due Soon includes today through three local calendar days ahead. Past Due means before today. Silent amber/red counts on these links flag active checklists with unfinished items and dated plain-text notes. Completed or empty checklists, archive, and trash are excluded. Counts are independent of the current view/search and refresh after edits, every minute, and on return to the tab. No audible alarms. The palette offers 15 named dark solid colors in a five-column grid, plus a custom color input.

Permanent dark theme, regardless of system preference, with no light-mode option. Charcoal (#17191c), dark surfaces (#202327), soft white text (#e7e9ec), mint (#8ecfba), muted gray (#a6adb6), and a small yellow brand accent (#f5ce55) form the base. Colored notes use muted dark green, blue, rose, yellow, and lilac. Legacy pastel and custom bright colors render as dark shades without migrating stored notes. Login, Turnstile, native controls, dialogs, and autofill all use dark styling. Use a native system font for speed and familiarity. Note cards have 8px corners, fine borders, and restrained hover states. Use Lucide icons and labelled tooltips. Use a small bitmap application icon, not decorative imagery.

Notes default to checklists, with title, ordered items, and action icons. Plain text is a per-note option. Open and type without edit/save buttons. The editor is a modal on desktop and full screen on mobile. Completed items can be collapsed per note; this preference is persisted in D1. Notes support pinning, archiving, soft deletion, restoration, solid palette/custom colors, four priorities, and a date-only due date. Due dates are interpreted in the viewer's local calendar, with overdue, today, tomorrow, and soon indicators. Archive and trash are separate header views. Trash expires after 90 days via a daily scheduled Worker; expired notes are excluded immediately from reads and writes.

## Security

APP_PASSWORD is a Cloudflare secret, never a VITE variable or stored in source. A standard HTML password form uses autocomplete=current-password for password managers. Production requires a real Turnstile site key/secret, server-side verification of token, hostname, and action, and persistent atomic rate limiting. Enforce five attempts per IP per 15 minutes and a global ceiling of 30 verified attempts per 15 minutes.

Sessions use random 256-bit opaque tokens; only hashes are stored in D1. Set a __Host- cookie with Secure, HttpOnly, SameSite=Strict, Path=/ and a fixed one-year expiry. Password changes invalidate all existing sessions via a keyed password fingerprint. Sign out deletes the session server-side and clears tab drafts. Origin validation, a custom request header, JSON-only mutations, bounded request bodies, strict schema validation, parameterized SQL, CSP, HSTS, nosniff, and no-store protect the API and application. Production accepts only the configured HTTPS origin. No note data is embedded in static assets or service-worker caches. Notes are not end-to-end encrypted; the authenticated Worker and D1 can read them.

## Persistence

Store each note document with version, timestamps, status, and last mutation ID. Conditional writes prevent another device's edits from being silently overwritten. A mutation ID makes a retry after a lost response idempotent. On a version conflict, retain both versions by creating a recovery copy and informing the user. A tab-scoped sessionStorage journal retains unsaved edits through refresh, retries after interrupted connections, and is cleared after save/sign out. Save status stays unobtrusive but truthful. Offline edits can be queued after the app has loaded; a fully offline application is outside this scope.

Poll for cross-device changes while the page is visible, skip locally pending notes, and refresh on focus. Warn before leaving with unsaved edits. Sign out waits for pending saves and remains signed in if they cannot be saved. Settings persist in D1. Never claim an edit is saved until acknowledged by the API.

## Verification and Delivery

Test authentication, CSRF/origin guards, cooldowns, session invalidation, validation, concurrent writes, idempotency, expiry, and CRUD against the local Worker/D1 runtime. Test desktop/mobile UI, keyboard navigation, autosave/reload, note controls, search, conflict recovery, and sign out with Playwright. Run TypeScript checking, production build, dependency audit, and deployment dry run. Prepare deployment instructions; live deployment depends on Cloudflare account access and user-provided production secrets.

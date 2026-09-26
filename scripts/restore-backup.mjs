// Turns an export or nightly backup into SQL that restores it into D1:
//   node scripts/restore-backup.mjs <backup.json> [output.sql]
// Notes in the backup replace the stored copy with the same ID; notes created
// after the backup are left alone. Review the SQL, then apply it with
//   npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --file <output.sql>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const [input, output = path.join(".private", "restore.sql")] =
  process.argv.slice(2);
if (!input) {
  console.error(
    "Usage: node scripts/restore-backup.mjs <backup.json> [output.sql]",
  );
  process.exit(1);
}
const backup = JSON.parse(await readFile(input, "utf8"));
if (backup.format !== "notes-app-export" || backup.version !== 1)
  throw new Error("This file is not a notes-app export (format version 1).");

const text = (value) =>
  value === null || value === undefined
    ? "NULL"
    : `'${String(value).replaceAll("'", "''")}'`;
const number = (value) => (Number.isFinite(value) ? String(value) : "NULL");
const statements = backup.notes.map(
  (note) =>
    `INSERT INTO notes(id, document, version, status, deleted_at, updated_at, last_mutation) VALUES(${[
      text(note.id),
      text(JSON.stringify(note)),
      number(note.version),
      text(note.status),
      number(note.deletedAt),
      number(note.updatedAt),
      text(randomUUID()),
    ].join(
      ", ",
    )}) ON CONFLICT(id) DO UPDATE SET document = excluded.document, version = excluded.version, status = excluded.status, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at, last_mutation = excluded.last_mutation;`,
);
statements.push(
  `UPDATE settings SET note_width = ${number(backup.noteWidth)} WHERE id = 1;`,
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, statements.join("\n") + "\n", { mode: 0o600 });
console.log(
  `Wrote ${backup.notes.length} notes from ${backup.exportedAt} to ${output}.`,
);

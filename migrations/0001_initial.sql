CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived', 'trashed')),
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL,
  last_mutation TEXT NOT NULL
);
CREATE INDEX notes_status ON notes(status, deleted_at);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  password_tag TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), note_width INTEGER NOT NULL DEFAULT 300);
INSERT INTO settings(id, note_width) VALUES(1, 300);

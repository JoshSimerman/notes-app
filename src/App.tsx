import { useEffect, useRef, useState } from "react";
import {
  Archive,
  AlarmClock,
  Bell,
  CloudCheck,
  CloudOff,
  Download,
  LoaderCircle,
  LogOut,
  NotebookPen,
  Plus,
  Search,
  Settings2,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError, type Session } from "./api";
import { useNotes } from "./useNotes";
import {
  dueAttention,
  matchesNoteView,
  sortNotes,
  type Note,
  type NoteView,
} from "../shared/notes";
import { NoteCard } from "./components/NoteCard";
import { Editor } from "./components/Editor";
import type { EditorFocus } from "./editorFocus";
import { CloseButton, IconButton, Modal } from "./components/Primitives";

function Workspace({
  session,
  onExpired,
}: {
  session: Session;
  onExpired: (message: string) => void;
}) {
  const [editing, setEditing] = useState<{
    id: string;
    focus?: EditorFocus;
  } | null>(null);
  const store = useNotes(onExpired, (from, to) =>
    setEditing((current) =>
      current?.id === from ? { ...current, id: to } : current,
    ),
  );
  const interactionLock = useRef(false);
  const [view, setView] = useState<NoteView>("active");
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState(false);
  const [width, setWidth] = useState(300);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    const refreshDate = () => setNow(new Date());
    const timer = setInterval(refreshDate, 60000);
    window.addEventListener("focus", refreshDate);
    document.addEventListener("visibilitychange", refreshDate);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshDate);
      document.removeEventListener("visibilitychange", refreshDate);
    };
  }, []);
  const query = search.trim().toLocaleLowerCase();
  const filtered = sortNotes(
    store.notes.filter(
      (n) =>
        matchesNoteView(n, view, now) &&
        (!query ||
          `${n.title}\n${n.content}\n${n.items.map((i) => i.text).join("\n")}`
            .toLocaleLowerCase()
            .includes(query)),
    ),
  );
  const pinned = filtered.filter((n) => n.pinned);
  const others = filtered.filter((n) => !n.pinned);
  const current = store.notes.find((n) => n.id === editing?.id);
  const activeView = view !== "archived" && view !== "trashed";
  const dueCounts = { soon: 0, overdue: 0 };
  for (const note of store.notes) {
    const tone = dueAttention(note, now);
    if (tone) dueCounts[tone]++;
  }
  const filterLabels = {
    low: "Low priority",
    medium: "Medium priority",
    high: "High priority",
    critical: "Critical priority",
    "due-soon": "Due soon",
    "past-due": "Past due",
  };
  const filterLabel =
    view in filterLabels
      ? filterLabels[view as keyof typeof filterLabels]
      : null;
  // Single-key shortcuts, ignored while typing or while a dialog is open.
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcuts.current = (e) => {
    const target = e.target as HTMLElement;
    if (
      e.defaultPrevented ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      editing ||
      settings ||
      target.closest("input, textarea, select, [contenteditable]")
    )
      return;
    const views: Record<string, NoteView> = {
      "1": "active",
      "2": "archived",
      "3": "trashed",
    };
    if (e.key === "c" || e.key === "n") {
      e.preventDefault();
      if (store.ready) create();
    } else if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (views[e.key]) {
      selectView(views[e.key]);
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  function selectView(value: NoteView) {
    setView(value);
    setSearch("");
  }
  const [undo, setUndo] = useState<{
    id: string;
    message: string;
    status: Note["status"];
  } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);
  function change(note: Note) {
    if (interactionLock.current) return;
    const previous = store.notes.find((n) => n.id === note.id);
    if (previous && previous.status !== note.status)
      setUndo({
        id: note.id,
        status: previous.status,
        message:
          note.status === "trashed"
            ? "Note moved to trash"
            : note.status === "archived"
              ? "Note archived"
              : previous.status === "trashed"
                ? "Note restored"
                : "Note unarchived",
      });
    store.change(note);
  }
  function undoStatus() {
    const note = undo && store.notes.find((n) => n.id === undo.id);
    setUndo(null);
    if (note && !interactionLock.current)
      store.change({
        ...note,
        status: undo.status,
        deletedAt: undo.status === "trashed" ? note.deletedAt : null,
      });
  }
  function create() {
    if (interactionLock.current) return;
    setView("active");
    setSearch("");
    setEditing({ id: store.create() });
  }
  async function logout() {
    interactionLock.current = true;
    setSigningOut(true);
    if (!(await store.flush())) {
      store.setMessage(
        "Your latest edits have not synced. Stay connected and try signing out again.",
      );
      interactionLock.current = false;
      setSigningOut(false);
      return;
    }
    sessionStorage.removeItem("keep.pending.v1");
    window.location.assign("/cdn-cgi/access/logout");
  }
  function section(label: string, notes: Note[]) {
    return (
      notes.length > 0 && (
        <section className="notes-section" aria-label={label}>
          <div className="section-heading">
            <h2>{label}</h2>
            <span>{notes.length}</span>
          </div>
          <div
            className="notes-grid"
            style={
              { "--note-width": `${store.noteWidth}px` } as React.CSSProperties
            }
          >
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onChange={change}
                onOpen={(focus) => setEditing({ id: note.id, focus })}
              />
            ))}
          </div>
        </section>
      )
    );
  }
  return (
    <div className="app" inert={signingOut}>
      <header className="app-header">
        <div className="header-main">
          <a
            href="/"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              setView("active");
              setSearch("");
            }}
          >
            <img src="/icon.png" alt="" />
            <span>Notes</span>
          </a>
          <div className="search-field">
            <Search size={19} />
            <input
              ref={searchRef}
              aria-label="Search notes"
              aria-keyshortcuts="/"
              placeholder="Search your notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  e.currentTarget.blur();
                }
              }}
            />
            {search && (
              <IconButton label="Clear search" onClick={() => setSearch("")}>
                <X size={16} />
              </IconButton>
            )}
          </div>
          <button
            className="primary new-note"
            aria-keyshortcuts="c n"
            onClick={create}
            disabled={!store.ready || signingOut}
          >
            <Plus size={20} />
            <span>New note</span>
          </button>
          <div className="header-tools">
            <span
              className={
                store.status === "All saved"
                  ? "sync-status saved"
                  : "sync-status"
              }
              role="status"
              title={store.status}
              aria-label={store.status}
            >
              {store.status === "All saved" ? (
                <CloudCheck size={18} />
              ) : store.status === "Saving" || store.status === "Loading" ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <CloudOff size={18} />
              )}
              {store.status !== "All saved" && <span>{store.status}</span>}
            </span>
            <IconButton
              label="Settings"
              onClick={() => {
                setWidth(store.noteWidth);
                setSettings(true);
              }}
            >
              <Settings2 size={20} />
            </IconButton>
            <IconButton
              label={session.email ? `Sign out ${session.email}` : "Sign out"}
              disabled={signingOut}
              onClick={() => void logout()}
            >
              {signingOut ? (
                <LoaderCircle size={20} className="spin" />
              ) : (
                <LogOut size={20} />
              )}
            </IconButton>
          </div>
        </div>
        <div className="header-secondary">
          <nav aria-label="Notes views">
            <div className="nav-group view-links">
              {(
                [
                  { value: "active", label: "All Notes", icon: StickyNote },
                  { value: "archived", label: "Archive", icon: Archive },
                  { value: "trashed", label: "Trash", icon: Trash2 },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => selectView(value)}
                  aria-current={view === value ? "page" : undefined}
                >
                  <Icon size={17} />
                  {label}
                  <span className="tab-count">
                    {store.notes.filter((n) => n.status === value).length}
                  </span>
                </button>
              ))}
            </div>
            <div
              className="nav-group priority-links"
              role="group"
              aria-label="Priority filters"
            >
              {(
                [
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Med" },
                  { value: "high", label: "High" },
                  { value: "critical", label: "Crit" },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => selectView(value)}
                  aria-current={view === value ? "page" : undefined}
                  title={filterLabels[value]}
                >
                  <span
                    className={`priority-dot ${value}`}
                    aria-hidden="true"
                  />
                  {label}
                </button>
              ))}
            </div>
            <div
              className="nav-group due-links"
              role="group"
              aria-label="Due date filters"
            >
              {(
                [
                  {
                    value: "due-soon",
                    label: "Due Soon",
                    tone: "soon",
                    icon: Bell,
                  },
                  {
                    value: "past-due",
                    label: "Past Due",
                    tone: "overdue",
                    icon: AlarmClock,
                  },
                ] as const
              ).map(({ value, label, tone, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => selectView(value)}
                  className={`due-filter ${tone} ${dueCounts[tone] ? "has-alert" : ""}`}
                  aria-current={view === value ? "page" : undefined}
                  title={`${dueCounts[tone]} ${dueCounts[tone] === 1 ? "note" : "notes"} with unfinished work ${tone === "soon" ? "due today or within 3 days" : "past due"}`}
                >
                  <Icon size={17} />
                  {label}
                  <span className="due-count">{dueCounts[tone]}</span>
                </button>
              ))}
            </div>
          </nav>
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {store.ready
              ? `${dueCounts.overdue} notes past due. ${dueCounts.soon} notes due within 3 days.`
              : ""}
          </span>
        </div>
      </header>
      <main className="workspace">
        {store.message && (
          <div className="notice" role="alert">
            <span>{store.message}</span>
            <IconButton
              label="Dismiss message"
              onClick={() => store.setMessage("")}
            >
              <X size={16} />
            </IconButton>
          </div>
        )}
        {view === "trashed" && (
          <div className="view-intro">
            <h1>Trash</h1>
            <span>Notes are permanently removed after 90 days.</span>
          </div>
        )}
        {view === "archived" && (
          <div className="view-intro">
            <h1>Archive</h1>
            <span>
              {filtered.length} {filtered.length === 1 ? "note" : "notes"}
            </span>
          </div>
        )}
        {filterLabel && (
          <div className="view-intro">
            <h1>{filterLabel}</h1>
            <span>
              {filtered.length} {filtered.length === 1 ? "note" : "notes"}
            </span>
          </div>
        )}
        {query && (
          <div className="search-results">
            {filtered.length} {filtered.length === 1 ? "result" : "results"} for{" "}
            <strong>{search}</strong>
          </div>
        )}
        {!store.ready ? (
          <div className="empty-state">
            <LoaderCircle size={28} className="spin" />
            <h1>
              {store.status === "Loading"
                ? "Loading your notes"
                : "Waiting for a connection"}
            </h1>
            <button
              className="text-button"
              onClick={() => void store.refresh()}
            >
              Try again
            </button>
          </div>
        ) : filtered.length ? (
          <>
            {activeView ? (
              <>
                {section("Pinned", pinned)}
                {section("Others", others)}
              </>
            ) : (
              section(
                view === "archived" ? "Archived notes" : "Deleted notes",
                filtered,
              )
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-art">
              {query ? (
                <Search size={36} />
              ) : view === "past-due" ? (
                <AlarmClock size={36} />
              ) : view === "due-soon" ? (
                <Bell size={36} />
              ) : view === "archived" ? (
                <Archive size={36} />
              ) : view === "trashed" ? (
                <Trash2 size={36} />
              ) : (
                <NotebookPen size={38} />
              )}
            </div>
            <h1>
              {query
                ? "No matching notes"
                : view === "past-due"
                  ? "Nothing past due"
                  : view === "due-soon"
                    ? "Nothing due soon"
                    : filterLabel
                      ? "No notes at this priority"
                      : view === "archived"
                        ? "Nothing in the archive"
                        : view === "trashed"
                          ? "The trash is empty"
                          : "A little space for your thoughts."}
            </h1>
            <p>
              {query
                ? "Try another word or phrase."
                : view === "active"
                  ? "What would you like to remember?"
                  : ""}
            </p>
            {!query && view === "active" && (
              <button className="primary" onClick={create}>
                <Plus size={18} />
                New note
              </button>
            )}
          </div>
        )}
      </main>
      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.message}</span>
          <button className="text-button" onClick={undoStatus}>
            Undo
          </button>
          <IconButton label="Dismiss" onClick={() => setUndo(null)}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {current && (
        <Editor
          note={current}
          initialFocus={editing?.focus}
          status={store.status}
          onChange={change}
          onClose={() => setEditing(null)}
        />
      )}
      {settings && (
        <Modal
          title="Settings"
          onClose={() => setSettings(false)}
          className="settings-modal"
        >
          <div className="settings-heading">
            <h2>Settings</h2>
            <CloseButton onClick={() => setSettings(false)} />
          </div>
          <label className="width-setting" htmlFor="note-width">
            <span>
              Note width<output>{width}px</output>
            </span>
            <input
              id="note-width"
              type="range"
              min="240"
              max="440"
              step="20"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              onPointerUp={() => void store.changeWidth(width)}
              onKeyUp={() => void store.changeWidth(width)}
            />
          </label>
          <div className="width-preview">
            <div style={{ width: Math.round(width * 0.65) }}>
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="shortcut-setting">
            <span>Keyboard shortcuts</span>
            <dl>
              <dt>
                <kbd>C</kbd> or <kbd>N</kbd>
              </dt>
              <dd>New note</dd>
              <dt>
                <kbd>/</kbd>
              </dt>
              <dd>Search (Esc clears)</dd>
              <dt>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
              </dt>
              <dd>All Notes, Archive, Trash</dd>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Close the open note</dd>
            </dl>
          </div>
          <div className="export-setting">
            <div>
              <span>Export notes</span>
              <p>
                Download every note, including archive and trash, as a JSON
                file.
              </p>
            </div>
            <a className="text-button" href="/api/export" download>
              <Download size={17} />
              Download
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState("");
  const load = async () => {
    try {
      setSession(await api<Session>("/session"));
      setError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        setExpired(err.message);
      else
        setError(err instanceof ApiError ? err.message : "Unable to connect.");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (expired)
    return (
      <div className="app-loading">
        <img src="/icon.png" alt="Notes" />
        <p>{expired}</p>
        <button
          className="text-button"
          onClick={() => window.location.reload()}
        >
          Sign in again
        </button>
      </div>
    );
  if (!session)
    return (
      <div className="app-loading">
        <img src="/icon.png" alt="Notes" />
        {error ? (
          <>
            <p>{error}</p>
            <button className="text-button" onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" size={20} />
        )}
      </div>
    );
  return <Workspace session={session} onExpired={setExpired} />;
}

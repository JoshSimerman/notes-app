import { useRef } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Pin,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  dueStatus,
  darkNoteColor,
  inkColor,
  type Note,
} from "../../shared/notes";
import { IconButton } from "./Primitives";
import { Linkified } from "./Linkified";
import { PriorityPicker } from "./PriorityPicker";
import { clickedOffset, type EditorFocus } from "../editorFocus";

export function NoteCard({
  note,
  onChange,
  onOpen,
}: {
  note: Note;
  onChange: (note: Note) => void;
  onOpen: (focus?: EditorFocus) => void;
}) {
  const due = dueStatus(note.dueDate);
  const background = darkNoteColor(note.color);
  const completed = note.items.filter((i) => i.done);
  const active = note.items.filter((i) => !i.done);
  const trashed = note.status === "trashed";
  const dateInput = useRef<HTMLInputElement>(null);
  function pickDueDate() {
    const input = dateInput.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }
  function itemRow(item: Note["items"][number]) {
    return (
      <div className={`check-row ${item.done ? "checked" : ""}`} key={item.id}>
        <input
          type="checkbox"
          checked={item.done}
          disabled={trashed}
          aria-label={item.text || "Empty item"}
          onChange={() =>
            onChange({
              ...note,
              items: note.items.map((i) =>
                i.id === item.id ? { ...i, done: !i.done } : i,
              ),
            })
          }
        />
        <span
          onClick={(e) => {
            onOpen({
              field: "item",
              itemId: item.id,
              offset: clickedOffset(e),
            });
          }}
        >
          {item.text ? (
            <Linkified text={item.text} />
          ) : (
            <span className="muted">Empty item</span>
          )}
        </span>
      </div>
    );
  }
  return (
    <article
      className="note-card"
      style={{ background, color: inkColor(background) }}
    >
      <div className="card-heading">
        <button
          className="note-title"
          onClick={(e) => onOpen({ field: "title", offset: clickedOffset(e) })}
        >
          {note.title || "Untitled"}
        </button>
        {!trashed && (
          <IconButton
            label={note.pinned ? "Unpin note" : "Pin note"}
            aria-pressed={note.pinned}
            onClick={() => onChange({ ...note, pinned: !note.pinned })}
          >
            {note.pinned ? (
              <Pin size={17} fill="currentColor" />
            ) : (
              <Pin size={17} />
            )}
          </IconButton>
        )}
      </div>
      {note.kind === "list" ? (
        <div className="card-items">
          {active.slice(0, 8).map(itemRow)}
          {active.length > 8 && (
            <button className="text-button more-items" onClick={() => onOpen()}>
              +{active.length - 8} more items
            </button>
          )}
          {!note.items.length && (
            <button className="empty-note" onClick={() => onOpen()}>
              List item...
            </button>
          )}
          {completed.length > 0 && (
            <>
              <button
                className="completed-toggle"
                onClick={() =>
                  onChange({ ...note, showCompleted: !note.showCompleted })
                }
                aria-expanded={note.showCompleted}
                disabled={trashed}
              >
                {note.showCompleted ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                {completed.length} of {note.items.length} completed
              </button>
              {note.showCompleted && completed.slice(0, 3).map(itemRow)}
              {note.showCompleted && completed.length > 3 && (
                <button
                  className="text-button more-items"
                  onClick={() => onOpen()}
                >
                  +{completed.length - 3} completed
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        // A div rather than a button so the text can contain real links.
        <div
          className="note-content"
          role="button"
          tabIndex={0}
          onClick={(e) =>
            onOpen({ field: "content", offset: clickedOffset(e) })
          }
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen({ field: "content", offset: 0 });
            }
          }}
        >
          {note.content ? (
            <Linkified text={note.content} />
          ) : (
            <span className="muted">Note...</span>
          )}
        </div>
      )}
      <div className="card-meta">
        {due &&
          (trashed ? (
            <span className={`due-badge ${due.tone}`}>
              <CalendarDays size={13} />
              {due.label}
            </span>
          ) : (
            <button
              type="button"
              className={`due-badge ${due.tone}`}
              aria-label={`Due ${due.label}. Change due date`}
              title="Change due date"
              onClick={pickDueDate}
            >
              <CalendarDays size={13} />
              {due.label}
            </button>
          ))}
        {!trashed && (
          <input
            ref={dateInput}
            type="date"
            className="card-date-input"
            aria-label="Due date"
            tabIndex={-1}
            value={note.dueDate ?? ""}
            onChange={(e) =>
              onChange({ ...note, dueDate: e.target.value || null })
            }
          />
        )}
      </div>
      <div className="card-footer">
        {trashed ? (
          <span className="note-kind">
            {Math.max(
              0,
              90 -
                Math.floor(
                  (Date.now() - (note.deletedAt ?? Date.now())) / 86400000,
                ),
            )}{" "}
            days left
          </span>
        ) : (
          <PriorityPicker
            compact
            value={note.priority}
            onChange={(priority) => onChange({ ...note, priority })}
          />
        )}
        <div className="card-actions">
          {trashed ? (
            <IconButton
              label="Restore note"
              onClick={() =>
                onChange({ ...note, status: "active", deletedAt: null })
              }
            >
              <RotateCcw size={17} />
            </IconButton>
          ) : (
            <>
              {!note.dueDate && (
                <IconButton label="Set due date" onClick={pickDueDate}>
                  <CalendarPlus size={17} />
                </IconButton>
              )}
              <IconButton
                label={
                  note.status === "archived" ? "Unarchive note" : "Archive note"
                }
                onClick={() =>
                  onChange({
                    ...note,
                    status: note.status === "archived" ? "active" : "archived",
                  })
                }
              >
                {note.status === "archived" ? (
                  <ArchiveRestore size={17} />
                ) : (
                  <Archive size={17} />
                )}
              </IconButton>
              <IconButton
                label="Move to trash"
                onClick={() => onChange({ ...note, status: "trashed" })}
              >
                <Trash2 size={17} />
              </IconButton>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

import { useRef } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Pin,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  dueAttention,
  dueStatus,
  listRows,
  noteColor,
  toggleItem,
  type ItemRow,
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
  const background = noteColor(note.color);
  const attention = dueAttention(note);
  const { active, completed } = listRows(note.items);
  // Long lists can fold down to their first few unchecked items.
  const collapsible = active.length > 10;
  const shown = collapsible && note.collapsed ? active.slice(0, 8) : active;
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
  function itemRow({ item, level }: ItemRow) {
    return (
      <div
        className={`check-row ${item.done ? "checked" : ""} ${level ? "nested" : ""}`}
        key={item.id}
      >
        <input
          type="checkbox"
          checked={item.done}
          disabled={trashed}
          aria-label={item.text || "Empty item"}
          onChange={() =>
            onChange({ ...note, items: toggleItem(note.items, item.id) })
          }
        />
        <span
          onClick={(e) => {
            e.stopPropagation();
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
      className={`note-card ${attention ? `due-${attention}` : ""}`}
      style={{ background }}
      // Clicking any part of the card that isn't a control opens the note.
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest("button, input, a, label, [role=button]")) onOpen();
      }}
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
          {shown.map(itemRow)}
          {collapsible && (
            <button
              className="text-button collapse-toggle"
              onClick={() => onChange({ ...note, collapsed: !note.collapsed })}
              aria-expanded={!note.collapsed}
              disabled={trashed}
            >
              {note.collapsed ? (
                <>
                  <ChevronDown size={14} />
                  {active.length - shown.length} more items
                </>
              ) : (
                <>
                  <ChevronUp size={14} />
                  Show less
                </>
              )}
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

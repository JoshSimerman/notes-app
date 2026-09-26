import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ListTodo,
  Palette,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  colorPalette,
  darkNoteColor,
  inkColor,
  convertNote,
  type Note,
  type Item,
} from "../../shared/notes";
import { Modal, IconButton, CloseButton } from "./Primitives";
import { PriorityPicker } from "./PriorityPicker";
import { LinkChips } from "./Linkified";
import type { EditorFocus } from "../editorFocus";

export function Editor({
  note,
  status,
  initialFocus,
  onChange,
  onClose,
}: {
  note: Note;
  status: string;
  initialFocus?: EditorFocus;
  onChange: (note: Note) => void;
  onClose: () => void;
}) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [conversionMessage, setConversionMessage] = useState("");
  const rows = useRef(new Map<string, HTMLDivElement>());
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    to: number;
    offset: number;
    shift: number;
  } | null>(null);
  const trashed = note.status === "trashed";
  const background = darkNoteColor(note.color);
  const completed = note.items.filter((i) => i.done);
  const active = note.items.filter((i) => !i.done);
  function focusOnOpen() {
    const target =
      initialFocus?.field === "item"
        ? refs.current.get(initialFocus.itemId)
        : initialFocus?.field === "content"
          ? contentRef.current
          : titleRef.current;
    const input = target ?? titleRef.current;
    if (!input) return;
    const offset = Math.min(initialFocus?.offset ?? 0, input.value.length);
    input.focus({ preventScroll: true });
    input.setSelectionRange(offset, offset);
    input.scrollIntoView({ block: "nearest" });
  }
  function add(after?: string) {
    const item: Item = { id: crypto.randomUUID(), text: "", done: false };
    const items = [...note.items];
    const index = after
      ? items.findIndex((i) => i.id === after) + 1
      : items.length;
    items.splice(index, 0, item);
    onChange({ ...note, items });
    setTimeout(() => refs.current.get(item.id)?.focus(), 0);
  }
  function remove(id: string) {
    const index = note.items.findIndex((i) => i.id === id);
    const previous = note.items[index - 1];
    onChange({ ...note, items: note.items.filter((i) => i.id !== id) });
    if (previous) setTimeout(() => refs.current.get(previous.id)?.focus(), 0);
  }
  // Unchecked items reorder among themselves; checked items keep their slots.
  function moveActive(from: number, to: number) {
    if (from === to) return;
    const order = active.map((i) => i.id);
    order.splice(to, 0, ...order.splice(from, 1));
    const byId = new Map(note.items.map((i) => [i.id, i]));
    let next = 0;
    onChange({
      ...note,
      items: note.items.map((i) => (i.done ? i : byId.get(order[next++])!)),
    });
  }
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    const body = bodyRef.current;
    if (event.button !== 0 || !body) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const from = active.findIndex((i) => i.id === id);
    const top = (el: HTMLElement) =>
      el.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop;
    // Row positions in scroll-content coordinates, measured once at the start.
    const slots = active.map((i) => {
      const el = rows.current.get(i.id)!;
      return { top: top(el), height: el.offsetHeight };
    });
    const gap =
      slots.length > 1 ? slots[1].top - slots[0].top - slots[0].height : 0;
    const shift = slots[from].height + gap;
    const startY = event.clientY + body.scrollTop;
    let pointerY = event.clientY;
    let current = { id, from, to: from, offset: 0, shift };
    setDrag(current);
    const update = () => {
      const offset = pointerY + body.scrollTop - startY;
      const center = slots[from].top + slots[from].height / 2 + offset;
      let to = from;
      slots.forEach((slot, i) => {
        const middle = slot.top + slot.height / 2;
        if (
          (i > from && center > middle) ||
          (i < from && center < middle && to === from)
        )
          to = i;
      });
      current = { ...current, to, offset };
      setDrag(current);
    };
    let frame = 0;
    const autoscroll = () => {
      const bounds = body.getBoundingClientRect();
      const edge = 48;
      const speed =
        pointerY < bounds.top + edge
          ? -Math.ceil((bounds.top + edge - pointerY) / 4)
          : pointerY > bounds.bottom - edge
            ? Math.ceil((pointerY - bounds.bottom + edge) / 4)
            : 0;
      if (speed) {
        body.scrollTop += speed;
        update();
      }
      frame = requestAnimationFrame(autoscroll);
    };
    frame = requestAnimationFrame(autoscroll);
    const move = (e: PointerEvent) => {
      pointerY = e.clientY;
      update();
    };
    const end = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDrag(null);
      if (e.type === "pointerup") moveActive(current.from, current.to);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function rowStyle(index: number) {
    if (!drag) return undefined;
    if (index === drag.from)
      return { transform: `translateY(${drag.offset}px)` };
    const y =
      drag.from < index && index <= drag.to
        ? -drag.shift
        : drag.to <= index && index < drag.from
          ? drag.shift
          : 0;
    return { transform: `translateY(${y}px)` };
  }
  function switchKind(kind: Note["kind"]) {
    const converted = convertNote(note, kind);
    if (converted) {
      onChange(converted);
      setConversionMessage("");
    } else
      setConversionMessage(
        "This note is too long to convert. Its current format has been kept.",
      );
  }
  function itemRow(item: Item, index: number) {
    const draggable = !trashed && !item.done;
    return (
      <div
        key={item.id}
        ref={(el) => {
          if (el) rows.current.set(item.id, el);
          else rows.current.delete(item.id);
        }}
        className={`editor-item check-row ${item.done ? "checked" : ""} ${
          drag?.id === item.id ? "dragging" : ""
        } ${drag ? "reordering" : ""}`}
        style={item.done ? undefined : rowStyle(index)}
      >
        {draggable ? (
          <button
            type="button"
            className="drag-handle"
            aria-label={`Reorder ${item.text || "item"}`}
            title="Drag to reorder (or use arrow keys)"
            onPointerDown={(e) => startDrag(e, item.id)}
            onKeyDown={(e) => {
              const to =
                e.key === "ArrowUp"
                  ? index - 1
                  : e.key === "ArrowDown"
                    ? index + 1
                    : -1;
              if (to < 0 || to >= active.length) return;
              e.preventDefault();
              moveActive(index, to);
              setTimeout(
                () =>
                  rows.current
                    .get(item.id)
                    ?.querySelector<HTMLButtonElement>(".drag-handle")
                    ?.focus(),
                0,
              );
            }}
          >
            <GripVertical size={18} />
          </button>
        ) : (
          !trashed && <span className="drag-handle-spacer" />
        )}
        <input
          type="checkbox"
          aria-label={`Complete ${item.text || "item"}`}
          checked={item.done}
          disabled={trashed}
          onChange={() =>
            onChange({
              ...note,
              items: note.items.map((i) =>
                i.id === item.id ? { ...i, done: !i.done } : i,
              ),
            })
          }
        />
        <textarea
          ref={(el) => {
            if (el) refs.current.set(item.id, el);
            else refs.current.delete(item.id);
          }}
          rows={1}
          aria-label="List item"
          placeholder="List item"
          maxLength={5000}
          value={item.text}
          readOnly={trashed}
          onChange={(e) =>
            onChange({
              ...note,
              items: note.items.map((i) =>
                i.id === item.id ? { ...i, text: e.target.value } : i,
              ),
            })
          }
          onKeyDown={(e) => {
            if (trashed || e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              add(item.id);
            }
            if (e.key === "Backspace" && !item.text) {
              e.preventDefault();
              remove(item.id);
            }
          }}
        />
        {!trashed && (
          <IconButton label="Remove item" onClick={() => remove(item.id)}>
            <X size={16} />
          </IconButton>
        )}
      </div>
    );
  }
  return (
    <Modal
      title="Note editor"
      onClose={onClose}
      onOpen={focusOnOpen}
      className="editor-modal"
    >
      <div
        className="editor-surface"
        style={
          {
            background,
            color: inkColor(background),
            "--note-background": background,
          } as React.CSSProperties
        }
      >
        <div className="editor-top">
          <span className="save-indicator" role="status">
            <span
              className={
                status === "All saved" ? "status-dot saved" : "status-dot"
              }
            />
            {status}
          </span>
          <div className="editor-top-actions">
            {!trashed && (
              <IconButton
                label={note.pinned ? "Unpin note" : "Pin note"}
                aria-pressed={note.pinned}
                onClick={() => onChange({ ...note, pinned: !note.pinned })}
              >
                <Pin size={19} fill={note.pinned ? "currentColor" : "none"} />
              </IconButton>
            )}
            <CloseButton onClick={onClose} />
          </div>
        </div>
        <div className="editor-body" ref={bodyRef}>
          <textarea
            ref={titleRef}
            className="editor-title"
            aria-label="Note title"
            placeholder="Title"
            rows={1}
            maxLength={300}
            value={note.title}
            readOnly={trashed}
            onChange={(e) => onChange({ ...note, title: e.target.value })}
          />
          {note.kind === "list" ? (
            <div className="editor-list">
              {active.map(itemRow)}
              {!trashed && (
                <button className="add-item" onClick={() => add()}>
                  <Plus size={19} />
                  List item
                </button>
              )}
              {!!completed.length && (
                <>
                  <button
                    className="completed-toggle"
                    onClick={() =>
                      onChange({ ...note, showCompleted: !note.showCompleted })
                    }
                    disabled={trashed}
                    aria-expanded={note.showCompleted}
                  >
                    {note.showCompleted ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    {completed.length} of {note.items.length} completed
                  </button>
                  {note.showCompleted && completed.map(itemRow)}
                </>
              )}
            </div>
          ) : (
            <textarea
              ref={contentRef}
              className="editor-text"
              aria-label="Note content"
              placeholder="Note..."
              value={note.content}
              readOnly={trashed}
              maxLength={100000}
              onChange={(e) => onChange({ ...note, content: e.target.value })}
            />
          )}
          <LinkChips
            texts={[note.title, note.content, ...note.items.map((i) => i.text)]}
          />
        </div>
        {conversionMessage && (
          <p className="conversion-message" role="status">
            {conversionMessage}
          </p>
        )}
        {!trashed && (
          <div className="editor-properties">
            <div className="property">
              <span>Priority</span>
              <PriorityPicker
                value={note.priority}
                onChange={(priority) => onChange({ ...note, priority })}
              />
            </div>
            <label className="property due-property">
              <span>
                <CalendarDays size={14} />
                Due date
              </span>
              <div>
                <input
                  type="date"
                  aria-label="Due date"
                  value={note.dueDate ?? ""}
                  onChange={(e) =>
                    onChange({ ...note, dueDate: e.target.value || null })
                  }
                />
                {note.dueDate && (
                  <IconButton
                    label="Clear due date"
                    onClick={() => onChange({ ...note, dueDate: null })}
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            </label>
          </div>
        )}
        <div className="editor-toolbar">
          {trashed ? (
            <button
              className="text-button"
              onClick={() => {
                onChange({ ...note, status: "active", deletedAt: null });
                onClose();
              }}
            >
              <RotateCcw size={18} />
              Restore note
            </button>
          ) : (
            <>
              <div className="segmented" role="group" aria-label="Note type">
                <IconButton
                  label="Checklist"
                  aria-pressed={note.kind === "list"}
                  onClick={() => switchKind("list")}
                >
                  <ListTodo size={19} />
                </IconButton>
                <IconButton
                  label="Plain text"
                  aria-pressed={note.kind === "text"}
                  onClick={() => switchKind("text")}
                >
                  <Type size={19} />
                </IconButton>
              </div>
              <details className="color-menu">
                <summary
                  className="icon-button"
                  title="Note color"
                  aria-label="Note color"
                >
                  <Palette size={20} />
                </summary>
                <div className="color-popover">
                  <span>Note color</span>
                  <div className="swatches">
                    {colorPalette.map(({ name, color }) => (
                      <button
                        type="button"
                        key={color}
                        aria-label={name}
                        title={name}
                        aria-pressed={background === color}
                        style={{ background: color }}
                        onClick={() => onChange({ ...note, color })}
                      >
                        {background === color && (
                          <Check size={16} color={inkColor(color)} />
                        )}
                      </button>
                    ))}
                  </div>
                  <label className="custom-color">
                    Custom color
                    <input
                      type="color"
                      aria-label="Custom color"
                      value={background}
                      onChange={(e) =>
                        onChange({
                          ...note,
                          color: darkNoteColor(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              </details>
              <div className="toolbar-spacer" />
              <IconButton
                label={
                  note.status === "archived" ? "Unarchive note" : "Archive note"
                }
                onClick={() => {
                  onChange({
                    ...note,
                    status: note.status === "archived" ? "active" : "archived",
                  });
                  onClose();
                }}
              >
                {note.status === "archived" ? (
                  <ArchiveRestore size={19} />
                ) : (
                  <Archive size={19} />
                )}
              </IconButton>
              <IconButton
                label="Move to trash"
                onClick={() => {
                  onChange({ ...note, status: "trashed" });
                  onClose();
                }}
              >
                <Trash2 size={19} />
              </IconButton>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

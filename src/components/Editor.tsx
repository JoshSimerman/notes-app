import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
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
  noteColor,
  inkColor,
  convertNote,
  dragBlock,
  dropTarget,
  indentItem,
  listRows,
  mergeIntoPrevious,
  moveItem,
  normalizeItems,
  pasteIntoItem,
  splitItem,
  textInsertion,
  toggleItem,
  trimTrailingEmpty,
  withParent,
  type ItemEdit,
  type ItemRow,
  type Note,
  type Item,
} from "../../shared/notes";
import { Modal, IconButton } from "./Primitives";
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
  // A drag picks up a block of rows (an item, or a parent and its children).
  // `to` and `level` are where it would land, from dropTarget.
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    size: number;
    to: number;
    level: 0 | 1;
    offset: number;
    shift: number;
  } | null>(null);
  const [removed, setRemoved] = useState<{
    item: Item;
    index: number;
    children: string[];
  } | null>(null);
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 10000);
    return () => clearTimeout(timer);
  }, [removed]);
  const colorMenu = useRef<HTMLDetailsElement>(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  useEffect(() => {
    if (!colorsOpen) return;
    const outside = (e: PointerEvent) => {
      if (!colorMenu.current?.contains(e.target as Node))
        colorMenu.current!.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [colorsOpen]);
  const trashed = note.status === "trashed";
  const background = noteColor(note.color);
  const { active, completed } = listRows(note.items);
  // Closing drops empty items left at the bottom of the list, in the same
  // save as any change that closes the note (archive, trash, restore).
  function close(next: Note = note) {
    const items = trimTrailingEmpty(next.items);
    if (next !== note || items !== next.items) onChange({ ...next, items });
    onClose();
  }
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
  function add() {
    const item: Item = { id: crypto.randomUUID(), text: "", done: false };
    applyEdit({ items: [...note.items, item], focusId: item.id, offset: 0 });
  }
  // Render synchronously so fast typing after Enter or paste lands in the
  // focused item rather than the one it came from.
  function applyEdit({ items, focusId, offset }: ItemEdit) {
    flushSync(() => onChange({ ...note, items }));
    const input = refs.current.get(focusId);
    input?.focus();
    input?.setSelectionRange(offset, offset);
  }
  // Deleting a parent lifts its children to the top level; Undo nests them
  // back under it.
  function remove(id: string) {
    const index = note.items.findIndex((i) => i.id === id);
    const previous = active[active.findIndex((r) => r.item.id === id) - 1];
    const item = note.items[index];
    const children = note.items
      .filter((i) => i.parentId === id)
      .map((i) => i.id);
    onChange({
      ...note,
      items: note.items
        .filter((i) => i.id !== id)
        .map((i) => (i.parentId === id ? withParent(i, undefined) : i)),
    });
    if (item.text.trim() || children.length)
      setRemoved({ item, index, children });
    if (previous && !item.done)
      setTimeout(() => refs.current.get(previous.item.id)?.focus(), 0);
  }
  function restore() {
    if (!removed) return;
    const children = new Set(removed.children);
    const items = note.items.map((i) =>
      children.has(i.id) ? withParent(i, removed.item.id) : i,
    );
    items.splice(removed.index, 0, removed.item);
    setRemoved(null);
    onChange({ ...note, items: normalizeItems(items) });
  }
  function move(id: string, to: number, level: 0 | 1) {
    const items = moveItem(note.items, id, to, level);
    if (items) onChange({ ...note, items });
  }
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    const body = bodyRef.current;
    if (event.button !== 0 || !body) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const { from, size } = dragBlock(active, id);
    const startLevel = active[from].level;
    const top = (el: HTMLElement) =>
      el.getBoundingClientRect().top -
      body.getBoundingClientRect().top +
      body.scrollTop;
    // Row positions in scroll-content coordinates, measured once at the start.
    const slots = active.map((r) => {
      const el = rows.current.get(r.item.id)!;
      return { top: top(el), height: el.offsetHeight };
    });
    const gap =
      slots.length > 1 ? slots[1].top - slots[0].top - slots[0].height : 0;
    const last = slots[from + size - 1];
    const blockHeight = last.top + last.height - slots[from].top;
    const shift = blockHeight + gap;
    // Middles of the rows the block can move between.
    const others = [...slots.slice(0, from), ...slots.slice(from + size)].map(
      (slot) => slot.top + slot.height / 2,
    );
    const startY = event.clientY + body.scrollTop;
    const startX = event.clientX;
    let pointerY = event.clientY;
    let pointerX = event.clientX;
    let current = {
      id,
      from,
      size,
      to: from,
      level: startLevel,
      offset: 0,
      shift,
    };
    setDrag(current);
    const update = () => {
      const offset = pointerY + body.scrollTop - startY;
      const center = slots[from].top + blockHeight / 2 + offset;
      // Sideways moves nest the item under the one above, or lift it out.
      const dx = pointerX - startX;
      const wanted: 0 | 1 = dx > 24 ? 1 : dx < -24 ? 0 : startLevel;
      const target = dropTarget(
        note.items,
        id,
        others.filter((middle) => middle < center).length,
        wanted,
      );
      current = { ...current, ...target, offset };
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
    const pointerMove = (e: PointerEvent) => {
      pointerY = e.clientY;
      pointerX = e.clientX;
      update();
    };
    const end = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", pointerMove);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDrag(null);
      if (e.type === "pointerup") move(id, current.to, current.level);
    };
    handle.addEventListener("pointermove", pointerMove);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  // While dragging, the block follows the pointer (shifted sideways when it
  // will nest or un-nest) and the rows it passes slide to make room.
  function rowStyle(index: number) {
    if (!drag) return undefined;
    const { from, size, to, offset, shift } = drag;
    if (index >= from && index < from + size) {
      const x = index === from ? (drag.level - active[from].level) * 28 : 0;
      return { transform: `translate(${x}px, ${offset}px)` };
    }
    const other = index < from ? index : index - size;
    const y =
      index < from && other >= to
        ? shift
        : index >= from + size && other < to
          ? -shift
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
  function itemRow({ item, level }: ItemRow, index: number) {
    const draggable = !trashed && !item.done;
    const dragged = drag && index >= drag.from && index < drag.from + drag.size;
    return (
      <div
        key={item.id}
        ref={(el) => {
          if (el) rows.current.set(item.id, el);
          else rows.current.delete(item.id);
        }}
        className={`editor-item check-row ${item.done ? "checked" : ""} ${
          level ? "nested" : ""
        } ${!item.done && dragged ? "dragging" : ""} ${drag ? "reordering" : ""}`}
        style={item.done ? undefined : rowStyle(index)}
      >
        {draggable ? (
          <button
            type="button"
            className="drag-handle"
            aria-label={`Reorder ${item.text || "item"}`}
            title="Drag to reorder, or sideways to nest (or use arrow keys)"
            onPointerDown={(e) => startDrag(e, item.id)}
            onKeyDown={(e) => {
              let items: Item[] | null = null;
              if (e.key === "ArrowRight" || e.key === "ArrowLeft")
                items = indentItem(
                  note.items,
                  item.id,
                  e.key === "ArrowRight" ? 1 : 0,
                );
              else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                const { from, size } = dragBlock(active, item.id);
                const to = e.key === "ArrowUp" ? from - 1 : from + 1;
                if (to >= 0 && to <= active.length - size)
                  items = moveItem(note.items, item.id, to, level);
              } else return;
              e.preventDefault();
              if (items) onChange({ ...note, items });
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
            onChange({ ...note, items: toggleItem(note.items, item.id) })
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
          onPaste={(e) => {
            if (trashed) return;
            const input = e.currentTarget;
            const edit = pasteIntoItem(
              note.items,
              item.id,
              input.selectionStart,
              input.selectionEnd,
              e.clipboardData.getData("text/plain"),
            );
            if (!edit) return;
            e.preventDefault();
            applyEdit(edit);
          }}
          onChange={(e) => {
            // Some Android keyboards insert clipboard text without a paste
            // event; line breaks typed with Shift+Enter stay in the item.
            const type = (e.nativeEvent as InputEvent).inputType ?? "";
            if (/^insert(?!LineBreak|Paragraph)/.test(type)) {
              const { start, end, text } = textInsertion(
                item.text,
                e.target.value,
              );
              const edit = pasteIntoItem(note.items, item.id, start, end, text);
              if (edit) return applyEdit(edit);
            }
            onChange({
              ...note,
              items: note.items.map((i) =>
                i.id === item.id ? { ...i, text: e.target.value } : i,
              ),
            });
          }}
          onKeyDown={(e) => {
            if (trashed || e.nativeEvent.isComposing) return;
            const input = e.currentTarget;
            const caret = input.selectionStart;
            // Tab nests the item under the one above; Shift+Tab lifts it out.
            if (
              e.key === "Tab" &&
              !item.done &&
              !e.altKey &&
              !e.ctrlKey &&
              !e.metaKey
            ) {
              e.preventDefault();
              const items = indentItem(note.items, item.id, e.shiftKey ? 0 : 1);
              if (items) applyEdit({ items, focusId: item.id, offset: caret });
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              applyEdit(
                splitItem(
                  note.items,
                  item.id,
                  input.selectionStart,
                  input.selectionEnd,
                ),
              );
            }
            if (
              e.key === "Backspace" &&
              input.selectionStart === 0 &&
              input.selectionEnd === 0
            ) {
              // At the start of a nested item, Backspace first un-nests it.
              const lifted = level ? indentItem(note.items, item.id, 0) : null;
              if (lifted) {
                e.preventDefault();
                applyEdit({ items: lifted, focusId: item.id, offset: 0 });
                return;
              }
              const edit = mergeIntoPrevious(note.items, item.id);
              if (edit) {
                e.preventDefault();
                applyEdit(edit);
              } else if (!item.text) {
                e.preventDefault();
                remove(item.id);
              }
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
      onClose={() => close()}
      onOpen={focusOnOpen}
      className="editor-modal"
    >
      <div
        className="editor-surface"
        style={
          {
            background,
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
            <IconButton
              label="Close"
              className="icon-button editor-close"
              onClick={() => close()}
            >
              <X size={20} className="close-x" />
              <ArrowLeft size={22} className="close-back" />
            </IconButton>
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
        {removed && (
          <div className="undo-toast" role="status">
            <span>Item deleted</span>
            <button className="text-button" onClick={restore}>
              Undo
            </button>
            <IconButton label="Dismiss" onClick={() => setRemoved(null)}>
              <X size={16} />
            </IconButton>
          </div>
        )}
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
              onClick={() =>
                close({ ...note, status: "active", deletedAt: null })
              }
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
              <details
                className="color-menu"
                ref={colorMenu}
                onToggle={(e) => setColorsOpen(e.currentTarget.open)}
                onKeyDown={(e) => {
                  // Escape closes the palette rather than the whole note.
                  if (e.key === "Escape" && e.currentTarget.open) {
                    e.preventDefault();
                    e.currentTarget.open = false;
                  }
                }}
              >
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
                        onClick={() => {
                          onChange({ ...note, color });
                          colorMenu.current!.open = false;
                        }}
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
                        onChange({ ...note, color: e.target.value })
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
                onClick={() =>
                  close({
                    ...note,
                    status: note.status === "archived" ? "active" : "archived",
                  })
                }
              >
                {note.status === "archived" ? (
                  <ArchiveRestore size={19} />
                ) : (
                  <Archive size={19} />
                )}
              </IconButton>
              <IconButton
                label="Move to trash"
                onClick={() => close({ ...note, status: "trashed" })}
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

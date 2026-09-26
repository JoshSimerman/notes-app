import type { MouseEvent } from "react";

export type EditorFocus =
  | { field: "title" | "content"; offset: number }
  | { field: "item"; itemId: string; offset: number };

export function clickedOffset(event: MouseEvent<HTMLElement>): number {
  if (event.detail === 0) return 0;
  const element = event.currentTarget;
  const doc = element.ownerDocument;
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  const caret = position
    ? { node: position.offsetNode, offset: position.offset }
    : (() => {
        const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
        return (
          range && { node: range.startContainer, offset: range.startOffset }
        );
      })();
  if (caret && element.contains(caret.node)) {
    // DOM ranges and textarea selections both measure UTF-16 code units.
    const range = doc.createRange();
    range.selectNodeContents(element);
    range.setEnd(caret.node, caret.offset);
    return range.toString().length;
  }
  return element.textContent?.length ?? 0;
}

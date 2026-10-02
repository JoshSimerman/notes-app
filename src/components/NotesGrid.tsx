import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

// Masonry layout: the grid has short fixed rows and each card spans as many as
// its height needs, so a short note fills the gap under a short column instead
// of waiting for the tallest card in the row above it.
export function NotesGrid({
  style,
  children,
}: {
  style?: CSSProperties;
  children: ReactNode;
}) {
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = grid.current!;
    const fit = (card: HTMLElement) => {
      const css = getComputedStyle(el);
      const row = parseFloat(css.gridAutoRows) || 1;
      const gap = parseFloat(css.columnGap) || 0;
      card.style.gridRowEnd = `span ${Math.ceil((card.offsetHeight + gap) / row)}`;
    };
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) fit(entry.target as HTMLElement);
    });
    const observeCards = () => {
      resize.disconnect();
      for (const card of el.children) resize.observe(card);
    };
    observeCards();
    const added = new MutationObserver(observeCards);
    added.observe(el, { childList: true });
    return () => {
      resize.disconnect();
      added.disconnect();
    };
  }, []);
  return (
    <div ref={grid} className="notes-grid" style={style}>
      {children}
    </div>
  );
}

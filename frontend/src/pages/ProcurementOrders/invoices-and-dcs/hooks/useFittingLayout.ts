import { useLayoutEffect, useRef, useState } from "react";

/** The three layouts, widest first. */
export type DCMIRLayout = "full" | "compact" | "cards";

/**
 * Picks the widest layout that fits the card, measured on the card itself, not the screen:
 * on a tablet with the sidebar open the card is far narrower than the viewport, and a
 * screen breakpoint left Status and DC Pending off to the right (PR-walk nit, 2026-11-26).
 *
 * Each time the card's width changes it starts again from "full"; after every render, if
 * the table overflows its box it steps down one layout ("full" → "compact" → "cards").
 * Layout effects run before paint, so the user never sees the overflowing layout.
 * Without layout (jsdom, no ResizeObserver) it stays on "full".
 */
export function useFittingLayout() {
  const rootRef = useRef<HTMLDivElement>(null);
  const tableBoxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<DCMIRLayout>("full");

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setLayout("full");
  }, [width]);

  useLayoutEffect(() => {
    const box = tableBoxRef.current;
    if (!box || layout === "cards") return;
    if (box.scrollWidth > box.clientWidth + 1) setLayout(layout === "full" ? "compact" : "cards");
  });

  return { rootRef, tableBoxRef, layout };
}

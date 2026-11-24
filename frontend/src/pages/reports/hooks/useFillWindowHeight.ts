import { RefObject, useLayoutEffect, useState } from "react";

/**
 * The height that makes `ref` end at the bottom of the app's scrolling <main> (minus its bottom padding),
 * re-measured when <main> resizes (window, sidebar toggle, the report-tab row above wrapping). Measured, not
 * a fixed calc(100vh - N), because the rows above the card change height with the screen width.
 * `undefined` when off or when the window is too short (the page then scrolls); used only from lg.
 */
const FILL_MIN_HEIGHT = 600;

export function useFillWindowHeight(ref: RefObject<HTMLElement>, enabled: boolean): string | undefined {
  const [height, setHeight] = useState<string>();
  useLayoutEffect(() => {
    const el = ref.current;
    const main = el?.closest("main");
    if (!enabled || !el || !main) {
      setHeight(undefined);
      return;
    }
    const measure = () => {
      const padBottom = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      // Below 600px the table would get only a sliver: leave the card unfixed and let the page scroll.
      const fill = Math.floor(main.clientHeight - top - padBottom);
      setHeight(fill >= FILL_MIN_HEIGHT ? `${fill}px` : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return height;
}

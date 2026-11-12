// @vitest-environment jsdom
/**
 * Which lines are open, and the line a link names (`estRow`): once that sheet's rows arrive it is opened, highlighted
 * and scrolled to. A ▸ click opens a line and writes `estRow` but never scrolls (review issue 3: the page jumped).
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SheetRow } from "@/utils/estimations/estimateTypes";

import { SHEET_ROWS } from "../estimatesTestData";
import { useFocusedLines } from "./useFocusedLines";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useFocusedLines>;
let api: Api;
let container: HTMLDivElement;
let root: Root;
let scrolled: string[];

function Probe({ rows, focusRow, onFocusRow }: { rows: SheetRow[]; focusRow: string | null; onFocusRow: (r: number | null) => void }) {
  api = useFocusedLines(rows, focusRow, onFocusRow);
  return <div>{rows.map((r) => <div key={r.name} id={`est-row-${r.name}`} />)}</div>;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  scrolled = [];
  // jsdom has no layout, so no scrollIntoView: record which row was asked to scroll.
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this.id); });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (rows: SheetRow[], focusRow: string | null, onFocusRow = vi.fn()) => {
  act(() => root.render(<Probe rows={rows} focusRow={focusRow} onFocusRow={onFocusRow} />));
  return onFocusRow;
};

describe("useFocusedLines", () => {
  it("opens, highlights and scrolls to the linked line once the sheet's rows arrive", () => {
    render([], "11");
    expect([api.expanded.size, api.highlight, scrolled]).toEqual([0, null, []]);
    render(SHEET_ROWS, "11");
    expect([[...api.expanded], api.highlight, scrolled]).toEqual([["L2"], "L2", ["est-row-L2"]]);
  });

  it("ignores a link to a heading or a row that is not on the sheet", () => {
    render(SHEET_ROWS, "9");
    render(SHEET_ROWS, "99");
    expect([api.expanded.size, api.highlight, scrolled]).toEqual([0, null, []]);
  });

  it("a ▸ click opens the line and writes the link, without scrolling", () => {
    const onFocusRow = render(SHEET_ROWS, null);
    act(() => api.toggle("L1", 10));
    expect(onFocusRow).toHaveBeenLastCalledWith(10);
    render(SHEET_ROWS, "10", onFocusRow);  // the URL now says estRow=10
    expect([[...api.expanded], api.highlight, scrolled]).toEqual([["L1"], "L1", []]);
  });

  it("a second click closes it and clears the link", () => {
    const onFocusRow = render(SHEET_ROWS, null);
    act(() => api.toggle("L1", 10));
    act(() => api.toggle("L1", 10));
    expect([api.expanded.size, onFocusRow.mock.calls[onFocusRow.mock.calls.length - 1]]).toEqual([0, [null]]);
  });

  it("a new link after a click does scroll", () => {
    const onFocusRow = render(SHEET_ROWS, null);
    act(() => api.toggle("L1", 10));
    render(SHEET_ROWS, "10", onFocusRow);
    render(SHEET_ROWS, "14", onFocusRow);  // Open line / Save elsewhere
    expect([[...api.expanded].sort(), scrolled]).toEqual([["L1", "L3"], ["est-row-L3"]]);
  });

  it("opens many at once, and closes all with the link cleared", () => {
    const onFocusRow = render(SHEET_ROWS, null);
    act(() => api.expandMany(["L1", "L3"]));
    expect([...api.expanded]).toEqual(["L1", "L3"]);
    act(() => api.collapseAll());
    expect([api.expanded.size, onFocusRow.mock.calls[onFocusRow.mock.calls.length - 1]]).toEqual([0, [null]]);
  });
});

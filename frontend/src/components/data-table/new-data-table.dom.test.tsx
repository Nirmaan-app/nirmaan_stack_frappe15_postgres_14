// @vitest-environment jsdom
//
// DataTable draws each row through a memoised `DataTableRow`, so a redraw of the table (a scroll frame, a key
// typed in search) does not redraw the rows already on screen. These tests pin both halves of that:
//   - a redraw that changes nothing about the rows leaves them alone;
//   - everything a row shows still updates: new data, new columns, a hidden column, a selected row.
// The second half is the risk of memoising: a prop the row does not receive would leave it showing old values.
//
// jsdom + react-dom/client only (no @testing-library), per frontend/CODING_STANDARDS.md § Writing a test.
// Virtualization is off here: jsdom does no layout, so the virtualizer would see a 0 px box.
import { createRoot, Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ColumnDef, getCoreRowModel, RowSelectionState, useReactTable, VisibilityState,
} from "@tanstack/react-table";

import { DataTable } from "./new-data-table";

// ─── jsdom's gaps (test-environment shims, never product code) ────────────────────────────────
class StubResizeObserver {
  observe() { /* no layout in jsdom */ }
  unobserve() { /* no layout in jsdom */ }
  disconnect() { /* no layout in jsdom */ }
}
beforeAll(() => {
  if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// ─── fixture ──────────────────────────────────────────────────────────────────────────────────
interface Item { id: string; name: string; qty: number }

/** How many times each row's "name" cell has been drawn, by row id. */
let draws: Record<string, number> = {};

const makeColumns = (label: string): ColumnDef<Item>[] => [
  {
    id: "name", accessorKey: "name", header: "Name",
    cell: ({ row }) => {
      draws[row.original.id] = (draws[row.original.id] ?? 0) + 1;
      return `${label}:${row.original.name}`;
    },
  },
  { id: "qty", accessorKey: "qty", header: "Qty", cell: ({ row }) => `qty ${row.original.qty}` },
];

const COLUMNS_A = makeColumns("A");
const DATA: Item[] = [
  { id: "r1", name: "Cement", qty: 1 },
  { id: "r2", name: "Steel", qty: 2 },
  { id: "r3", name: "Sand", qty: 3 },
];

interface HarnessProps {
  data: Item[];
  columns: ColumnDef<Item>[];
  searchTerm?: string;
  columnVisibility?: VisibilityState;
  rowSelection?: RowSelectionState;
  virtualized?: boolean;
}

function Harness({ data, columns, searchTerm = "", columnVisibility = {}, rowSelection = {}, virtualized = false }: HarnessProps) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: r => r.id,
    enableRowSelection: true,
    state: { columnVisibility, rowSelection },
  });
  return (
    <DataTable<Item>
      table={table}
      columns={columns}
      isLoading={false}
      totalCount={data.length}
      searchFieldOptions={[{ value: "name", label: "Name", placeholder: "Search by Name..." }]}
      selectedSearchField="name"
      onSelectedSearchFieldChange={() => {}}
      searchTerm={searchTerm}
      onSearchTermChange={() => {}}
      showRowSelection
      enableVirtualization={virtualized}
    />
  );
}

let container: HTMLDivElement;
let root: Root;
const render = (props: HarnessProps) => act(() => { root.render(<Harness {...props} />); });
const bodyRows = () => Array.from(container.querySelectorAll("tbody tr"));
const rowText = (i: number) => bodyRows()[i]?.textContent ?? "";

beforeEach(() => {
  draws = {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// ─── tests ────────────────────────────────────────────────────────────────────────────────────
describe("DataTable rows are memoised", () => {
  it("a table redraw that changes nothing about the rows does not redraw them", () => {
    render({ data: DATA, columns: COLUMNS_A });
    const before = { ...draws };
    expect(before).toEqual({ r1: 1, r2: 1, r3: 1 });

    render({ data: DATA, columns: COLUMNS_A, searchTerm: "ce" });

    // The table did redraw: the search box shows the new term ...
    expect((container.querySelector("input[aria-label='Search by Name...']") as HTMLInputElement).value).toBe("ce");
    // ... but no row's cells ran again.
    expect(draws).toEqual(before);
  });

  it("new data still reaches the rows", () => {
    render({ data: DATA, columns: COLUMNS_A });
    render({ data: [DATA[0], { ...DATA[1], name: "Rebar" }, DATA[2]], columns: COLUMNS_A });
    expect(rowText(1)).toContain("A:Rebar");
    expect(rowText(1)).not.toContain("Steel");
  });

  it("new columns redraw every row's cells", () => {
    render({ data: DATA, columns: COLUMNS_A });
    render({ data: DATA, columns: makeColumns("B") });
    expect(bodyRows().map(r => r.textContent)).toEqual([
      expect.stringContaining("B:Cement"), expect.stringContaining("B:Steel"), expect.stringContaining("B:Sand"),
    ]);
  });

  it("hiding a column removes its cells from every row", () => {
    render({ data: DATA, columns: COLUMNS_A });
    expect(rowText(0)).toContain("qty 1");
    render({ data: DATA, columns: COLUMNS_A, columnVisibility: { qty: false } });
    for (let i = 0; i < 3; i++) expect(rowText(i)).not.toContain("qty");
    expect(rowText(0)).toContain("A:Cement");
  });

  it("selecting a row marks only that row", () => {
    render({ data: DATA, columns: COLUMNS_A });
    render({ data: DATA, columns: COLUMNS_A, rowSelection: { r2: true } });
    const states = bodyRows().map(r => r.getAttribute("data-state"));
    expect(states).toEqual([null, "selected", null]);
    const boxes = bodyRows().map(r => r.querySelector("[role='checkbox']")?.getAttribute("aria-checked"));
    expect(boxes).toEqual(["false", "true", "false"]);
  });
});

describe("DataTable virtual rows", () => {
  // jsdom does no layout, so the scroll box is given a height here (a test shim, never product code): the
  // virtualizer reads it with getBoundingClientRect and draws the rows that fit, as in the browser.
  const MANY: Item[] = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, name: `Item ${i}`, qty: i }));
  let restore: (() => void) | undefined;
  afterEach(() => { restore?.(); restore = undefined; });

  /** Counts every read of a table row's offsetHeight while `run` draws the table. */
  function countRowHeightReads(run: () => void): number {
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")!;
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
    let reads = 0;
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 600, width: 1200, height: 600, toJSON: () => ({}) }),
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) { if (this.tagName === "TR") reads++; return 45; },
    });
    restore = () => {
      Object.defineProperty(Element.prototype, "getBoundingClientRect", rect);
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
    };
    run();
    return reads;
  }

  it("draws only the rows that fit, and never reads a row's height while drawing it", () => {
    // Reading it made the browser lay the page out once per new row (16 Nov: 712 ms of a slow scroll); the row's
    // height comes from the browser's resize report instead (virtualRowSize).
    const reads = countRowHeightReads(() => render({ data: MANY, columns: COLUMNS_A, virtualized: true }));
    const drawn = bodyRows().filter(r => r.textContent?.includes("Item "));
    expect(drawn.length).toBeGreaterThan(5);
    expect(drawn.length).toBeLessThan(MANY.length);
    expect(reads).toBe(0);
  });
});

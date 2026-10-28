// @vitest-environment jsdom
//
// The all scope (Reports > Bulk Download) pages its company-wide lists. Paging must not shrink what
// the header tick selects: "select all" means every row the filters leave, on every page -- the
// download posts `selectedIds`, so a page-only select-all would silently drop the other pages. The
// project and vendor tabs pass no `pageSize` and must keep rendering every row.
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ColumnDef } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BulkSelectTable } from "./BulkSelectTable";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = { name: string; amount: number };
// Amounts 1..120, so every total is easy to check: all 120 = ₹7,260.
const ROWS: Row[] = Array.from({ length: 120 }, (_, i) => ({ name: `PO-${String(i + 1).padStart(3, "0")}`, amount: i + 1 }));
const AMOUNTS = [{ label: "Incl. GST", get: (r: Row) => r.amount }];
const COLUMNS: ColumnDef<Row, any>[] = [{ id: "name", accessorFn: (r) => r.name, header: "PO", cell: ({ getValue }) => getValue() }];

let selected: string[] = [];

const Harness = ({ pageSize, initial = [], amounts }: { pageSize?: number; initial?: string[]; amounts?: typeof AMOUNTS }) => {
    const [ids, setIds] = useState<string[]>(initial);
    selected = ids;
    return (
        <BulkSelectTable data={ROWS} columns={COLUMNS} isLoading={false} selectedIds={ids} onSelectedIdsChange={setIds}
            pageSize={pageSize} summaryAmounts={amounts} />
    );
};

describe("BulkSelectTable paging (all scope)", () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        selected = [];
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const bodyRows = () => container.querySelectorAll("tbody tr").length;
    const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text))!;
    const headerTick = () => container.querySelector('[aria-label="Select all filtered rows"]') as HTMLButtonElement;
    const search = (value: string) => {
        const input = container.querySelector("input") as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        act(() => {
            setter.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    };

    it("renders one page of rows and says where it is", () => {
        act(() => root.render(<Harness pageSize={50} />));
        expect(bodyRows()).toBe(50);
        expect(container.textContent).toContain("1–50 of 120");
        expect(container.textContent).toContain("Page 1 of 3");
    });

    it("selects every filtered row on ALL pages from the header tick, and clears them all again", () => {
        act(() => root.render(<Harness pageSize={50} />));
        act(() => headerTick().click());
        expect(selected).toHaveLength(120);
        expect(container.textContent).toContain("120/120 Selected");
        act(() => headerTick().click());
        expect(selected).toHaveLength(0);
    });

    it("keeps the selection when the page changes", () => {
        act(() => root.render(<Harness pageSize={50} initial={["PO-001"]} />));
        act(() => button("Next").click());
        expect(container.textContent).toContain("51–100 of 120");
        expect(selected).toEqual(["PO-001"]);
        expect(headerTick().getAttribute("data-state")).toBe("indeterminate");
    });

    it("clears the selection and returns to page 1 when the search changes; select-all then takes only the matches", () => {
        act(() => root.render(<Harness pageSize={50} initial={["PO-001"]} />));
        act(() => button("Next").click());
        search("PO-11");
        expect(selected).toEqual([]);
        expect(bodyRows()).toBe(10); // PO-110 .. PO-119
        expect(container.textContent).toContain("Page 1 of 1");
        act(() => headerTick().click());
        expect(selected).toHaveLength(10);
    });

    it("without pageSize renders every row and no pager (the project and vendor tabs)", () => {
        act(() => root.render(<Harness />));
        expect(bodyRows()).toBe(120);
        expect(container.textContent).not.toContain("Page 1 of");
    });

    // Line 1 as "label=value" blocks, line 2 as its chips (or "No filters").
    const blocks = () => [...container.querySelectorAll("[data-summary-label]")].map(
        (label) => `${label.textContent}=${label.nextElementSibling?.textContent}`,
    );
    const chips = () => [...container.querySelectorAll("[data-summary-filter]")].map((chip) => chip.textContent);
    const summary = () => container.querySelector('[aria-label="Selection summary"]');

    describe("the two-line selection summary", () => {
        it("is hidden on an untouched table, and shows once a row is ticked or a filter is set", () => {
            act(() => root.render(<Harness pageSize={50} amounts={AMOUNTS} />));
            expect(summary()).toBeNull();
            act(() => (container.querySelector('[aria-label="Select PO-001"]') as HTMLButtonElement).click());
            expect(blocks()).toEqual(["Selected=1 of 120", "Incl. GST=₹1"]);
            expect(chips()).toEqual(["No filters"]);
            act(() => (container.querySelector('[aria-label="Select PO-001"]') as HTMLButtonElement).click());
            expect(summary()).toBeNull();
            search("PO-11"); // a filter alone, nothing ticked
            expect(blocks()).toEqual(["Selected=0 of 10", "Incl. GST=₹0"]);
            expect(chips()).toEqual(['Search: "PO-11"']);
        });

        it("labels every value: Selected and the total of the ticked rows; 'No filters' when none is set", () => {
            act(() => root.render(<Harness pageSize={50} amounts={AMOUNTS} initial={["PO-001", "PO-120"]} />));
            expect(blocks()).toEqual(["Selected=2 of 120", "Incl. GST=₹121"]);
            expect(chips()).toEqual(["No filters"]);
        });

        it("follows the selection: select-all on every page totals all 120 rows", () => {
            act(() => root.render(<Harness pageSize={50} amounts={AMOUNTS} />));
            act(() => headerTick().click());
            expect(blocks()).toEqual(["Selected=120 of 120", "Incl. GST=₹7,260"]);
        });

        it("shows the search as a chip, counts only the rows it leaves, and its ✕ clears it", () => {
            act(() => root.render(<Harness pageSize={50} amounts={AMOUNTS} />));
            search("PO-11");
            act(() => headerTick().click());
            // PO-110 .. PO-119 = 110 + ... + 119 = 1,145
            expect(blocks()).toEqual(["Selected=10 of 10", "Incl. GST=₹1,145"]);
            expect(chips()).toEqual(['Search: "PO-11"']);
            act(() => (container.querySelector('[aria-label^="Remove filter Search"]') as HTMLButtonElement).click());
            // A filter change clears the ticks, as everywhere: nothing ticked, no filter -> no summary.
            expect(summary()).toBeNull();
            expect(selected).toEqual([]);
            expect((container.querySelector("input") as HTMLInputElement).value).toBe("");
        });

        it("shows Selected alone when the type has no amount and no date column (DN, DC, MIR, MTC have a date)", () => {
            act(() => root.render(<Harness pageSize={50} initial={["PO-001"]} />));
            expect(blocks()).toEqual(["Selected=1 of 120"]);
        });
    });

    it("'Date range (<column>)' is the span of the TICKED rows, following each tick, whatever the date filter", () => {
        type Dated = { name: string; creation: string };
        const rows: Dated[] = [
            { name: "PO-1", creation: "2024-04-03 10:00:00" },
            { name: "PO-2", creation: "2025-06-02 11:00:00" },
            { name: "PO-3", creation: "2026-10-25 12:00:00" },
            { name: "PO-4", creation: "" },
        ];
        const columns: ColumnDef<Dated, any>[] = [
            { id: "name", accessorFn: (r) => r.name, header: "PO" },
            { id: "creation", accessorFn: (r) => r.creation, header: "Created On", enableGlobalFilter: false },
        ];
        const DatedHarness = () => {
            const [ids, setIds] = useState<string[]>([]);
            selected = ids;
            return <BulkSelectTable data={rows} columns={columns} isLoading={false} selectedIds={ids} onSelectedIdsChange={setIds} dateFilterColumns={["creation"]} />;
        };
        const range = () => blocks().find((b) => b.startsWith("Date range"));
        const tick = (name: string) => act(() => (container.querySelector(`[aria-label="Select ${name}"]`) as HTMLButtonElement).click());

        act(() => root.render(<DatedHarness />));
        expect(range()).toBeUndefined(); // untouched table: no summary at all
        tick("PO-2");
        expect(range()).toBe("Date range (Created On)=02-Jun-2025");
        tick("PO-1");
        tick("PO-4"); // undated: counted, but adds no date
        expect(blocks()[0]).toBe("Selected=3 of 4");
        expect(range()).toBe("Date range (Created On)=03-Apr-2024 → 02-Jun-2025");
        tick("PO-2"); // untick: PO-1 and the undated PO-4 stay ticked
        expect(range()).toBe("Date range (Created On)=03-Apr-2024");
        tick("PO-1"); // untick: only the undated PO-4 is left
        expect(blocks()[0]).toBe("Selected=1 of 4");
        expect(range()).toBe("Date range (Created On)=—");
        tick("PO-4"); // untick the last one: nothing ticked, no filter -> no summary
        expect(range()).toBeUndefined();
        act(() => headerTick().click());
        expect(range()).toBe("Date range (Created On)=03-Apr-2024 → 25-Oct-2026");
    });
});

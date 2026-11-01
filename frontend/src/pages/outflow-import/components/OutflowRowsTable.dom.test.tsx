// @vitest-environment jsdom
//
// The defect: when a funnel's value matched nothing, the table swapped its whole `<table>` for a
// "Nothing here." box. The funnels live in the header, so the one a person was typing in unmounted
// mid-word -- the popover vanished, the cursor was lost, and only "Clear filters" could undo it.
// The empty state is now a row INSIDE the table, and the header stays.
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

import { DEFAULT_HIDDEN_COLUMNS, OUTFLOW_COLUMNS, type ColumnFilters } from "../outflowTableModel";
import { OutflowRowsTable, type TableActionColumn } from "./OutflowRowsTable";

// ─── jsdom's gaps ───────────────────────────────────────────────────────────────────────────
// Radix's popper measures its anchor with ResizeObserver, which jsdom lacks. A TEST shim only.
class StubResizeObserver {
    observe() { /* no layout in jsdom */ }
    unobserve() { /* no layout in jsdom */ }
    disconnect() { /* no layout in jsdom */ }
}
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (name: string): OutflowImportRow =>
    ({
        name,
        beneficiary_name: `Payee ${name}`,
        amount: 100,
        remarks: `Remark ${name}`,
        row_status: "Pending",
        added_on: "2026-10-01 10:00:00",
    }) as OutflowImportRow;

const visibleColumns = OUTFLOW_COLUMNS.filter((c) => !DEFAULT_HIDDEN_COLUMNS.includes(c.id));

/** Stands in for the page: it owns `filters`, and the test plays the server by passing `rows`. */
function Screen({
    rows,
    actionColumn,
    onFilterSpy,
    query = "",
    initialFilters = {},
    loading,
    failed,
    onRetry,
    tickable = [],
}: {
    rows: OutflowImportRow[];
    actionColumn?: TableActionColumn;
    onFilterSpy?: (columnId: string, value: ColumnFilters[string]) => void;
    query?: string;
    initialFilters?: ColumnFilters;
    loading?: boolean;
    failed?: boolean;
    onRetry?: () => void;
    tickable?: string[];
}) {
    const [filters, setFilters] = useState<ColumnFilters>(initialFilters);
    return (
        <OutflowRowsTable
            rows={rows}
            loading={loading}
            failed={failed}
            onRetry={onRetry}
            loadFacetValues={async () => ["Payee A", "Payee B"]}
            query={query}
            filters={filters}
            sort={{ columnId: "added_on", direction: "desc" }}
            hiddenColumns={new Set(DEFAULT_HIDDEN_COLUMNS)}
            selected={new Set()}
            decidedRowNames={new Set()}
            originByRow={new Map()}
            selectableRowNames={new Set(tickable)}
            onSort={() => {}}
            onFilter={(columnId, value) => {
                onFilterSpy?.(columnId, value);
                setFilters((prev) => ({ ...prev, [columnId]: value }));
            }}
            onToggleRow={() => {}}
            onToggleAll={() => {}}
            onOpenDecision={() => {}}
            actionColumn={actionColumn}
        />
    );
}

/** React listens for `input` and reads the value through the native setter it patches. */
const typeInto = (input: HTMLInputElement, value: string) =>
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe("OutflowRowsTable", () => {
    let container: HTMLDivElement;
    let root: Root;
    const render = (props: Parameters<typeof Screen>[0]) => act(() => root.render(<Screen {...props} />));
    const funnel = (title: string) =>
        container.querySelector<HTMLButtonElement>(`button[aria-label="Filter ${title}"]`);
    const textFunnelInput = () =>
        document.body.querySelector<HTMLInputElement>('input[placeholder="Contains…"]');

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.body.innerHTML = "";
    });

    describe("with no rows", () => {
        it("★ keeps the header and every funnel", () => {
            render({ rows: [] });
            const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
            for (const column of visibleColumns) {
                expect(headers.some((text) => text?.includes(column.title))).toBe(true);
            }
            expect(funnel("Remarks")).not.toBeNull();
            expect(funnel("Beneficiary")).not.toBeNull();
        });

        it("says so in one cell that spans every visible column", () => {
            render({ rows: [] });
            const cell = container.querySelector("tbody td");
            expect(cell?.textContent).toBe("Nothing here.");
            expect(cell?.getAttribute("colspan")).toBe(String(visibleColumns.length));
            expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
        });

        it("spans the action column too when the surface has one", () => {
            render({ rows: [], actionColumn: { title: "Actions", render: () => null } });
            expect(container.querySelector("tbody td")?.getAttribute("colspan")).toBe(
                String(visibleColumns.length + 1)
            );
        });

        it("does not show the message beside real rows", () => {
            render({ rows: [row("A")] });
            expect(container.textContent).not.toContain("Nothing here");
        });
    });

    describe("while loading", () => {
        const skeletonRows = () => container.querySelectorAll("tbody tr[data-skeleton-row]");

        it("★ the first load shows the header and skeleton rows, never 'Nothing here'", () => {
            render({ rows: [], loading: true });
            expect(funnel("Remarks")).not.toBeNull();
            expect(skeletonRows().length).toBeGreaterThan(0);
            expect(container.textContent).not.toContain("Nothing here");
            expect(container.querySelector("tbody")?.getAttribute("aria-busy")).toBe("true");
        });

        it("★ a refetch hides the previous query's rows behind the skeleton", () => {
            render({ rows: [row("OLD")], loading: true });
            expect(container.textContent).not.toContain("Remark OLD");
            expect(skeletonRows().length).toBeGreaterThan(0);
        });

        it("each skeleton row has one cell per column, the checkbox and action columns included", () => {
            render({
                rows: [row("A")],
                loading: true,
                tickable: ["A"],
                actionColumn: { title: "Actions", render: () => null },
            });
            for (const tr of Array.from(skeletonRows())) {
                expect(tr.querySelectorAll("td")).toHaveLength(visibleColumns.length + 2);
            }
        });

        it("select-all is disabled -- the rows behind the skeleton are the old query's", () => {
            render({ rows: [row("A")], loading: true, tickable: ["A"] });
            const all = container.querySelector<HTMLButtonElement>('button[aria-label="Select all rows"]');
            expect(all?.disabled).toBe(true);

            render({ rows: [row("A")], loading: false, tickable: ["A"] });
            expect(all?.disabled).toBe(false);
        });

        it("the skeleton goes when loading ends: rows, or the right empty message", () => {
            render({ rows: [], loading: true });
            render({ rows: [row("A")], loading: false });
            expect(skeletonRows()).toHaveLength(0);
            expect(container.textContent).toContain("Remark A");

            render({ rows: [], loading: true, query: "zzz" });
            render({ rows: [], loading: false, query: "zzz" });
            expect(skeletonRows()).toHaveLength(0);
            expect(container.querySelector("tbody td")?.textContent).toBe(
                "Nothing here for the current search or filters."
            );
            expect(container.querySelector("tbody")?.hasAttribute("aria-busy")).toBe(false);
        });

        it("a caller that never passes `loading` (the Skipped dialog) sees its rows as before", () => {
            render({ rows: [row("A")] });
            expect(skeletonRows()).toHaveLength(0);
            expect(container.textContent).toContain("Remark A");
        });
    });

    describe("when the load failed", () => {
        const FAILED = "Couldn't load transactions.";
        const retryButton = () =>
            Array.from(container.querySelectorAll("tbody button")).find((b) => b.textContent === "Retry") as
                | HTMLButtonElement
                | undefined;

        it("★ says so, in place of the rows -- which are the PREVIOUS query's", () => {
            render({ rows: [row("OLD")], failed: true, onRetry: () => {} });
            expect(container.querySelector('tbody [role="alert"]')?.textContent).toContain(FAILED);
            expect(container.textContent).not.toContain("Remark OLD");
            expect(container.textContent).not.toContain("Nothing here");
        });

        it("★ Retry calls back", () => {
            const onRetry = vi.fn();
            render({ rows: [], failed: true, onRetry });
            act(() => retryButton()!.click());
            expect(onRetry).toHaveBeenCalledTimes(1);
        });

        it("keeps the header and funnels, so the search can still be changed", () => {
            render({ rows: [], failed: true, onRetry: () => {} });
            expect(funnel("Remarks")).not.toBeNull();
            expect(container.querySelector("tbody td")?.getAttribute("colspan")).toBe(String(visibleColumns.length));
        });

        it("a retry in flight shows the skeleton, not the failure", () => {
            render({ rows: [], failed: true, loading: true, onRetry: () => {} });
            expect(container.querySelectorAll("tbody tr[data-skeleton-row]").length).toBeGreaterThan(0);
            expect(container.textContent).not.toContain(FAILED);
        });

        it("select-all is disabled -- the rows behind the failure are not this query's", () => {
            render({ rows: [row("A")], failed: true, tickable: ["A"] });
            const all = container.querySelector<HTMLButtonElement>('button[aria-label="Select all rows"]');
            expect(all?.disabled).toBe(true);
        });

        it("without onRetry there is no button, only the message", () => {
            render({ rows: [], failed: true });
            expect(container.textContent).toContain(FAILED);
            expect(retryButton()).toBeUndefined();
        });

        it("once a load succeeds the rows come back and the failure goes", () => {
            render({ rows: [], failed: true, onRetry: () => {} });
            render({ rows: [row("NEW")], failed: false, onRetry: () => {} });
            expect(container.textContent).toContain("Remark NEW");
            expect(container.textContent).not.toContain(FAILED);
        });
    });

    describe("which empty message", () => {
        const FILTERED = "Nothing here for the current search or filters.";
        const message = () => container.querySelector("tbody td")?.textContent;

        it("no search and no filter: plain 'Nothing here.' -- there is simply no data", () => {
            render({ rows: [] });
            expect(message()).toBe("Nothing here.");
        });

        it("★ a search with no match names the search", () => {
            render({ rows: [], query: "zzz" });
            expect(message()).toBe(FILTERED);
        });

        it("a search of only spaces is no search", () => {
            render({ rows: [], query: "   " });
            expect(message()).toBe("Nothing here.");
        });

        it.each<[string, ColumnFilters]>([
            ["a ticked facet", { beneficiary_name: ["Payee A"] }],
            ["a text funnel", { remarks: "rent" }],
            ["an amount Min only", { amount: { min: 1000, max: null } }],
            ["an amount Max of 0", { amount: { min: null, max: 0 } }],
            ["the period", { added_on: { operator: "Is", value: "2026-10-01" } }],
            ["the source scope", { source: ["ICICI"] }],
        ])("★ %s names the filters", (_label, initialFilters) => {
            render({ rows: [], initialFilters });
            expect(message()).toBe(FILTERED);
        });

        it.each<[string, ColumnFilters]>([
            ["an emptied facet", { beneficiary_name: [] }],
            ["a cleared text funnel", { remarks: "" }],
            ["a blank text funnel", { remarks: "   " }],
            ["an empty amount range", { amount: { min: null, max: null } }],
            ["a period with no value", { added_on: { operator: "Is", value: null } }],
            ["a column set to undefined", { source: undefined as unknown as string[] }],
        ])("%s is no filter: plain 'Nothing here.'", (_label, initialFilters) => {
            render({ rows: [], initialFilters });
            expect(message()).toBe("Nothing here.");
        });
    });

    it("keeps the SAME header nodes when the rows empty and refill", () => {
        render({ rows: [row("A")] });
        const header = container.querySelector("thead");
        const button = funnel("Remarks");

        render({ rows: [] });
        expect(container.querySelector("thead")).toBe(header);
        expect(funnel("Remarks")).toBe(button);

        render({ rows: [row("B")] });
        expect(container.querySelector("thead")).toBe(header);
    });

    it("★ the text funnel a person is typing in survives a result with no rows", () => {
        render({ rows: [row("A")] });
        act(() => funnel("Remarks")!.click());
        const input = textFunnelInput();
        expect(input).not.toBeNull();
        act(() => input!.focus());

        typeInto(input!, "zzz");
        render({ rows: [row("A")], loading: true }); // the query is in flight: skeleton
        expect(textFunnelInput()).toBe(input);
        expect(document.activeElement).toBe(input);
        render({ rows: [] }); // the server answers: nothing matches "zzz"

        expect(textFunnelInput()).toBe(input);
        expect(input!.isConnected).toBe(true);
        expect(document.activeElement).toBe(input);
        expect(input!.value).toBe("zzz");
        expect(container.querySelector("tbody td")?.textContent).toBe(
            "Nothing here for the current search or filters."
        );

        // ...and the person can type their way back out of it.
        typeInto(input!, "");
        render({ rows: [row("A")] });
        expect(textFunnelInput()).toBe(input);
        expect(input!.value).toBe("");
    });

    it("★ a facet funnel stays open through a tick that empties the table, and the next tick works", async () => {
        const spy = vi.fn();
        render({ rows: [row("A")], onFilterSpy: spy });
        // The values load when the funnel opens; the async act lets that promise settle inside it.
        await act(async () => funnel("Beneficiary")!.click());
        await flush();

        const box = (label: string) =>
            Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent === label)
                ?.querySelector<HTMLButtonElement>('button[role="checkbox"]');

        act(() => box("Payee B")!.click());
        render({ rows: [], onFilterSpy: spy });

        expect(box("Payee A")).toBeTruthy();
        act(() => box("Payee A")!.click());
        expect(spy).toHaveBeenLastCalledWith("beneficiary_name", ["Payee B", "Payee A"]);
    });

    it("an amount funnel keeps both boxes through an empty result", () => {
        render({ rows: [row("A")] });
        act(() => funnel("Amount")!.click());
        const min = document.body.querySelector<HTMLInputElement>('input[placeholder="Min"]')!;
        typeInto(min, "999999");
        render({ rows: [] });

        expect(document.body.querySelector('input[placeholder="Min"]')).toBe(min);
        expect(min.value).toBe("999999");
        expect(document.body.querySelector('input[placeholder="Max"]')).not.toBeNull();
    });
});

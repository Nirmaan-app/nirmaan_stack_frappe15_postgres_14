// @vitest-environment jsdom
//
// The defect: typing in the Bulk Import Transactions search box or a column funnel refreshed the
// whole screen. Every keystroke in a text or amount funnel fired the rows read (funnels had no
// debounce), and every new query was a new SWR key with no `keepPreviousData`, so `rows` dropped to
// [] while it loaded -- the table swapped to "Nothing here." and the header holding the funnel
// unmounted.
//
// ⚠️ THE FETCH RUNS THROUGH THE REAL `swr`, NOT A HAND-ROLLED STAND-IN. `useFrappeGetCall` is mocked
// only down to `useSWR(key, fetcher, options)`, so `keepPreviousData` and `isLoading` behave exactly
// as the library does in the app. A fake that re-implemented them would only test itself.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

import { useOutflowRows, type OutflowRowsController, type UseOutflowRowsOptions } from "./useOutflowRows";
import { useOutflowPeriodStore } from "./useOutflowPeriodStore";
import { useOutflowSourceStore } from "./useOutflowSourceStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Params = Record<string, unknown>;

const h = vi.hoisted(() => ({
    /** Every request the hook sent, in order, held open until the test lands or fails it. */
    requests: [] as { params: Params; resolve: (v: unknown) => void; reject: (e: unknown) => void }[],
    /** The SWR options each render passed. */
    options: [] as unknown[],
}));

vi.mock("frappe-react-sdk", async () => {
    const { default: useSWR } = await import("swr");
    return {
        useFrappeGetCall: (_method: string, params: Params, key: string | null, options?: object) => {
            h.options.push(options);
            return useSWR(
                key,
                () => new Promise((resolve, reject) => h.requests.push({ params, resolve, reject })),
                options
            );
        },
    };
});

const DEBOUNCE_MS = 300;

const row = (name: string): OutflowImportRow =>
    ({ name, beneficiary_name: `Payee ${name}`, amount: 100, row_status: "Pending" }) as OutflowImportRow;

const page = (rows: OutflowImportRow[]) => ({
    message: { rows, total: rows.length, limit: 50, offset: 0, scope: "all", tab_counts: {} },
});

let ctl: OutflowRowsController;
function Harness(props: UseOutflowRowsOptions) {
    ctl = useOutflowRows(props);
    return null;
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const last = () => h.requests[h.requests.length - 1];
const settle = (fn: () => void) =>
    act(async () => {
        fn();
        await new Promise((r) => setTimeout(r, 0));
    });
const land = (rows: OutflowImportRow[]) => settle(() => last().resolve(page(rows)));
const names = () => ctl.rows.map((r) => r.name);

describe("useOutflowRows while a person types", () => {
    let container: HTMLDivElement;
    let root: Root;

    const mount = (props: UseOutflowRowsOptions = { scope: "all" }) =>
        act(() =>
            root.render(
                <SWRConfig
                    value={{
                        provider: () => new Map(),
                        dedupingInterval: 0,
                        revalidateOnFocus: false,
                        revalidateOnReconnect: false,
                        shouldRetryOnError: false,
                    }}
                >
                    <Harness {...props} />
                </SWRConfig>
            )
        );

    beforeEach(async () => {
        h.requests.length = 0;
        h.options.length = 0;
        // The period and source live in shared stores; a value left by another case would narrow this one.
        useOutflowPeriodStore.setState({ period: null });
        useOutflowSourceStore.setState({ sources: [] });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        mount();
        await land([row("A")]);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("loaded the first page once, before any typing", () => {
        expect(h.requests).toHaveLength(1);
        expect(names()).toEqual(["A"]);
        expect(ctl.loading).toBe(false);
    });

    describe("a text funnel", () => {
        it("★ shows every letter at once but asks the server once, after the pause", async () => {
            for (const value of ["r", "re", "ren", "rent"]) {
                act(() => ctl.setFilter("remarks", value));
                // The input binds to `filters`, so it must not wait for the debounce.
                expect(ctl.filters.remarks).toBe(value);
                await wait(50);
            }
            expect(h.requests).toHaveLength(1);

            await wait(DEBOUNCE_MS + 50);
            expect(h.requests).toHaveLength(2);
            expect(last().params.search).toBe("rent");
        });

        it("still asks once per real pause -- the debounce does not swallow a second edit", async () => {
            act(() => ctl.setFilter("remarks", "ab"));
            await wait(DEBOUNCE_MS + 50);
            await land([row("B")]);
            act(() => ctl.setFilter("remarks", "abc"));
            await wait(DEBOUNCE_MS + 50);

            expect(h.requests.map((r) => r.params.search)).toEqual([undefined, "ab", "abc"]);
        });

        it("typing then deleting back to the original asks nothing new", async () => {
            act(() => ctl.setFilter("remarks", "x"));
            await wait(50);
            act(() => ctl.setFilter("remarks", ""));
            await wait(DEBOUNCE_MS + 50);

            expect(h.requests).toHaveLength(1);
            expect(names()).toEqual(["A"]);
        });
    });

    it("★ an amount funnel's Min then Max, typed quickly, is one request carrying both", async () => {
        act(() => ctl.setFilter("amount", { min: 1000, max: null }));
        await wait(50);
        act(() => ctl.setFilter("amount", { min: 1000, max: 5000 }));
        await wait(DEBOUNCE_MS + 50);

        expect(h.requests).toHaveLength(2);
        expect(last().params).toMatchObject({ amount_min: 1000, amount_max: 5000 });
    });

    it("a burst of facet ticks is one request with every tick in it", async () => {
        act(() => ctl.setFilter("beneficiary_name", ["Payee A"]));
        act(() => ctl.setFilter("beneficiary_name", ["Payee A", "Payee B"]));
        await wait(DEBOUNCE_MS + 50);

        expect(h.requests).toHaveLength(2);
        // Compared as the exact string the hook sends (residence rule F2: no inline JSON parsing in pages/).
        expect(last().params.facets).toBe(JSON.stringify({ beneficiary_name: ["Payee A", "Payee B"] }));
    });

    it("the search box is still debounced (regression)", async () => {
        for (const value of ["c", "cr", "crn"]) {
            act(() => ctl.setSearch(value));
            await wait(50);
        }
        expect(h.requests).toHaveLength(1);
        await wait(DEBOUNCE_MS + 50);
        expect(h.requests).toHaveLength(2);
        expect(last().params.search).toBe("crn");
    });

    describe("while the next query is loading", () => {
        beforeEach(async () => {
            act(() => ctl.setFilter("remarks", "rent"));
            await wait(DEBOUNCE_MS + 50);
            expect(h.requests).toHaveLength(2);
        });

        // The table draws a skeleton over these while `loading`; keeping them is what holds the
        // total and the tab counts steady instead of dropping to zero mid-query.
        it("★ keeps the previous answer and reports loading", () => {
            expect(names()).toEqual(["A"]);
            expect(ctl.total).toBe(1);
            expect(ctl.loading).toBe(true);
        });

        it("swaps to the new rows when they land", async () => {
            await land([row("B"), row("C")]);
            expect(names()).toEqual(["B", "C"]);
            expect(ctl.total).toBe(2);
            expect(ctl.loading).toBe(false);
        });

        it("a genuinely empty answer still empties the table (old rows are not kept forever)", async () => {
            await land([]);
            expect(names()).toEqual([]);
            expect(ctl.total).toBe(0);
            expect(ctl.loading).toBe(false);
        });

        it("a failed request stops the loading state", async () => {
            await settle(() => last().reject(new Error("500")));
            expect(ctl.loading).toBe(false);
        });

        it("is not `failed` while it is still loading", () => {
            expect(ctl.failed).toBe(false);
        });

        it("★ a failed request reports `failed` (the rows it still holds are the old query's)", async () => {
            await settle(() => last().reject(new Error("500")));
            expect(ctl.failed).toBe(true);
            expect(names()).toEqual(["A"]); // why the table must not draw them
        });

        it("★ Retry (mutate) asks again: loading, then the answer, and `failed` clears", async () => {
            await settle(() => last().reject(new Error("500")));
            const before = h.requests.length;
            await act(async () => {
                void ctl.mutate();
                await new Promise((r) => setTimeout(r, 0));
            });
            expect(h.requests.length).toBe(before + 1);
            expect(ctl.failed).toBe(false);
            expect(ctl.loading).toBe(true);

            await land([row("B")]);
            expect(ctl.failed).toBe(false);
            expect(names()).toEqual(["B"]);
        });

        it("a different query after a failure starts clean", async () => {
            await settle(() => last().reject(new Error("500")));
            act(() => ctl.setFilter("remarks", "salary"));
            await wait(DEBOUNCE_MS + 50);
            expect(ctl.failed).toBe(false);
            expect(ctl.loading).toBe(true);
        });

        it("an answer that lands late for an OLDER query does not overwrite the newer one", async () => {
            const older = last();
            act(() => ctl.setFilter("remarks", "rental"));
            await wait(DEBOUNCE_MS + 50);
            await land([row("NEW")]);
            await settle(() => older.resolve(page([row("OLD")])));

            expect(names()).toEqual(["NEW"]);
        });
    });

    it("★ the export and summary queries follow what is ON SCREEN, not what is half-typed", async () => {
        act(() => ctl.setFilter("remarks", "rent"));
        await wait(50);
        // Mid-debounce the table still shows the old rows, so Export must still describe them.
        expect(ctl.exportQuery.search).toBeUndefined();
        expect(ctl.filterQuery.search).toBeUndefined();

        await wait(DEBOUNCE_MS + 50);
        expect(ctl.exportQuery.search).toBe("rent");
        expect(ctl.filterQuery.search).toBe("rent");
    });

    it("a filter change on page 3 lands back on the first page", async () => {
        act(() => ctl.setPage(2));
        await wait(10);
        expect(last().params.offset).toBe(100);
        await land([row("P3")]);

        act(() => ctl.setFilter("remarks", "rent"));
        await wait(DEBOUNCE_MS + 50);

        expect(ctl.page).toBe(0);
        expect(last().params).toMatchObject({ offset: 0, search: "rent" });
    });

    describe("the screen's scope controls apply AT ONCE (only the funnels wait)", () => {
        it("★ the period: no window where the Period control and the figures disagree", async () => {
            act(() => ctl.setFilter("added_on", { operator: "Between", value: ["2026-10-01", "2026-10-15"] }));
            await wait(10);

            expect(h.requests).toHaveLength(2);
            expect(last().params).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-15" });
            expect(ctl.filterQuery).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-15" });
        });

        it("★ the period set from the store (the Period control above the summary)", async () => {
            act(() => useOutflowPeriodStore.getState().setPeriod({ operator: "Is", value: "2026-10-05" }));
            await wait(10);
            expect(last().params).toMatchObject({ date_from: "2026-10-05", date_to: "2026-10-05" });
        });

        it("★ the source", async () => {
            act(() => useOutflowSourceStore.getState().setSources(["ICICI"]));
            await wait(10);
            expect(h.requests).toHaveLength(2);
            expect(last().params.facets).toBe(JSON.stringify({ source: ["ICICI"] }));
        });

        it("a funnel typed just before a period change still waits for its own pause", async () => {
            act(() => ctl.setFilter("remarks", "rent"));
            act(() => useOutflowPeriodStore.getState().setPeriod({ operator: "Is", value: "2026-10-05" }));
            await wait(10);
            expect(last().params.search).toBeUndefined();
            expect(last().params.date_from).toBe("2026-10-05");

            await wait(DEBOUNCE_MS + 50);
            expect(last().params).toMatchObject({ search: "rent", date_from: "2026-10-05" });
        });

        it("Clear filters leaves the period and source alone (unchanged rule)", async () => {
            act(() => useOutflowSourceStore.getState().setSources(["ICICI"]));
            act(() => ctl.setFilter("remarks", "rent"));
            await wait(DEBOUNCE_MS + 50);
            act(() => ctl.clearFilters());
            await wait(DEBOUNCE_MS + 50);

            // The query the table now shows. (No NEW request is expected: it is the source-only
            // query already sent above and still in flight, which SWR rightly reuses.)
            expect(ctl.exportQuery.search).toBeUndefined();
            expect(ctl.exportQuery.facets).toEqual({ source: ["ICICI"] });
            expect(ctl.filterCount).toBe(0);
        });
    });

    it("caps automatic retries at two (the SDK default retries forever)", () => {
        expect(h.options.every((o) => (o as { errorRetryCount?: number })?.errorRetryCount === 2)).toBe(true);
    });

    it("passes keepPreviousData to the rows read", () => {
        expect(h.options.every((o) => (o as { keepPreviousData?: boolean })?.keepPreviousData === true)).toBe(true);
    });
});

describe("useOutflowRows when disabled (the Skipped dialog before it opens)", () => {
    it("sends nothing, even after typing in a funnel", async () => {
        h.requests.length = 0;
        const container = document.createElement("div");
        const root = createRoot(container);
        act(() =>
            root.render(
                <SWRConfig value={{ provider: () => new Map() }}>
                    <Harness scope="skipped" enabled={false} />
                </SWRConfig>
            )
        );
        act(() => ctl.setFilter("remarks", "rent"));
        await wait(DEBOUNCE_MS + 50);

        expect(h.requests).toHaveLength(0);
        act(() => root.unmount());
    });
});

// ⚠️ THE SUMMARY CARD IS ON `OutflowMasterPage`, which is too large to mount here, so its half of the
// fix is checked as text: without `keepPreviousData` the whole card blanks on every filter change.
describe("the summary read on the master page", () => {
    // From the frontend root: under jsdom `import.meta.url` is not a file: URL.
    const source = readFileSync(resolve(process.cwd(), "src/pages/outflow-import/OutflowMasterPage.tsx"), "utf8");
    const call = /useFrappeGetCall<[^>]*>\(\s*"nirmaan_stack\.api\.outflow_import\.review\.get_outflow_summary",[\s\S]*?\n {4}\);/.exec(
        source
    )?.[0];

    it("found the call (a moved call would pass vacuously)", () => {
        expect(call).toBeTruthy();
    });

    it("★ keeps the previous summary while the next one loads", () => {
        expect(call).toMatch(/keepPreviousData:\s*true/);
    });
});

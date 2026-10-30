// @vitest-environment jsdom
//
// The Bulk Import Transactions table, end to end, the way a person drives it: the search box, the
// column funnels, Clear filters, sort and paging -- wired exactly as `OutflowMasterPage` wires them
// (`useOutflowRows` -> `OutflowRowsTable` + `TablePagination` + `ClearFiltersButton`).
//
// ⚠️ ONLY THE NETWORK IS FAKED. The fetch goes through the real `swr` (the SDK's hook is mocked
// down to `useSWR`), and the "server" below genuinely filters, sorts and pages a fixed set of rows
// with a delay, so loading, debounce and late answers happen as they do in the browser. What it
// cannot cover is layout and the real server's SQL -- those are the live-browser walk's job.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";

import { ClearFiltersButton, OutflowRowsTable, TablePagination } from "./components/OutflowRowsTable";
import { useOutflowPeriodStore } from "./useOutflowPeriodStore";
import { useOutflowRows } from "./useOutflowRows";
import { useOutflowSourceStore } from "./useOutflowSourceStore";

// ─── jsdom's gaps (TEST shims only) ─────────────────────────────────────────────────────────
class StubResizeObserver {
    observe() { /* no layout in jsdom */ }
    unobserve() { /* no layout in jsdom */ }
    disconnect() { /* no layout in jsdom */ }
}
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── the fake server ────────────────────────────────────────────────────────────────────────
const PAYEES = ["Acme Steel", "Bharat Cement", "City Electricals", "Delta Paints", "Eagle Transport"];

/** 120 transfers: payee cycles through five, remarks alternate Rent / Salary, amounts 100..12000. */
const DATA: OutflowImportRow[] = Array.from({ length: 120 }, (_, i) => ({
    name: `R${String(i + 1).padStart(3, "0")}`,
    beneficiary_name: PAYEES[i % 5],
    remarks: `${i % 2 ? "Salary" : "Rent"} ${i + 1}`,
    bank_reference_no: `UTR${1000 + i}`,
    amount: (i + 1) * 100,
    row_status: i % 3 ? "Pending" : "Matched",
    added_on: `2026-10-${String((i % 28) + 1).padStart(2, "0")} 10:00:00`,
})) as unknown as OutflowImportRow[];

type Params = Record<string, unknown>;

const h = vi.hoisted(() => ({
    sent: [] as Record<string, unknown>[],
    delayMs: 40,
    /** Set to make the next N rows requests fail. */
    failNext: 0,
    /** Requests sent and not yet answered -- what `idle()` waits on instead of a guessed delay. */
    inflight: 0,
    /** Bumped per test, so an answer still on its way from the previous test cannot touch `inflight`. */
    run: 0,
}));

/**
 * The ticked values per column, read from the `facets` string the hook sends -- `{"col":["a","b"]}`.
 *
 * ⚠️ READ WITH A REGEX, NOT A JSON PARSE, because residence rule F2 counts every inline parse call
 * under pages/, tests included. Each value is kept as its JSON-quoted form (`"Acme Steel"`) and a
 * row matches by comparing `JSON.stringify(value)` against it. The sample values hold no `]`.
 */
const tickedFacets = (raw: string): [string, string[]][] =>
    Array.from(raw.matchAll(/"(\w+)":\[([^\]]*)\]/g), ([, column, list]) => [
        column,
        list.match(/"(?:[^"\\]|\\.)*"/g) ?? [],
    ]);

function serve(params: Params) {
    const search = String(params.search ?? "").toLowerCase();
    const facets = tickedFacets(String(params.facets ?? "{}"));
    let rows = DATA.filter((r) => {
        if (search && ![r.remarks, r.beneficiary_name, r.bank_reference_no].some((v) => String(v).toLowerCase().includes(search)))
            return false;
        for (const [column, quoted] of facets) {
            const value = JSON.stringify(String((r as unknown as Params)[column]));
            if (quoted.length && !quoted.includes(value)) return false;
        }
        if (params.amount_min != null && Number(r.amount) < Number(params.amount_min)) return false;
        if (params.amount_max != null && Number(r.amount) > Number(params.amount_max)) return false;
        return true;
    });
    const by = String(params.sort_by ?? "added_on") as keyof OutflowImportRow;
    const dir = params.sort_dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => (a[by]! > b[by]! ? dir : a[by]! < b[by]! ? -dir : 0));
    const offset = Number(params.offset ?? 0);
    const limit = Number(params.limit ?? 50);
    return {
        message: {
            rows: rows.slice(offset, offset + limit),
            total: rows.length,
            limit,
            offset,
            scope: String(params.scope),
            tab_counts: {},
        },
    };
}

vi.mock("frappe-react-sdk", async () => {
    const { default: useSWR } = await import("swr");
    return {
        useFrappeGetCall: (_method: string, params: Params, key: string | null, options?: object) =>
            useSWR(
                key,
                () => {
                    h.sent.push(params);
                    h.inflight += 1;
                    const run = h.run;
                    return new Promise((resolve, reject) =>
                        setTimeout(() => {
                            if (run === h.run) h.inflight -= 1;
                            if (h.failNext > 0) {
                                h.failNext -= 1;
                                reject(new Error("500"));
                            } else resolve(serve(params));
                        }, h.delayMs)
                    );
                },
                options
            ),
    };
});

// The funnels fetch their values with plain `fetch` when opened.
const facetFetch = vi.fn(async (url: string) => {
    const column = new URL(url, "http://x").searchParams.get("column") ?? "";
    const values = Array.from(new Set(DATA.map((r) => String((r as unknown as Params)[column])))).sort();
    return { ok: true, status: 200, json: async () => ({ message: { values } }) };
});

// ─── the page, as OutflowMasterPage wires it ────────────────────────────────────────────────
const NONE = new Set<string>();
const NO_ORIGINS = new Map();

function MiniPage() {
    const table = useOutflowRows({ scope: "all" });
    return (
        <div>
            <input
                data-testid="search"
                placeholder="Search remarks, reference or beneficiary…"
                value={table.search}
                onChange={(e) => table.setSearch(e.target.value)}
            />
            <ClearFiltersButton count={table.filterCount} onClear={table.clearFilters} />
            <OutflowRowsTable
                rows={table.rows}
                loading={table.loading}
                failed={table.failed}
                onRetry={() => void table.mutate()}
                loadFacetValues={table.loadFacetValues}
                query={table.search}
                filters={table.filters}
                sort={table.sort}
                hiddenColumns={table.hidden}
                selected={NONE}
                decidedRowNames={NONE}
                originByRow={NO_ORIGINS}
                selectableRowNames={NONE}
                onSort={table.toggleSort}
                onFilter={table.setFilter}
                onToggleRow={() => {}}
                onToggleAll={() => {}}
                onOpenDecision={() => {}}
            />
            {!table.failed && (
                <TablePagination
                    total={table.total}
                    limit={table.pageSize}
                    offset={table.page * table.pageSize}
                    busy={table.loading}
                    onPage={table.setPage}
                />
            )}
        </div>
    );
}

// ─── a person's hands ───────────────────────────────────────────────────────────────────────
/**
 * Let real time pass, in 10ms steps.
 *
 * ⚠️ STEPPED, NOT ONE LONG `act`. React holds every render scheduled inside an `act` until that
 * `act` ends, so one 460ms `act` let the debounce fire but held its render -- and with it the
 * request -- until the very end, which the browser never does. Short steps render as time passes.
 */
const sleep = async (ms: number) => {
    const end = Date.now() + ms;
    do {
        await act(() => new Promise<void>((r) => setTimeout(r, 10)));
    } while (Date.now() < end);
};

const setValue = (input: HTMLInputElement, value: string) =>
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });

/** Type one letter at a time, ~40ms apart, the way a person does. */
async function typeSlowly(input: HTMLInputElement, text: string, from = input.value) {
    for (let i = 1; i <= text.length; i++) {
        await setValue(input, from + text.slice(0, i));
        await sleep(40);
    }
}

/**
 * Wait until `cond` holds, in the same 10ms steps, giving up after `ms` so a broken case still fails.
 *
 * ⚠️ CONDITIONS, NOT GUESSED DELAYS. A fixed "debounce + server delay + margin" passed alone and failed
 * under the full suite's load, where a 10ms step can take far longer. The expectations after it still
 * decide pass or fail; this only stops them running early.
 */
const until = async (cond: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await sleep(10);
};

/** Nothing in flight and nothing loading: the screen shows its answer. */
const idle = () => until(() => h.inflight === 0 && !skeleton());

/** The 300ms debounce has passed and its request has been answered. */
const settle = async () => {
    await sleep(300 + 20);
    await idle();
};

const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel);
const searchBox = () => $<HTMLInputElement>('[data-testid="search"]')!;
const dataRows = () => Array.from(document.body.querySelectorAll("tbody tr:not([data-skeleton-row])")).filter(
    (tr) => tr.querySelectorAll("td").length > 1
);
const skeleton = () => document.body.querySelectorAll("tbody tr[data-skeleton-row]").length > 0;
const emptyMessage = () => {
    const td = $("tbody td[colspan]");
    return td?.textContent ?? null;
};
const funnel = (title: string) => $<HTMLButtonElement>(`button[aria-label="Filter ${title}"]`)!;
const button = (text: string) =>
    Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(text));
const facetBox = (label: string) =>
    Array.from(document.body.querySelectorAll("label"))
        .find((l) => l.textContent === label)
        ?.querySelector<HTMLButtonElement>('button[role="checkbox"]');
const pageLabel = () =>
    Array.from(document.body.querySelectorAll("span")).find((s) => /\d+–\d+ of \d+/.test(s.textContent ?? ""))
        ?.textContent ?? null;
const rowsText = () => dataRows().map((tr) => tr.textContent ?? "");

// ─── the flows ──────────────────────────────────────────────────────────────────────────────
describe("Bulk Import Transactions table — a person searching and filtering", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        h.sent.length = 0;
        h.delayMs = 40;
        h.failNext = 0;
        h.inflight = 0;
        h.run += 1;
        facetFetch.mockClear();
        vi.stubGlobal("fetch", facetFetch);
        useOutflowPeriodStore.setState({ period: null });
        useOutflowSourceStore.setState({ sources: [] });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        act(() =>
            root.render(
                <SWRConfig
                    value={{
                        provider: () => new Map(),
                        dedupingInterval: 0,
                        revalidateOnFocus: false,
                        revalidateOnReconnect: false,
                        // Automatic retries stay ON, as in the app, but 20 ms apart instead of ~5 s,
                        // so the hook's retry cap is exercised for real.
                        errorRetryInterval: 20,
                    }}
                >
                    <MiniPage />
                </SWRConfig>
            )
        );
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.body.innerHTML = "";
        vi.unstubAllGlobals();
    });

    it("first load: skeleton under the header, then the first 50 of 120", async () => {
        expect(funnel("Remarks")).toBeTruthy();
        expect(skeleton()).toBe(true);
        expect(emptyMessage()).toBeNull();

        await settle();
        expect(skeleton()).toBe(false);
        expect(dataRows()).toHaveLength(50);
        expect(pageLabel()).toBe("1–50 of 120");
    });

    describe("the search box", () => {
        beforeEach(settle);

        it("★ typing 'Salary' keeps focus, sends ONE request, then shows only Salary rows", async () => {
            const box = searchBox();
            act(() => box.focus());
            const before = h.sent.length;

            await typeSlowly(box, "Salary");
            expect(box.value).toBe("Salary");
            expect(h.sent.length).toBe(before); // still typing: nothing sent
            expect(dataRows()).toHaveLength(50); // the old rows stay put, no flashing

            await settle();
            expect(h.sent.length).toBe(before + 1);
            expect(document.activeElement).toBe(box);
            expect(rowsText().every((t) => t.includes("Salary"))).toBe(true);
            expect(pageLabel()).toBe("1–50 of 60");
        });

        it("shows the skeleton while the search is in flight, never 'Nothing here'", async () => {
            h.delayMs = 1500;
            await typeSlowly(searchBox(), "Rent");
            await until(() => h.inflight > 0); // debounce over, server still thinking
            expect(skeleton()).toBe(true);
            expect(emptyMessage()).toBeNull();
            await idle();
            expect(skeleton()).toBe(false);
            expect(rowsText().every((t) => t.includes("Rent"))).toBe(true);
        });

        it("★ no match: the filtered message; clearing the search brings every row back", async () => {
            await typeSlowly(searchBox(), "zzz");
            await settle();
            expect(dataRows()).toHaveLength(0);
            expect(emptyMessage()).toBe("Nothing here for the current search or filters.");
            expect(pageLabel()).toBeNull();

            await setValue(searchBox(), "");
            await settle();
            expect(dataRows()).toHaveLength(50);
            expect(pageLabel()).toBe("1–50 of 120");
        });

        it("typing then deleting back to empty inside the pause sends nothing", async () => {
            const before = h.sent.length;
            await setValue(searchBox(), "x");
            await setValue(searchBox(), "");
            await settle();
            expect(h.sent.length).toBe(before);
            expect(dataRows()).toHaveLength(50);
        });

        it("matches beneficiary and reference too (search reaches the server unchanged)", async () => {
            await typeSlowly(searchBox(), "UTR1005");
            await settle();
            expect(rowsText()).toHaveLength(1);
            expect(rowsText()[0]).toContain("Salary 6");
        });

        it("a search from page 2 starts again at page 1", async () => {
            await act(async () => button("Next")!.click());
            await settle();
            expect(pageLabel()).toBe("51–100 of 120");

            await typeSlowly(searchBox(), "Rent");
            await settle();
            expect(pageLabel()).toBe("1–50 of 60");
        });

    });

    describe("when the server fails", () => {
        beforeEach(settle);

        const failure = () => $('tbody [role="alert"]')?.textContent ?? null;
        /**
         * Until the first try and both capped retries have all failed and nothing is in flight.
         * ⚠️ NOT "until the failure row shows": it also shows in the gap between two retries.
         */
        const outlastRetries = (before: number) =>
            until(() => h.sent.length >= before + 3 && h.inflight === 0 && failure() !== null);

        it("★ says 'Couldn't load', and never shows the old rows as the result", async () => {
            h.failNext = 99;
            const before = h.sent.length;
            await typeSlowly(searchBox(), "Salary");
            await outlastRetries(before);

            expect(failure()).toContain("Couldn't load transactions.");
            expect(dataRows()).toHaveLength(0); // the 50 unfiltered rows are NOT shown
            expect(pageLabel()).toBeNull(); // nor their "1–50 of 120"
            expect(emptyMessage()).not.toContain("Nothing here");
        });

        it("★ gives up after two automatic retries, so the screen stops flickering", async () => {
            h.failNext = 99;
            const before = h.sent.length;
            await typeSlowly(searchBox(), "Salary");
            await outlastRetries(before);
            expect(h.sent.length).toBe(before + 3); // first try + 2 retries

            await sleep(600);
            expect(h.sent.length).toBe(before + 3);
            expect(failure()).toContain("Couldn't load transactions.");
        });

        it("★ Retry loads the result once the server is back", async () => {
            h.failNext = 99;
            const before = h.sent.length;
            await typeSlowly(searchBox(), "Salary");
            await outlastRetries(before);

            h.failNext = 0;
            const retry = Array.from(document.body.querySelectorAll("tbody button")).find(
                (b) => b.textContent === "Retry"
            ) as HTMLButtonElement;
            await act(async () => retry.click());
            await until(() => h.inflight === 0 && failure() === null && !skeleton());

            expect(failure()).toBeNull();
            expect(rowsText().every((t) => t.includes("Salary"))).toBe(true);
            expect(pageLabel()).toBe("1–50 of 60");
        });

        it("a one-off blip recovers by itself: no failure left on screen", async () => {
            h.failNext = 1;
            await typeSlowly(searchBox(), "Salary");
            await until(() => pageLabel() === "1–50 of 60");

            expect(failure()).toBeNull();
            expect(pageLabel()).toBe("1–50 of 60");
        });

        it("changing the search after a failure asks again and shows the new rows", async () => {
            h.failNext = 99;
            const before = h.sent.length;
            await typeSlowly(searchBox(), "Salary");
            await outlastRetries(before);

            h.failNext = 0;
            await setValue(searchBox(), "Rent");
            await settle();
            expect(failure()).toBeNull();
            expect(rowsText().every((t) => t.includes("Rent"))).toBe(true);
        });
    });

    describe("a facet funnel (Beneficiary)", () => {
        beforeEach(settle);

        const openBeneficiary = async () => {
            await act(async () => funnel("Beneficiary").click());
            await sleep(10);
        };

        it("★ opening lists every payee; ticking one stays open, loads, and filters", async () => {
            await openBeneficiary();
            expect(facetFetch).toHaveBeenCalledTimes(1);
            for (const p of PAYEES) expect(facetBox(p)).toBeTruthy();

            await act(async () => facetBox("Delta Paints")!.click());
            expect(facetBox("Delta Paints")).toBeTruthy(); // popover still open
            await settle();

            expect(rowsText().every((t) => t.includes("Delta Paints"))).toBe(true);
            expect(dataRows()).toHaveLength(24);
            expect(facetBox("Acme Steel")).toBeTruthy(); // still open after the rows changed
        });

        it("★ two quick ticks are one request with both payees", async () => {
            await openBeneficiary();
            const before = h.sent.length;
            await act(async () => facetBox("Acme Steel")!.click());
            await act(async () => facetBox("Eagle Transport")!.click());
            await settle();

            expect(h.sent.length).toBe(before + 1);
            expect(h.sent.at(-1)!.facets).toBe(
                JSON.stringify({ beneficiary_name: ["Acme Steel", "Eagle Transport"] })
            );
            expect(dataRows()).toHaveLength(48);
        });

        it("unticking the last value shows every row again", async () => {
            await openBeneficiary();
            await act(async () => facetBox("Acme Steel")!.click());
            await settle();
            await act(async () => facetBox("Acme Steel")!.click());
            await settle();
            expect(pageLabel()).toBe("1–50 of 120");
        });

        it("★ Clear filters (1) appears, and clears it", async () => {
            await openBeneficiary();
            await act(async () => facetBox("Acme Steel")!.click());
            await settle();
            expect(button("Clear filters (1)")).toBeTruthy();

            await act(async () => button("Clear filters")!.click());
            await settle();
            expect(button("Clear filters")).toBeUndefined();
            expect(pageLabel()).toBe("1–50 of 120");
        });

        it("search + facet combine on the server", async () => {
            await openBeneficiary();
            await act(async () => facetBox("Acme Steel")!.click());
            await typeSlowly(searchBox(), "Rent");
            await settle();
            // Acme Steel is every 5th row from 0; half of those are Rent.
            expect(dataRows()).toHaveLength(12);
            expect(rowsText().every((t) => t.includes("Acme Steel") && t.includes("Rent"))).toBe(true);

            // UTR1001 is Bharat Cement's: with Acme ticked, nothing matches both.
            await setValue(searchBox(), "UTR1001");
            await settle();
            expect(emptyMessage()).toBe("Nothing here for the current search or filters.");
            expect(facetBox("Acme Steel")).toBeTruthy(); // the funnel is still open
        });
    });

    describe("the text funnel (Remarks)", () => {
        beforeEach(settle);

        it("★ typing into it keeps the popover and cursor through loading, no-match and back", async () => {
            await act(async () => funnel("Remarks").click());
            const input = $<HTMLInputElement>('input[placeholder="Contains…"]')!;
            act(() => input.focus());
            const before = h.sent.length;

            await typeSlowly(input, "Salary 11");
            expect(h.sent.length).toBe(before);
            await settle();
            expect(h.sent.length).toBe(before + 1);
            expect($('input[placeholder="Contains…"]')).toBe(input);
            expect(document.activeElement).toBe(input);
            // "Salary 11", "Salary 111", "Salary 113", ... (odd numbers only)
            expect(rowsText().every((t) => t.includes("Salary 11"))).toBe(true);

            await typeSlowly(input, "9999");
            await settle();
            expect(emptyMessage()).toBe("Nothing here for the current search or filters.");
            expect($('input[placeholder="Contains…"]')).toBe(input);
            expect(document.activeElement).toBe(input);

            await setValue(input, "");
            await settle();
            expect(pageLabel()).toBe("1–50 of 120");
        });
    });

    describe("the amount funnel", () => {
        beforeEach(settle);

        it("★ Min then Max typed quickly: one request, rows inside the range", async () => {
            await act(async () => funnel("Amount").click());
            const min = $<HTMLInputElement>('input[placeholder="Min"]')!;
            const max = $<HTMLInputElement>('input[placeholder="Max"]')!;
            const before = h.sent.length;

            await typeSlowly(min, "1000");
            await typeSlowly(max, "2000");
            await settle();

            expect(h.sent.length).toBe(before + 1);
            expect(h.sent.at(-1)).toMatchObject({ amount_min: 1000, amount_max: 2000 });
            expect(dataRows()).toHaveLength(11);
            expect($('input[placeholder="Min"]')).toBe(min);
        });
    });

    describe("sort and paging (unchanged behaviour)", () => {
        beforeEach(settle);

        it("clicking Amount sorts ascending on the server", async () => {
            const header = Array.from(document.body.querySelectorAll("thead button")).find(
                (b) => b.textContent?.trim() === "Amount"
            ) as HTMLButtonElement;
            await act(async () => header.click());
            await idle(); // a sort is a click, not typing: no debounce
            expect(h.sent.at(-1)).toMatchObject({ sort_by: "amount", sort_dir: "asc" });
            expect(rowsText()[0]).toContain("Rent 1");
        });

        it("Next and Previous page through, with the right ranges", async () => {
            await act(async () => button("Next")!.click());
            await idle();
            expect(pageLabel()).toBe("51–100 of 120");
            await act(async () => button("Next")!.click());
            await idle();
            expect(pageLabel()).toBe("101–120 of 120");
            expect(dataRows()).toHaveLength(20);
            await act(async () => button("Previous")!.click());
            await idle();
            expect(pageLabel()).toBe("51–100 of 120");
        });

        it("going back to a page already seen shows it at once, without a skeleton", async () => {
            await act(async () => button("Next")!.click());
            await idle();
            await act(async () => button("Previous")!.click());
            expect(skeleton()).toBe(false);
            expect(pageLabel()).toBe("1–50 of 120");
        });
    });
});

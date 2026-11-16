// @vitest-environment jsdom
//
// A page may hand `useServerDataTable` a new `getRowId` or `onRowSelectionChange` on every render (an inline arrow,
// as Cheque Tracker, Payees and four more tables do). The table must still fetch its rows once, not again after
// every render: on 13 Nov 2026 such a table sent its list request over and over (1,000+ a minute) because the
// fetch depended on those two functions. Only the network is faked; the hook is the real one.
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";

import { useServerDataTable } from "./useServerDataTable";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The SDK's `call` and `reset` keep one identity across renders, so the fakes are made once.
const fake = vi.hoisted(() => ({
    call: vi.fn(async () => ({ message: { data: [{ name: "CHQ-1" }, { name: "CHQ-2" }], total_count: 2 } })),
    reset: () => undefined,
}));
vi.mock("frappe-react-sdk", async () => {
    const { createContext } = await import("react");
    return {
        useFrappePostCall: () => ({ call: fake.call, loading: false, reset: fake.reset }),
        // No provider value: no socket, so no live refresh; the fetch on mount is what is counted.
        FrappeContext: createContext(undefined),
    };
});

type Row = { name: string };
const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: "name", header: "Name" }];

/** A page that passes a fresh function on every render, the way the six affected tables do. */
function Page({ inline }: { inline: "getRowId" | "onRowSelectionChange" | "neither" }) {
    const [, setTicks] = useState<RowSelectionState>({});
    useServerDataTable<Row>({
        doctype: "Cheques",
        columns: COLUMNS,
        fetchFields: ["name"],
        searchableFields: [],
        ...(inline === "getRowId" ? { getRowId: (row: Row) => row.name } : {}),
        ...(inline === "onRowSelectionChange"
            ? { onRowSelectionChange: (next: React.SetStateAction<RowSelectionState>) => setTicks(next) }
            : {}),
    });
    return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    fake.call.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** Render, then let replies and the renders they cause settle. A looping table keeps fetching meanwhile. */
async function renderAndSettle(inline: "getRowId" | "onRowSelectionChange" | "neither") {
    await act(async () => {
        root.render(<Page inline={inline} />);
    });
    for (let i = 0; i < 10; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    }
}

describe("useServerDataTable fetches its rows once, whatever functions the page passes", () => {
    it("with an inline getRowId", async () => {
        await renderAndSettle("getRowId");
        expect(fake.call).toHaveBeenCalledTimes(1);
    });

    it("with an inline onRowSelectionChange", async () => {
        await renderAndSettle("onRowSelectionChange");
        expect(fake.call).toHaveBeenCalledTimes(1);
    });

    it("with neither (the baseline)", async () => {
        await renderAndSettle("neither");
        expect(fake.call).toHaveBeenCalledTimes(1);
    });
});

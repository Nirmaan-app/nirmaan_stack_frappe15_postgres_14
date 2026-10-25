// @vitest-environment jsdom
//
// The Payments Report (Non-Project)'s card shows one total at every width (story 65, review round 5 CC1):
// the phone card printed the Paid rows alone while the desktop added the Partially Reconciled part.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NonProjectExpenseSummaryCard } from "./NonProjectExpenseSummaryCard";

describe("NonProjectExpenseSummaryCard", () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("shows the same total on the phone card and the desktop card", () => {
        act(() => {
            root.render(
                <NonProjectExpenseSummaryCard
                    aggregates={{ sum_of_amount: 11400 }}
                    partiallyReconciled={{ amount: 2000, count: 1, items: [] }}
                    isAggregatesLoading={false}
                    totalCount={3}
                    columnFilters={[]}
                    searchTerm=""
                />
            );
        });
        const phone = host.querySelector(".sm\\:hidden")?.textContent ?? "";
        const desktop = host.querySelector(".hidden.sm\\:block")?.textContent ?? "";
        expect(phone).toContain("13,400");
        expect(desktop).toContain("13,400");
    });
});

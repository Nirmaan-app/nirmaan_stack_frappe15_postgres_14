// @vitest-environment jsdom
//
// The ledger's details cell: each line on its own line, a PO / SR line as a link, and no break after the
// last line (#1508 walk: a line after a link used to run into it).
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LedgerTableRow, type LedgerEntry } from "./LedgerTableRow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const entry = (details: string): LedgerEntry => ({
    date: "2026-10-01",
    transactionType: "Payment Made",
    project: "Tower A",
    details,
    amount: 0,
    payment: 100,
    balance: 0,
});

/** The details cell's markup, with the link classes dropped so only the structure is compared. */
const detailsOf = (details: string) => {
    act(() =>
        root.render(
            <MemoryRouter>
                <table>
                    <tbody>
                        <LedgerTableRow item={entry(details)} />
                    </tbody>
                </table>
            </MemoryRouter>
        )
    );
    return container.querySelectorAll("td")[3].innerHTML.replace(/ class="[^"]*"/g, "");
};

describe("LedgerTableRow details", () => {
    it("puts one break between lines, a link per PO / SR line, and none after the last line", () => {
        expect(detailsOf("Paid by UTR 42\nFor PO: PO/1/26\nincl. TDS Rs 5\nPO: PO/2/26\nFor SR: SR-7\nSR: SR-8")).toBe(
            "Paid by UTR 42<br>" +
                'For PO: <a href="/PO&amp;=1&amp;=26">PO/1/26</a><br>' +
                "incl. TDS Rs 5<br>" +
                'PO: <a href="/PO&amp;=2&amp;=26">PO/2/26</a><br>' +
                'For SR: <a href="/service-requests-list/SR-7">SR-7</a><br>' +
                'SR: <a href="/service-requests-list/SR-8">SR-8</a>'
        );
    });

    it("renders a single line with no break", () => {
        expect(detailsOf("Opening balance")).toBe("Opening balance");
    });
});

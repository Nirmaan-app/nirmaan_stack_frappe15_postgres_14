// @vitest-environment jsdom
//
// The Office Rent breakdown as a screen draws it (spec #1613): Bill = Rent + GST − TDS → Landlord gets.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExpenseTdsBreakdown } from "./ExpenseTdsBreakdown";
import { shownExpenseTds } from "@/utils/expenses/expenseTds";

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

const forecast = () => shownExpenseTds({ type: "Office Rent", amount: 118000, status: "Requested", withheld: null });
const withheld = () =>
    shownExpenseTds({
        type: "Office Rent", amount: 108000, status: "Approved",
        withheld: { gross_amount: 100000, gst_amount: 18000, tds_percentage: 10, tds_amount: 10000, tds_section: "194-I" },
    });

describe("ExpenseTdsBreakdown", () => {
    it("draws the five figures in a block, with the caption", () => {
        act(() => root.render(<ExpenseTdsBreakdown shown={forecast()} variant="block" />));
        const pairs = Array.from(container.querySelectorAll("dt")).map((dt) => `${dt.textContent} ${dt.nextElementSibling?.textContent}`);
        expect(pairs).toEqual(["Bill ₹1,18,000", "Rent ₹1,00,000", "GST 18% ₹18,000", "TDS 10% ₹10,000", "Landlord gets ₹1,08,000"]);
        expect(container.textContent).toContain("10% TDS (194-I) on the rent will be withheld on approval");
    });

    it("draws the stored split in a table cell, what the landlord gets in bold and the caption on hover", () => {
        act(() => root.render(<ExpenseTdsBreakdown shown={withheld()} />));
        const lines = Array.from(container.firstElementChild!.children);
        expect(lines.map((l) => l.textContent)).toEqual(
            ["Bill ₹1,18,000", "Rent ₹1,00,000", "GST 18% ₹18,000", "TDS 10% ₹10,000", "Landlord gets ₹1,08,000"]);
        expect(lines.map((l) => l.className.includes("font-medium"))).toEqual([false, false, false, false, true]);
        expect(container.firstElementChild!.getAttribute("title"))
            .toBe("10% TDS (194-I) on the rent withheld; the landlord is paid the bill less TDS");
    });

    it("draws nothing for an expense with no split", () => {
        act(() => root.render(<ExpenseTdsBreakdown shown={null} />));
        expect(container.innerHTML).toBe("");
    });
});

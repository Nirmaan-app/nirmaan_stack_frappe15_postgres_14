import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import {
    BEFORE_APPROVAL_STATUSES,
    expenseTdsSplit,
    OFFICE_RENT_TDS,
    shownExpenseTds,
    tdsPreviewLine,
    tdsSplitCaption,
    tdsSplitLines,
    type WithheldTds,
} from "./expenseTds";

// The server's rule is the authority (#1525); this forecast reads it so the two cannot drift.
const SERVICES = resolve(__dirname, "../../../../nirmaan_stack/services");
const EXPENSE_TDS_PY = readFileSync(resolve(SERVICES, "expense_tds.py"), "utf-8");
const PAYMENT_TDS_PY = readFileSync(resolve(SERVICES, "payment_tds.py"), "utf-8");

describe("parity with services/expense_tds.py", () => {
    const rule = EXPENSE_TDS_PY.match(/^OFFICE_RENT_TDS = ExpenseTdsRule\(([\s\S]*?)^\)/m)?.[1] ?? "";

    it("reads the server's Office Rent rule", () => {
        expect(rule, "OFFICE_RENT_TDS not found in expense_tds.py").not.toBe("");
    });

    it("names the same type, rate and section", () => {
        expect(rule).toMatch(new RegExp(`expense_type="${OFFICE_RENT_TDS.expenseType}"`));
        expect(Number(rule.match(/rate=([\d.]+)/)?.[1])).toBe(OFFICE_RENT_TDS.ratePct);
        expect(rule).toMatch(/section=TDS_SECTION_RENT/);
        expect(PAYMENT_TDS_PY).toMatch(new RegExp(`^TDS_SECTION_RENT = "${OFFICE_RENT_TDS.section}"`, "m"));
    });
});

describe("expenseTdsSplit", () => {
    it("takes 10% from an Office Rent", () => {
        expect(expenseTdsSplit("Office Rent", 100000)).toEqual({ gross: 100000, ratePct: 10, tds: 10000, net: 90000 });
    });

    it("reads the amount as typed", () => {
        expect(expenseTdsSplit("Office Rent", "55000")).toEqual({ gross: 55000, ratePct: 10, tds: 5500, net: 49500 });
    });

    it("rounds to 2 decimals the way the server's flt(x, 2) does", () => {
        expect(expenseTdsSplit("Office Rent", 12345.67)).toEqual({ gross: 12345.67, ratePct: 10, tds: 1234.57, net: 11111.1 });
    });

    it("takes nothing from any other type", () => {
        expect(expenseTdsSplit("Electricity Expenses", 100000)).toEqual({ gross: 100000, ratePct: 0, tds: 0, net: 100000 });
        expect(expenseTdsSplit("Rent/PG for Staff", 100000).tds).toBe(0);
        expect(expenseTdsSplit("", 100000).tds).toBe(0);
    });

    it("takes nothing from a zero or a refund", () => {
        expect(expenseTdsSplit("Office Rent", 0)).toEqual({ gross: 0, ratePct: 0, tds: 0, net: 0 });
        expect(expenseTdsSplit("Office Rent", -5000)).toEqual({ gross: -5000, ratePct: 0, tds: 0, net: -5000 });
        expect(expenseTdsSplit("Office Rent", "")).toEqual({ gross: 0, ratePct: 0, tds: 0, net: 0 });
    });

    it("keeps the rule in one constant", () => {
        expect(OFFICE_RENT_TDS).toEqual({ expenseType: "Office Rent", ratePct: 10, section: "194-I" });
    });
});

describe("tdsPreviewLine", () => {
    it("says the rent, the tax and what the landlord gets", () => {
        expect(tdsPreviewLine(expenseTdsSplit("Office Rent", 100000)))
            .toBe("Rent ₹1,00,000 − TDS 10% ₹10,000 = Landlord gets ₹90,000");
    });

    it("shows paise only when there are some", () => {
        expect(tdsPreviewLine(expenseTdsSplit("Office Rent", 12345)))
            .toBe("Rent ₹12,345 − TDS 10% ₹1,234.50 = Landlord gets ₹11,110.50");
    });

    it("has no tax line for any other type, or for no amount", () => {
        expect(tdsPreviewLine(expenseTdsSplit("Electricity Expenses", 100000))).toBeNull();
        expect(tdsPreviewLine(expenseTdsSplit("Office Rent", 0))).toBeNull();
    });
});

// What the approval queue, the approve dialog, the request page and the Expenses list show (#1527).
describe("shownExpenseTds", () => {
    const withheld: WithheldTds = { gross_amount: 100000, tds_percentage: 10, tds_amount: 10000, tds_section: "194-I" };

    it("forecasts on the full rent while the Expense waits for approval", () => {
        for (const status of ["Requested", "CEO Pending", "Pending Approval"]) {
            expect(shownExpenseTds({ type: "Office Rent", amount: 100000, status, withheld: null }), status)
                .toEqual({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: false });
        }
    });

    it("shows the stored record once approved, never a forecast on the net", () => {
        expect(shownExpenseTds({ type: "Office Rent", amount: 90000, status: "Approved", withheld }))
            .toEqual({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: true });
    });

    it("keeps the stored figures after a bank line corrects the amount by a few rupees", () => {
        expect(shownExpenseTds({ type: "Office Rent", amount: 89998, status: "Paid", withheld }))
            .toEqual({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: true });
    });

    it("shows nothing for an approved Office Rent with no record (approved before the tax existed)", () => {
        for (const status of ["Approved", "Reconciliation Pending", "Paid", "Rejected"]) {
            expect(shownExpenseTds({ type: "Office Rent", amount: 100000, status, withheld: null }), status).toBeNull();
        }
    });

    it("shows nothing for any other type, or for a zero or a refund", () => {
        expect(shownExpenseTds({ type: "Electricity Expenses", amount: 100000, status: "Requested", withheld: null })).toBeNull();
        expect(shownExpenseTds({ type: "Office Rent", amount: 0, status: "Requested", withheld: null })).toBeNull();
        expect(shownExpenseTds({ type: "Office Rent", amount: -500, status: "Requested", withheld: undefined })).toBeNull();
    });

    it("names the statuses before approval", () => {
        expect([...BEFORE_APPROVAL_STATUSES].sort()).toEqual(["CEO Pending", "Pending Approval", "Requested"]);
    });
});

describe("tdsSplitLines and tdsSplitCaption", () => {
    it("read Rent / TDS / Net", () => {
        const shown = shownExpenseTds({ type: "Office Rent", amount: 100000, status: "Requested", withheld: null })!;
        expect(tdsSplitLines(shown)).toEqual([
            { label: "Rent", value: "₹1,00,000" },
            { label: "TDS 10%", value: "₹10,000" },
            { label: "Net", value: "₹90,000" },
        ]);
    });

    it("say whether the tax will be or was withheld", () => {
        expect(tdsSplitCaption({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: false }))
            .toBe("10% TDS (194-I) will be withheld on approval");
        expect(tdsSplitCaption({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: true }))
            .toBe("10% TDS (194-I) withheld; the landlord is paid the net");
    });
});

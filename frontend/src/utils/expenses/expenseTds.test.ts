import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import {
    BEFORE_APPROVAL_STATUSES,
    expenseTdsSplit,
    LANDLORD_MISSING,
    OFFICE_RENT_TDS,
    raisedForAmount,
    shownExpenseTds,
    tdsPreviewLine,
    tdsSplitCaption,
    tdsSplitLines,
    tdsTypeLock,
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
                .toEqual({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: false, section: "194-I" });
        }
    });

    it("shows the stored record once approved, never a forecast on the net", () => {
        expect(shownExpenseTds({ type: "Office Rent", amount: 90000, status: "Approved", withheld }))
            .toEqual({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: true, section: "194-I" });
    });

    it("keeps the stored figures after a bank line corrects the amount by a few rupees", () => {
        expect(shownExpenseTds({ type: "Office Rent", amount: 89998, status: "Paid", withheld }))
            .toEqual({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: true, section: "194-I" });
    });

    it("carries the stored record's own section, not the rule's", () => {
        const record = { ...withheld, tds_section: "194C" };
        const shown = shownExpenseTds({ type: "Office Rent", amount: 90000, status: "Approved", withheld: record })!;
        expect(shown.section).toBe("194C");
        expect(tdsSplitCaption(shown)).toBe("10% TDS (194C) withheld; the landlord is paid the net");
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
        expect(tdsSplitCaption({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: false, section: "194-I" }))
            .toBe("10% TDS (194-I) will be withheld on approval");
        expect(tdsSplitCaption({ gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: true, section: "194-I" }))
            .toBe("10% TDS (194-I) withheld; the landlord is paid the net");
    });

    it("warn instead of forecasting when the landlord's name or PAN is missing", () => {
        const forecast = { gross: 100000, ratePct: 10, tds: 10000, net: 90000, withheld: false, section: "194-I" };
        expect(tdsSplitCaption(forecast, true)).toBe(LANDLORD_MISSING);
        expect(LANDLORD_MISSING).toBe("Landlord's name and PAN are missing — this can't be approved");
        // A withheld record already names its landlord: nothing to warn about.
        expect(tdsSplitCaption({ ...forecast, withheld: true }, true))
            .toBe("10% TDS (194-I) withheld; the landlord is paid the net");
    });
});

// The request page's "Raised for ₹…" line (spec #1522 story 27).
describe("raisedForAmount", () => {
    it("still says the full rent asked for once the tax is withheld and the Expense carries the net", () => {
        expect(raisedForAmount(90000, 100000)).toBe(100000);
        expect(raisedForAmount(90000, "100000")).toBe(100000);
    });

    it("says what was asked for when Accounts corrected the amount", () => {
        expect(raisedForAmount(41000, 42000)).toBe(42000);
    });

    it("says nothing when the Expense carries what was asked for", () => {
        expect(raisedForAmount(42000, 42000)).toBeNull();
        expect(raisedForAmount(42000, "42000")).toBeNull();
    });

    it("says nothing, never ₹0, when the request's amount is absent", () => {
        for (const absent of [null, undefined, "", "  "]) {
            expect(raisedForAmount(90000, absent), String(absent)).toBeNull();
        }
    });
});

// The edit dialog's type select once an expense is approved (spec #1522 review batch 2), the screen
// half of the server's `expense_tds.guard_tds_type_change`.
describe("tdsTypeLock", () => {
    it("leaves the type free before approval", () => {
        for (const status of ["Requested", "CEO Pending"]) {
            for (const type of ["Office Rent", "Electricity Expenses"]) {
                expect(tdsTypeLock(status, type), `${status} ${type}`)
                    .toEqual({ selectLocked: false, blockedType: null, reason: null });
            }
        }
    });

    it("locks an Office Rent expense's type from Approved on, saying why", () => {
        for (const status of ["Approved", "Reconciliation Pending", "Paid", "Rejected"]) {
            const lock = tdsTypeLock(status, "Office Rent");
            expect(lock.selectLocked, status).toBe(true);
            expect(lock.blockedType).toBeNull();
            expect(lock.reason).toBe(`${status}: the type stays Office Rent, because its 10% TDS is decided at approval.`);
        }
    });

    it("keeps any other approved expense from becoming Office Rent", () => {
        expect(tdsTypeLock("Approved", "Electricity Expenses")).toEqual({
            selectLocked: false,
            blockedType: "Office Rent",
            reason: "Approved: it can't become Office Rent, because its 10% TDS is decided at approval.",
        });
    });
});

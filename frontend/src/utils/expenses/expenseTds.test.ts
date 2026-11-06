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
// One table of split cases, read by this test and the server's (`services/test_expense_tds_rule`), spec #1613.
const SPLIT_CASES: {
    label: string;
    type: string;
    bill: number;
    split: { base: number; gst: number; tds: number; landlord_gets: number } | null;
}[] = JSON.parse(readFileSync(resolve(SERVICES, "office_rent_split_cases.json"), "utf-8")).cases;

describe("parity with services/expense_tds.py", () => {
    const rule = EXPENSE_TDS_PY.match(/^OFFICE_RENT_TDS = ExpenseTdsRule\(([\s\S]*?)^\)/m)?.[1] ?? "";

    it("reads the server's Office Rent rule", () => {
        expect(rule, "OFFICE_RENT_TDS not found in expense_tds.py").not.toBe("");
    });

    it("names the same type, rate, GST rate and section", () => {
        expect(rule).toMatch(new RegExp(`expense_type="${OFFICE_RENT_TDS.expenseType}"`));
        expect(Number(rule.match(/\brate=([\d.]+)/)?.[1])).toBe(OFFICE_RENT_TDS.ratePct);
        expect(Number(rule.match(/gst_rate=([\d.]+)/)?.[1])).toBe(OFFICE_RENT_TDS.gstPct);
        expect(rule).toMatch(/section=TDS_SECTION_RENT/);
        expect(PAYMENT_TDS_PY).toMatch(new RegExp(`^TDS_SECTION_RENT = "${OFFICE_RENT_TDS.section}"`, "m"));
    });

    it("rounds the way the server's split does: banker's rounding, half to the even paisa", () => {
        expect(EXPENSE_TDS_PY).toMatch(/^SPLIT_ROUNDING = "Banker's Rounding"$/m);
    });
});

describe("expenseTdsSplit, on the shared table of cases", () => {
    for (const c of SPLIT_CASES) {
        it(c.label, () => {
            const split = expenseTdsSplit(c.type, c.bill);
            if (c.split === null) {
                expect(split).toEqual({ bill: c.bill, base: c.bill, gstPct: 0, gst: 0, ratePct: 0, tds: 0, landlordGets: c.bill });
                return;
            }
            expect(split).toEqual({
                bill: c.bill,
                base: c.split.base,
                gstPct: 18,
                gst: c.split.gst,
                ratePct: 10,
                tds: c.split.tds,
                landlordGets: c.split.landlord_gets,
            });
        });
    }
});

describe("expenseTdsSplit", () => {
    it("reads the amount as typed", () => {
        expect(expenseTdsSplit("Office Rent", "118000").landlordGets).toBe(108000);
        expect(expenseTdsSplit("Office Rent", "").tds).toBe(0);
    });

    it("keeps the rule in one constant", () => {
        expect(OFFICE_RENT_TDS).toEqual({ expenseType: "Office Rent", ratePct: 10, gstPct: 18, section: "194-I" });
    });
});

describe("tdsPreviewLine", () => {
    it("says the bill, the rent, the GST, the tax and what the landlord gets", () => {
        expect(tdsPreviewLine(expenseTdsSplit("Office Rent", 118000)))
            .toBe("Bill ₹1,18,000 = Rent ₹1,00,000 + GST 18% ₹18,000 − TDS 10% ₹10,000 → Landlord gets ₹1,08,000");
    });

    it("shows paise only when there are some", () => {
        expect(tdsPreviewLine(expenseTdsSplit("Office Rent", 50000)))
            .toBe("Bill ₹50,000 = Rent ₹42,372.88 + GST 18% ₹7,627.12 − TDS 10% ₹4,237.29 → Landlord gets ₹45,762.71");
    });

    it("has no tax line for any other type, or for a zero or a refund", () => {
        expect(tdsPreviewLine(expenseTdsSplit("Electricity Expenses", 118000))).toBeNull();
        expect(tdsPreviewLine(expenseTdsSplit("Office Rent", 0))).toBeNull();
        expect(tdsPreviewLine(expenseTdsSplit("Office Rent", -5000))).toBeNull();
    });
});

// What the approval queue, the approve dialog, the request page and the Expenses list show (#1527, #1613).
describe("shownExpenseTds", () => {
    const withheld: WithheldTds = {
        gross_amount: 100000, gst_amount: 18000, tds_percentage: 10, tds_amount: 10000, tds_section: "194-I",
    };
    const split = { bill: 118000, base: 100000, gstPct: 18, gst: 18000, ratePct: 10, tds: 10000, landlordGets: 108000 };

    it("forecasts on the bill while the Expense waits for approval", () => {
        for (const status of ["Requested", "CEO Pending", "Pending Approval"]) {
            expect(shownExpenseTds({ type: "Office Rent", amount: 118000, status, withheld: null }), status)
                .toEqual({ ...split, withheld: false, section: "194-I" });
        }
    });

    it("shows the stored split once approved, never a forecast on what the landlord gets", () => {
        expect(shownExpenseTds({ type: "Office Rent", amount: 108000, status: "Approved", withheld }))
            .toEqual({ ...split, withheld: true, section: "194-I" });
    });

    it("keeps the stored figures after a bank line corrects the amount by a few rupees", () => {
        expect(shownExpenseTds({ type: "Office Rent", amount: 107998, status: "Paid", withheld }))
            .toEqual({ ...split, withheld: true, section: "194-I" });
    });

    it("shows a rent withheld before GST existed as its rent, no GST and its net", () => {
        const old = { ...withheld, gst_amount: 0 };
        expect(shownExpenseTds({ type: "Office Rent", amount: 90000, status: "Paid", withheld: old })).toEqual({
            bill: 100000, base: 100000, gstPct: 0, gst: 0, ratePct: 10, tds: 10000, landlordGets: 90000,
            withheld: true, section: "194-I",
        });
    });

    it("carries the stored record's own section, not the rule's", () => {
        const record = { ...withheld, tds_section: "194C" };
        const shown = shownExpenseTds({ type: "Office Rent", amount: 108000, status: "Approved", withheld: record })!;
        expect(shown.section).toBe("194C");
        expect(tdsSplitCaption(shown)).toBe("10% TDS (194C) on the rent withheld; the landlord is paid the bill less TDS");
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
    it("read Bill = Rent + GST − TDS → Landlord gets", () => {
        const shown = shownExpenseTds({ type: "Office Rent", amount: 118000, status: "Requested", withheld: null })!;
        expect(tdsSplitLines(shown)).toEqual([
            { label: "Bill", value: "₹1,18,000" },
            { label: "Rent", value: "₹1,00,000" },
            { label: "GST 18%", value: "₹18,000" },
            { label: "TDS 10%", value: "₹10,000" },
            { label: "Landlord gets", value: "₹1,08,000" },
        ]);
    });

    it("leave the GST line out of a rent withheld before GST existed", () => {
        const old = shownExpenseTds({
            type: "Office Rent", amount: 90000, status: "Paid",
            withheld: { gross_amount: 100000, gst_amount: 0, tds_percentage: 10, tds_amount: 10000, tds_section: "194-I" },
        })!;
        expect(tdsSplitLines(old).map((l) => l.label)).toEqual(["Bill", "Rent", "TDS 10%", "Landlord gets"]);
    });

    it("say whether the tax will be or was withheld", () => {
        const forecast = shownExpenseTds({ type: "Office Rent", amount: 118000, status: "Requested", withheld: null })!;
        expect(tdsSplitCaption(forecast)).toBe("10% TDS (194-I) on the rent will be withheld on approval");
        expect(tdsSplitCaption({ ...forecast, withheld: true }))
            .toBe("10% TDS (194-I) on the rent withheld; the landlord is paid the bill less TDS");
    });

    it("warn instead of forecasting when the landlord's name or PAN is missing", () => {
        const forecast = shownExpenseTds({ type: "Office Rent", amount: 118000, status: "Requested", withheld: null })!;
        expect(tdsSplitCaption(forecast, true)).toBe(LANDLORD_MISSING);
        expect(LANDLORD_MISSING).toBe("Landlord's name and PAN are missing — this can't be approved");
        // A withheld record already names its landlord: nothing to warn about.
        expect(tdsSplitCaption({ ...forecast, withheld: true }, true))
            .toBe("10% TDS (194-I) on the rent withheld; the landlord is paid the bill less TDS");
    });
});

// The request page's "Raised for ₹…" line (spec #1522 story 27).
describe("raisedForAmount", () => {
    it("still says the bill asked for once the tax is withheld and the Expense carries what the landlord gets", () => {
        expect(raisedForAmount(108000, 118000)).toBe(118000);
        expect(raisedForAmount(108000, "118000")).toBe(118000);
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

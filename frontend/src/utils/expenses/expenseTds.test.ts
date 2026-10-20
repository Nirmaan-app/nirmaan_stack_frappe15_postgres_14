import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import { expenseTdsSplit, OFFICE_RENT_TDS, tdsPreviewLine } from "./expenseTds";

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

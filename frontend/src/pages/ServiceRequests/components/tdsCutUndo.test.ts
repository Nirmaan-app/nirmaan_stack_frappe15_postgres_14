import { describe, expect, it } from "vitest";
import {
	canMarkAsDeposit, canUndoTdsCut, tdsCutUndoConfirmText, tdsCutUndoHelp, type TdsCutUndoDeduction, type TdsCutUndoPayment,
} from "./tdsCutUndo";

const CUT: TdsCutUndoPayment = { name: "PAY-1", amount: 9800, status: "Approved", cheque: null };
const VENDOR: TdsCutUndoDeduction = { tds_amount: 200, borne_by: "Vendor", requested_amount: 10000 };

describe("canUndoTdsCut", () => {
	it("shows the actions to an Admin on an Approved payment cut by its TDS", () => {
		expect(canUndoTdsCut(CUT, VENDOR, true)).toBe(true);
		expect(canUndoTdsCut({ ...CUT, amount: "9800" }, VENDOR, true)).toBe(true);
	});

	it("hides them from anyone but an Admin", () => {
		expect(canUndoTdsCut(CUT, VENDOR, false)).toBe(false);
	});

	it("hides them once the money is out, and on any other status", () => {
		for (const status of ["Reconciliation Pending", "Paid", "Rejected", "Requested", "CEO Pending"]) {
			expect(canUndoTdsCut({ ...CUT, status }, VENDOR, true)).toBe(false);
		}
	});

	it("hides them on a cheque payment", () => {
		expect(canUndoTdsCut({ ...CUT, cheque: "CHQ-0001" }, VENDOR, true)).toBe(false);
	});

	it("hides them when the request and the amount to pay are the same", () => {
		expect(canUndoTdsCut({ ...CUT, amount: 10000 }, VENDOR, true)).toBe(false);
	});

	it("hides them when the company already bears the TDS, or there is none", () => {
		expect(canUndoTdsCut(CUT, { ...VENDOR, borne_by: "Company" }, true)).toBe(false);
		expect(canUndoTdsCut(CUT, undefined, true)).toBe(false);
		expect(canUndoTdsCut(CUT, { ...VENDOR, requested_amount: undefined }, true)).toBe(false);
	});
});

describe("canMarkAsDeposit", () => {
	const KEPT_WHOLE: TdsCutUndoPayment = { ...CUT, amount: 10000 };
	const COMPANY: TdsCutUndoDeduction = { ...VENDOR, borne_by: "Company" };

	it("shows it wherever Company Bears TDS shows", () => {
		expect(canMarkAsDeposit(CUT, VENDOR, true)).toBe(true);
		expect(canMarkAsDeposit({ ...CUT, status: "Paid" }, VENDOR, true)).toBe(false);
	});

	it("shows it on a TDS the company bears until the payment is Paid, cheque or not", () => {
		for (const status of ["Approved", "Reconciliation Pending"]) {
			expect(canMarkAsDeposit({ ...KEPT_WHOLE, status }, COMPANY, true)).toBe(true);
		}
		expect(canMarkAsDeposit({ ...KEPT_WHOLE, cheque: "CHQ-0001" }, COMPANY, true)).toBe(true);
		expect(canUndoTdsCut(KEPT_WHOLE, COMPANY, true)).toBe(false);
	});

	it("never shows on a Paid payment", () => {
		expect(canMarkAsDeposit({ ...KEPT_WHOLE, status: "Paid" }, COMPANY, true)).toBe(false);
		expect(canMarkAsDeposit({ ...CUT, status: "Paid" }, VENDOR, true)).toBe(false);
	});

	it("hides it from anyone but an Admin, and with no TDS", () => {
		expect(canMarkAsDeposit(KEPT_WHOLE, COMPANY, false)).toBe(false);
		expect(canMarkAsDeposit(KEPT_WHOLE, undefined, true)).toBe(false);
	});

	it("says the amount stays when the company bears the TDS", () => {
		expect(tdsCutUndoHelp("deposit", KEPT_WHOLE, COMPANY).headline).toMatch(/stays .*10,000/);
		expect(tdsCutUndoConfirmText("deposit", KEPT_WHOLE, COMPANY)).toMatch(/200\.00 TDS the company bears is deleted/);
		expect(tdsCutUndoConfirmText("deposit", CUT, VENDOR)).toMatch(/9,800.*back to the full request.*10,000/);
	});
});

describe("tdsCutUndoHelp", () => {
	it("names this payment's figures and what happens to the TDS", () => {
		const company = tdsCutUndoHelp("company", CUT, VENDOR);
		const deposit = tdsCutUndoHelp("deposit", CUT, VENDOR);
		expect(company.headline).toBe(deposit.headline);
		expect(company.headline).toMatch(/10,000.*instead of.*9,800/);
		expect(company.points[0]).toMatch(/200\.00 TDS stays on record/);
		expect(deposit.points[0]).toMatch(/200\.00 TDS record is deleted/);
	});
});

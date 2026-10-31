import { describe, expect, it } from "vitest";

import {
	canPayCreditByCheque,
	creditChequeDateProblem,
	creditDueChip,
	isEarlyCreditCheque,
	startingPaymentMode,
} from "./creditCheque";

const DUE = "2026-11-15";

describe("isEarlyCreditCheque", () => {
	it("is true for a credit term before its due date", () => {
		expect(isEarlyCreditCheque({ payment_type: "Credit", due_date: DUE }, "2026-10-31")).toBe(true);
	});

	it("is false on and after the due date", () => {
		expect(isEarlyCreditCheque({ payment_type: "Credit", due_date: DUE }, DUE)).toBe(false);
		expect(isEarlyCreditCheque({ payment_type: "Credit", due_date: DUE }, "2026-11-20")).toBe(false);
	});

	it("reads a due date stored with a time", () => {
		expect(isEarlyCreditCheque({ payment_type: "Credit", due_date: `${DUE} 00:00:00` }, "2026-11-14")).toBe(true);
	});

	it("is false for other terms and for a credit term with no due date", () => {
		expect(isEarlyCreditCheque({ payment_type: "Delivery against payment", due_date: DUE }, "2026-10-31")).toBe(false);
		expect(isEarlyCreditCheque({ payment_type: "Credit", due_date: "" }, "2026-10-31")).toBe(false);
		expect(isEarlyCreditCheque(null, "2026-10-31")).toBe(false);
	});
});

describe("startingPaymentMode", () => {
	it("starts an early credit request in Cheque mode, any other in Online", () => {
		expect(startingPaymentMode(true).mode).toBe("Cheque");
		expect(startingPaymentMode(false).mode).toBe("Online");
	});
});

describe("creditChequeDateProblem", () => {
	it("refuses a cheque dated before the due date, naming both days", () => {
		expect(creditChequeDateProblem("2026-11-10", DUE)).toBe(
			"The cheque is dated 10-Nov-2026, before this credit term's due date of 15-Nov-2026. " +
				"A credit cheque must be dated on or after the due date."
		);
	});

	it("takes a cheque dated on or after the due date", () => {
		expect(creditChequeDateProblem(DUE, DUE)).toBeNull();
		expect(creditChequeDateProblem("2026-11-16", DUE)).toBeNull();
	});

	it("says nothing until a date is filled in", () => {
		expect(creditChequeDateProblem("", DUE)).toBeNull();
	});
});

describe("creditDueChip", () => {
	it("counts the days left, green beyond a week", () => {
		expect(creditDueChip("2026-11-26", "2026-10-31", false)).toEqual({ text: "Due 26-Nov-2026 · 26 days", tone: "later" });
	});

	it("turns amber within 7 days, and on the day itself", () => {
		expect(creditDueChip("2026-11-07", "2026-10-31", false)).toEqual({ text: "Due 07-Nov-2026 · 7 days", tone: "soon" });
		expect(creditDueChip("2026-11-01", "2026-10-31", false)).toEqual({ text: "Due 01-Nov-2026 · 1 day", tone: "soon" });
		expect(creditDueChip("2026-10-31", "2026-10-31", false)).toEqual({ text: "Due 31-Oct-2026 · today", tone: "soon" });
	});

	it("turns red once past, counting the days overdue", () => {
		expect(creditDueChip("2026-10-28", "2026-10-31", false)).toEqual({ text: "Due 28-Oct-2026 · 3 days overdue", tone: "overdue" });
	});

	it("shows a Paid term's date alone, in grey", () => {
		expect(creditDueChip("2026-10-28", "2026-10-31", true)).toEqual({ text: "Due 28-Oct-2026", tone: "paid" });
	});

	it("reads a due date stored with a time, and nothing without one", () => {
		expect(creditDueChip("2026-11-26 00:00:00", "2026-10-31", false)?.text).toBe("Due 26-Nov-2026 · 26 days");
		expect(creditDueChip("", "2026-10-31", false)).toBeNull();
	});
});

describe("canPayCreditByCheque", () => {
	it("is Admin, PMO and every Procurement profile", () => {
		for (const role of [
			"Nirmaan Admin Profile",
			"Nirmaan PMO Executive Profile",
			"Nirmaan Procurement Executive Profile",
			"Nirmaan Procurement Lead Profile",
			"Nirmaan Service Procurement Executive Profile",
		]) {
			expect(canPayCreditByCheque(role)).toBe(true);
		}
	});

	it("is nobody else: not Accounts, Project Lead or a role still loading", () => {
		for (const role of ["Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile", "Nirmaan Project Lead Profile", "Loading", "", null]) {
			expect(canPayCreditByCheque(role)).toBe(false);
		}
	});
});

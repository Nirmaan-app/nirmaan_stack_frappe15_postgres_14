import { describe, expect, it } from "vitest";

import { amountPaidParts, withholdsOnApproval } from "./tdsForecast";

describe("withholdsOnApproval", () => {
	it("the CEO's click always withholds", () => {
		expect(withholdsOnApproval("ceo", 60000)).toBe(true);
		expect(withholdsOnApproval("ceo", 20000)).toBe(true);
	});

	it("an L1 click withholds when it finishes the approval (15,000-50,000)", () => {
		expect(withholdsOnApproval("lead", 15000)).toBe(true);
		expect(withholdsOnApproval("lead", 38550)).toBe(true);
		expect(withholdsOnApproval("lead", 50000)).toBe(true);
	});

	it("an L1 click above 50,000 only forwards to the CEO and withholds nothing yet", () => {
		expect(withholdsOnApproval("lead", 50000.01)).toBe(false);
		expect(withholdsOnApproval("lead", 60000)).toBe(false);
	});
});

describe("the Work Order page's Amount Paid hover (stored amount_paid + server answer `get_work_order_tds`, #1509)", () => {
	it("splits a vendor-borne Amount Paid into what reached the vendor and the tax withheld for them", () => {
		// Rs 10,000 gross, Rs 200 withheld: Amount Paid is Rs 10,000, Rs 9,800 reached the vendor.
		expect(amountPaidParts(10000, { withheld: 200, company: 0, kind: "withheld", payments: {} })).toEqual({
			paidToVendor: 9800,
			tdsWithheld: 200,
			total: 10000,
			companyOnTop: 0,
		});
	});

	it("shows the company's tax on its own line, outside the total", () => {
		// Rs 800 paid whole, Rs 16 paid by the company on top.
		expect(amountPaidParts(800, { withheld: 0, company: 16, kind: "company", payments: {} })).toEqual({
			paidToVendor: 800,
			tdsWithheld: 0,
			total: 800,
			companyOnTop: 16,
		});
		// SR-00107-001055: 5,880 + 120 withheld, 14,120 kept whole with 282.40 on top.
		expect(amountPaidParts(20120, { withheld: 120, company: 282.4, kind: "part", payments: {} })).toEqual({
			paidToVendor: 20000,
			tdsWithheld: 120,
			total: 20120,
			companyOnTop: 282.4,
		});
	});

	it("rounds to the paisa, as the server stores money", () => {
		expect(amountPaidParts(1000.3, { withheld: 0.1, company: 0, kind: "withheld", payments: {} })?.paidToVendor).toBe(1000.2);
	});

	it("claims no split until the server has answered", () => {
		expect(amountPaidParts(10000, undefined)).toBeUndefined();
	});
});

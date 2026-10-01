import { describe, expect, it } from "vitest";

import { isGstPayment } from "./paymentKind";

describe("isGstPayment", () => {
	it("reads the payment kind as Frappe sends it", () => {
		expect(isGstPayment({ is_gst_payment: 1 })).toBe(true);
		expect(isGstPayment({ is_gst_payment: "1" })).toBe(true);
		expect(isGstPayment({ is_gst_payment: true })).toBe(true);
		expect(isGstPayment({ is_gst_payment: 0 })).toBe(false);
		expect(isGstPayment({})).toBe(false);
		expect(isGstPayment(null)).toBe(false);
		expect(isGstPayment(undefined)).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	canDecideGstRequest, canDeleteGstRequest, gstDecisionFigures, gstRequestColumnsFor, gstRequestHasActions, lookupCell,
	mergeLookup,
} from "./gstPaymentRequests";

describe("GST Requests columns by status pill", () => {
	it("shows Actions only where a row can have a button", () => {
		expect(gstRequestColumnsFor("Pending").actions).toBe(true); // approve, reject, delete
		expect(gstRequestColumnsFor("Rejected").actions).toBe(true); // delete
		expect(gstRequestColumnsFor("Approved").actions).toBe(false);
		expect(gstRequestColumnsFor("Paid").actions).toBe(false);
		expect(gstRequestColumnsFor("All").actions).toBe(true); // mixes Pending and Rejected rows in
	});

	it("shows Reviewed wherever a row can have been decided", () => {
		expect(gstRequestColumnsFor("Pending").reviewed).toBe(false); // nobody has decided yet
		expect(gstRequestColumnsFor("Approved").reviewed).toBe(true);
		expect(gstRequestColumnsFor("Paid").reviewed).toBe(true);
		expect(gstRequestColumnsFor("Rejected").reviewed).toBe(true);
		expect(gstRequestColumnsFor("All").reviewed).toBe(true);
	});

	it("agrees with the delete rule: a status with no actions can never be deleted", () => {
		for (const status of ["Pending", "Approved", "Rejected", "Paid"] as const) {
			if (!gstRequestHasActions(status)) expect(canDeleteGstRequest("Nirmaan Admin Profile", "a@x", status)).toBe(false);
		}
	});
});

describe("who decides a GST request", () => {
	it("is the Admin, the accountants and the Administrator user", () => {
		expect(canDecideGstRequest("Nirmaan Admin Profile", "a@x")).toBe(true);
		expect(canDecideGstRequest("Nirmaan Accountant Profile", "a@x")).toBe(true);
		expect(canDecideGstRequest("Nirmaan Accountant Lead Profile", "a@x")).toBe(true);
		expect(canDecideGstRequest("", "Administrator")).toBe(true);
	});

	it("is nobody else", () => {
		for (const role of ["Nirmaan Project Manager Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"]) {
			expect(canDecideGstRequest(role, "a@x")).toBe(false);
		}
	});

	it("matches the server's deciders, PAYMENT_SETTLE_PROFILES", () => {
		const py = readFileSync(resolve(__dirname, "../../../nirmaan_stack/services/role_profiles.py"), "utf8");
		expect(py).toMatch(/PAYMENT_SETTLE_PROFILES = \(ADMIN_PROFILE, DEVELOPER_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE\)/);
	});
});

describe("the approve dialog's figures", () => {
	// GST 18,000 on the Work Order, 12,000 of it on approved invoices, 4,000 paid, and this 6,000 waiting.
	const limit = { work_order_gst: 18000, gst_released: 12000, gst_paid: 4000, gst_requested: 6000 };

	it("leaves what the invoices allow, less what is paid and this request", () => {
		expect(gstDecisionFigures(limit, 6000, true)).toEqual({
			workOrderGst: 18000, invoiced: 12000, paid: 4000, otherWaiting: 0, thisAmount: 6000, leftAfter: 2000, fits: true,
		});
	});

	it("counts the other waiting requests, never this one twice", () => {
		const f = gstDecisionFigures({ ...limit, gst_requested: 8000 }, 6000, true);
		expect([f.otherWaiting, f.leftAfter, f.fits]).toEqual([2000, 0, true]);
	});

	it("does not fit once an invoice is rejected under it", () => {
		const f = gstDecisionFigures({ ...limit, gst_released: 5000 }, 6000, true);
		expect([f.leftAfter, f.fits]).toEqual([-5000, false]);
	});

	it("allows the server's ₹10 rounding", () => {
		expect(gstDecisionFigures({ ...limit, gst_released: 9990 }, 6000, true).fits).toBe(true);
		expect(gstDecisionFigures({ ...limit, gst_released: 9989 }, 6000, true).fits).toBe(false);
	});
});

describe("who deletes a GST request", () => {
	it("is a decider, while it is Pending or Rejected", () => {
		expect(canDeleteGstRequest("Nirmaan Accountant Profile", "a@x", "Pending")).toBe(true);
		expect(canDeleteGstRequest("Nirmaan Admin Profile", "a@x", "Rejected")).toBe(true);
	});

	it("is nobody once it is Approved or Paid: it goes only with its payment", () => {
		expect(canDeleteGstRequest("Nirmaan Accountant Profile", "a@x", "Approved")).toBe(false);
		expect(canDeleteGstRequest("", "Administrator", "Paid")).toBe(false);
	});

	it("is never the requester who is not a decider", () => {
		expect(canDeleteGstRequest("Nirmaan Project Manager Profile", "a@x", "Pending")).toBe(false);
	});
});

describe("GST Requests lookups (names, never a flash of ids)", () => {
	const project = (name: string, project_name: string) => ({ name, project_name });

	it("keeps every record read before when a new read arrives", () => {
		const known = mergeLookup({}, [project("P-1", "Clutterbot")]);
		const next = mergeLookup(known, [project("P-2", "Qburst")]);
		expect(next["P-1"].project_name).toBe("Clutterbot");
		expect(next["P-2"].project_name).toBe("Qburst");
	});

	it("lets the newer read win for the same id", () => {
		const next = mergeLookup({ "P-1": project("P-1", "Old name") }, [project("P-1", "New name")]);
		expect(next["P-1"].project_name).toBe("New name");
	});

	it("treats a read with no rows as adding nothing", () => {
		const known = { "P-1": project("P-1", "Clutterbot") };
		expect(mergeLookup(known, undefined)).toEqual(known);
		expect(mergeLookup(known, [])).toEqual(known);
	});

	it("shows the name once it is read, even while another read is going", () => {
		expect(lookupCell("P-1", "Clutterbot", true)).toEqual({ kind: "text", text: "Clutterbot" });
	});

	it("shows a placeholder, never the raw id, while the record is still being read", () => {
		expect(lookupCell("BENGALURU-PROJ-00058", undefined, true)).toEqual({ kind: "loading" });
	});

	it("shows the id only once reading has finished and there is no record", () => {
		expect(lookupCell("VEN-Service-0121", undefined, false)).toEqual({ kind: "text", text: "VEN-Service-0121" });
	});
});

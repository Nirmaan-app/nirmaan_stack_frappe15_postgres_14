import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	invoiceAttachmentUrl,
	isPorterExpense,
	PORTER_INVOICE_PDF_METHOD,
	porterSectionRows,
	projectField,
	RECTIFY_HINT,
} from "./porterExpense";

describe("isPorterExpense (the Porter badge)", () => {
	it("is a Porter Expense when it links to a Porter Order", () => {
		expect(isPorterExpense({ porter_order: "CRN1234567890" })).toBe(true);
	});

	it("is not one when the link is blank or the list never fetched it", () => {
		expect(isPorterExpense({ porter_order: "" })).toBe(false);
		expect(isPorterExpense({ porter_order: null })).toBe(false);
		expect(isPorterExpense({})).toBe(false);
		expect(isPorterExpense(null)).toBe(false);
		expect(isPorterExpense(undefined)).toBe(false);
	});
});

describe("projectField (the edit dialog's project lock)", () => {
	it("locks the project of a Porter Expense and points to Rectify", () => {
		expect(projectField({ porter_order: "CRN1234567890" })).toEqual({
			locked: true,
			hint: "Use Rectify in Bulk Import",
		});
		expect(RECTIFY_HINT).toBe("Use Rectify in Bulk Import");
	});

	it("leaves any other expense as it was: no project row", () => {
		expect(projectField({ porter_order: "" })).toEqual({ locked: false });
		expect(projectField({})).toEqual({ locked: false });
	});
});

describe("porterSectionRows (the read-only Porter section)", () => {
	const section = {
		crn: "CRN1234567890",
		booked_by: "Kavya Menon",
		from_address: "Demo Hardware, KR Market",
		to_address: "Zephyr Tower site, Whitefield",
		city: "Bangalore",
		fare: 1616,
		rcm_gst: 80.8,
		invoice_number: "29SS27A0900001",
		billing_entity: "Demo Builders Pvt Ltd",
		pdf_url: "/api/method/x?doctype=Project%20Expenses&name=PE-1",
		project: "PROJ-1",
		project_name: "Zephyr Tower",
	};

	it("shows the order's facts in the order the spec names them", () => {
		expect(porterSectionRows(section)).toEqual([
			{ label: "CRN", value: "CRN1234567890" },
			{ label: "Booked by", value: "Kavya Menon" },
			{ label: "From → To", value: "Demo Hardware, KR Market → Zephyr Tower site, Whitefield" },
			{ label: "City", value: "Bangalore" },
			{ label: "Fare", value: "₹1,616.00" },
			{ label: "Reverse-charge GST", value: "₹80.80" },
			{ label: "Billing entity", value: "Demo Builders Pvt Ltd" },
		]);
	});

	it("shows a blank fact as a dash and a zero GST as ₹0.00, never as missing", () => {
		const rows = porterSectionRows({ ...section, booked_by: "", to_address: "", rcm_gst: 0, billing_entity: "" });
		expect(rows).toContainEqual({ label: "Booked by", value: "--" });
		expect(rows).toContainEqual({ label: "From → To", value: "Demo Hardware, KR Market → --" });
		expect(rows).toContainEqual({ label: "Reverse-charge GST", value: "₹0.00" });
		expect(rows).toContainEqual({ label: "Billing entity", value: "--" });
	});
});

describe("invoiceAttachmentUrl (the list pages' invoice link)", () => {
	it("serves a Porter Expense's shared invoice PDF through the expense, which its readers may read", () => {
		const url = invoiceAttachmentUrl("Project Expenses", {
			name: "PE-0012",
			porter_order: "CRN1",
			invoice_attachment: "/private/files/29SS27A0900001.pdf",
		});
		expect(url).toBe(
			"/api/method/nirmaan_stack.api.outflow_import.porter_expense.porter_invoice_pdf?doctype=Project+Expenses&name=PE-0012"
		);
	});

	it("links any other expense's attachment as it is", () => {
		expect(
			invoiceAttachmentUrl("Non Project Expenses", { name: "NPE-1", invoice_attachment: "/files/bill.pdf" })
		).toBe("/files/bill.pdf");
	});

	it("names the same endpoint the server's Porter section links (porter_expense.PDF_METHOD, F1)", () => {
		const server = readFileSync(
			fileURLToPath(new URL("../../../nirmaan_stack/api/outflow_import/porter_expense.py", import.meta.url)),
			"utf-8"
		);
		expect(server.match(/^PDF_METHOD = "([^"]+)"/m)?.[1]).toBe(PORTER_INVOICE_PDF_METHOD);
		// The same rule as `porter_expense.pdf_url`: a Porter Expense WITH an invoice attachment.
		expect(server).toContain("if not (expense.porter_order and expense.invoice_attachment):");
	});

	it("is null when there is no attachment, Porter or not", () => {
		expect(invoiceAttachmentUrl("Project Expenses", { name: "PE-1", porter_order: "CRN1" })).toBeNull();
		expect(invoiceAttachmentUrl("Project Expenses", { name: "PE-1", invoice_attachment: "" })).toBeNull();
	});
});

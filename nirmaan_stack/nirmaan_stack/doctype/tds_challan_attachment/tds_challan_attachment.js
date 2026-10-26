// Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
// For license information, please see license.txt

frappe.ui.form.on("TDS Challan Attachment", {
	setup(frm) {
		// Offer only what the server accepts (#1544): a TDS Payment expense that isn't Rejected.
		// One already on another challan is still listed; the save refuses it, naming that challan.
		frm.set_query("tds_payment_expense", () => ({
			filters: { type: "TDS Payment", status: ["!=", "Rejected"] },
		}));
	},
});

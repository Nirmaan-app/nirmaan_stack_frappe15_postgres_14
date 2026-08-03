// Copyright (c) 2026, Nirmaan and contributors
// For license information, please see license.txt

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Months each span-based schedule covers (auto-fills the end month from the start month).
const SPAN = { Quarterly: 3, "Half-Yearly": 6 };

function fill_end_month(frm, cdt, cdn) {
	const span = SPAN[frm.doc.schedule_type];
	if (!span) return; // Custom Dates -> user sets both months
	const row = locals[cdt][cdn];
	if (!row.from_month) return;
	const start = MONTHS.indexOf(row.from_month);
	if (start < 0) return;
	const end = (start + span - 1) % 12;
	frappe.model.set_value(cdt, cdn, "to_month", MONTHS[end]);
}

frappe.ui.form.on("Reminder Schedule", {
	schedule_type(frm) {
		// re-derive end months for every row when the span changes
		(frm.doc.due_dates || []).forEach((row) => fill_end_month(frm, row.doctype, row.name));
		frm.refresh_field("due_dates");
	},
});

frappe.ui.form.on("Reminder Due Date", {
	from_month(frm, cdt, cdn) {
		fill_end_month(frm, cdt, cdn);
	},
});

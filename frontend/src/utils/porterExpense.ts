// A Porter Expense in the expense screens (#1450, spec #1442, ADR-0032): the badge, the project lock and
// the read-only Porter section, decided here so they are testable without React (ADR-0010 F4).
//
// A Porter Expense is one the Porter Statement import created: it carries a `porter_order` link, and
// nothing else marks it. Its project is changed by Rectify in Bulk Import, never by the edit dialog,
// because the import's match record has to follow the move.

import formatToIndianRupee, { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";

/**
 * Rectify's name on screen (#1558): the Bulk Import line's button, and the locked-project hint on an expense.
 * The domain term stays Rectify (GLOSSARY.md).
 */
export const MOVE_ORDER_LABEL = "Move to another project";

/** The Bulk Import URL parameter naming the Outflow Import Row whose move dialog opens on arrival. */
export const MOVE_URL_KEY = "move";

/** What `api/outflow_import/porter_expense.get_porter_expense` returns for a Porter Expense. */
export interface PorterExpenseSection {
	crn: string;
	booked_by: string;
	from_address: string;
	to_address: string;
	city: string;
	fare: number;
	rcm_gst: number;
	invoice_number: string;
	billing_entity: string;
	/** Serves the invoice PDF to anyone who may read the expense; blank when none is stored. */
	pdf_url: string;
	project: string | null;
	project_name: string | null;
	/** The import and the line the order came from; null when the Porter Order has no line. */
	import_batch: string | null;
	import_row: string | null;
}

/** Whether the expense came from a Porter Statement import (the badge, and every lock below). */
export const isPorterExpense = (expense: { porter_order?: string | null } | null | undefined): boolean =>
	!!expense?.porter_order;

/** The edit dialog's project field: locked on a Porter Expense; any other expense shows no project row. */
export const projectField = (
	expense: { porter_order?: string | null } | null | undefined
): { locked: false } | { locked: true; hint: string } =>
	isPorterExpense(expense) ? { locked: true, hint: MOVE_ORDER_LABEL } : { locked: false };

/**
 * Where the hint links: Bulk Import on the order's import, the Settled tab searched to its CRN, with the move
 * dialog open on its line (`OutflowMasterPage` reads `MOVE_URL_KEY` and the router state). Null, so the hint
 * stays plain text, while the line is not known.
 */
export const moveOrderLink = (
	section: Pick<PorterExpenseSection, "crn" | "import_batch" | "import_row"> | null
): { to: string; state: { outflowTab: "matchedOutflow"; outflowSearch: string } } | null => {
	if (!section?.import_batch || !section.import_row) return null;
	return {
		to: `/bulk-import-transactions/${encodeURIComponent(section.import_batch)}?${MOVE_URL_KEY}=${encodeURIComponent(section.import_row)}`,
		state: { outflowTab: "matchedOutflow", outflowSearch: section.crn },
	};
};

/** Serves a Porter Expense's invoice PDF (`api/outflow_import/porter_expense.porter_invoice_pdf`). */
export const PORTER_INVOICE_PDF_METHOD = "nirmaan_stack.api.outflow_import.porter_expense.porter_invoice_pdf";

/**
 * Where an expense's invoice attachment opens, relative to the site, or null when it has none.
 *
 * ⚠️ A PORTER EXPENSE'S PDF IS THE PORTER INVOICE'S PRIVATE FILE, shared by every expense of the invoice,
 * and only Admin and the Accountants may read a Porter Invoice: linked as it is, anyone else who may read
 * the expense gets a 403 (spec #1442 story 53). It opens through the expense instead, which checks the
 * expense's own read permission.
 *
 * ⚠️ THE SAME RULE AND URL AS THE SERVER'S `porter_expense.pdf_url` (the Porter section's link), pinned by
 * `porterExpense.test.ts` against that file and by the same literal URL in `test_porter_expense` (F1).
 */
export const invoiceAttachmentUrl = (
	doctype: string,
	expense: { name: string; porter_order?: string | null; invoice_attachment?: string | null }
): string | null => {
	if (!expense.invoice_attachment) return null;
	if (!isPorterExpense(expense)) return expense.invoice_attachment;
	return `/api/method/${PORTER_INVOICE_PDF_METHOD}?${new URLSearchParams({ doctype, name: expense.name })}`;
};

const orDash = (value: string | null | undefined) => (value || "").trim() || "--";

/** The Porter section's facts, in the order the spec names them. The invoice row (a link) is the caller's. */
export const porterSectionRows = (section: PorterExpenseSection): { label: string; value: string }[] => [
	{ label: "CRN", value: orDash(section.crn) },
	{ label: "Booked by", value: orDash(section.booked_by) },
	{ label: "From → To", value: `${orDash(section.from_address)} → ${orDash(section.to_address)}` },
	{ label: "City", value: orDash(section.city) },
	{ label: "Fare", value: formatToIndianRupee(section.fare) },
	{ label: "Reverse-charge GST", value: formatToIndianRupeeOrZero(section.rcm_gst) },
	{ label: "Billing entity", value: orDash(section.billing_entity) },
];

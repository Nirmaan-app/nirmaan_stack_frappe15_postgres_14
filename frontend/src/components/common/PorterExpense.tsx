/**
 * A Porter Expense in the expense screens (#1450, spec #1442, ADR-0032): the Porter badge and the
 * read-only Porter section. The decisions are in `utils/porterExpense.ts`.
 *
 * ⚠️ THE SECTION FETCHES ONLY FOR A PORTER EXPENSE. Callers render it (or enable the hook) only when the
 * row carries `porter_order`, so every other expense opens exactly as before, with no extra request.
 * The read is keyed on the EXPENSE (`porter_expense.get_porter_expense`), so a role that cannot read
 * Porter Orders or Porter Invoices still sees the section and opens the invoice PDF.
 */
import React from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Paperclip } from "lucide-react";
import { Link } from "react-router-dom";

import SITEURL from "@/constants/siteURL";
import {
	isPorterExpense,
	moveOrderLink,
	porterSectionRows,
	type PorterExpenseSection,
} from "@/utils/porterExpense";

const PORTER_EXPENSE_METHOD = "nirmaan_stack.api.outflow_import.porter_expense.get_porter_expense";

/** The "Porter" tag on a list row the Porter Statement import created. Renders nothing on any other. */
export const PorterBadge = ({ expense }: { expense: { porter_order?: string | null } | null | undefined }) =>
	isPorterExpense(expense) ? (
		<span
			className="mr-1 inline-block shrink-0 whitespace-nowrap rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200"
			title={`Porter delivery ${expense?.porter_order} — created by the Porter Statement import`}
		>
			Porter
		</span>
	) : null;

/**
 * The locked project's hint, "Move to another project" (#1558): a link to the order's line in Bulk Import with
 * the move dialog open, or plain text while the line is not known. `onFollow` closes the edit dialog, whose
 * open flag lives in a global store and would otherwise reopen it on the way back.
 */
export const MoveOrderHint: React.FC<{
	hint: string;
	section: PorterExpenseSection | null;
	onFollow: () => void;
	className?: string;
}> = ({ hint, section, onFollow, className }) => {
	const link = moveOrderLink(section);
	if (!link) return <p className={className}>{hint}</p>;
	return (
		<p className={className}>
			<Link to={link.to} state={link.state} onClick={onFollow} className="text-primary underline underline-offset-2">
				{hint}
			</Link>
		</p>
	);
};

/** The Porter section's data. `enabled` false fetches nothing (SWR key null). */
export const usePorterExpense = (doctype: string, name: string | undefined, enabled: boolean) => {
	const { data, error, isLoading } = useFrappeGetCall<{ message: PorterExpenseSection | null }>(
		PORTER_EXPENSE_METHOD,
		{ doctype, name },
		enabled && name ? `porter_expense_${doctype}_${name}` : null
	);
	return { section: data?.message ?? null, error, isLoading };
};

/** The read-only block itself, for a caller that already holds the data. */
export const PorterSectionBlock: React.FC<{
	section: PorterExpenseSection | null;
	isLoading?: boolean;
	error?: unknown;
}> = ({ section, isLoading, error }) => (
	<div className="rounded-md border border-orange-200 bg-orange-50/40 px-3 py-2 text-sm dark:border-orange-900 dark:bg-orange-950/20">
		<p className="pb-1 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300">
			Porter
		</p>
		{isLoading && <p className="text-xs text-muted-foreground">Loading the Porter order…</p>}
		{!isLoading && (error || !section) && (
			<p className="text-xs text-destructive">Could not read this expense's Porter order.</p>
		)}
		{!isLoading && !error && section && (
			<dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1">
				{porterSectionRows(section).map((row) => (
					<React.Fragment key={row.label}>
						<dt className="text-muted-foreground">{row.label}</dt>
						<dd className="min-w-0 break-words">{row.value}</dd>
					</React.Fragment>
				))}
				<dt className="text-muted-foreground">Invoice</dt>
				<dd className="flex min-w-0 flex-wrap items-center gap-x-2">
					<span>{section.invoice_number || "--"}</span>
					{section.pdf_url && (
						<a
							href={SITEURL + section.pdf_url}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 text-primary hover:underline"
						>
							<Paperclip className="h-3.5 w-3.5" /> View PDF
						</a>
					)}
				</dd>
			</dl>
		)}
	</div>
);

/** The block, fetching its own data: for a detail card that knows only the expense's name. */
export const PorterSection: React.FC<{ doctype: string; name: string }> = ({ doctype, name }) => {
	const { section, error, isLoading } = usePorterExpense(doctype, name, true);
	return <PorterSectionBlock section={section} isLoading={isLoading} error={error} />;
};

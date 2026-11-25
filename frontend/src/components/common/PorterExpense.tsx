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

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SITEURL from "@/constants/siteURL";
import { useUserData } from "@/hooks/useUserData";
import { moveLabel } from "@/pages/outflow-import/cashbookRectify";
import { canUndoOutflow } from "@/pages/outflow-import/outflowImportStatus";
import {
	isPorterExpense,
	moveOrderLink,
	porterSectionRows,
	type PorterExpenseSection,
} from "@/utils/porterExpense";

const PORTER_EXPENSE_METHOD = "nirmaan_stack.api.outflow_import.porter_expense.get_porter_expense";
const MOVE_LINE_METHOD = "nirmaan_stack.api.outflow_import.rectify.get_move_line";

/** Where an expense's Move link leads: its import and line, and what Bulk Import searches it by. */
type MoveLine = Pick<PorterExpenseSection, "crn" | "import_batch" | "import_row">;

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
 * The locked project's hint, Move's words (#1558; by the expense's ledger, #1759): a link to the order's line in Bulk Import with
 * the move dialog open, or plain text while the line is not known. `onFollow` closes the edit dialog, whose
 * open flag lives in a global store and would otherwise reopen it on the way back.
 */
export const MoveOrderHint: React.FC<{
	hint: string;
	section: MoveLine | null;
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

/**
 * An edit dialog's locked Project row on a Porter Expense (#1558) or a Cashbook expense (#1757): the project it is
 * on, read-only, and under it the Move link (`hint`, from `projectField`). Shared by the Project and Non-Project
 * Expense edit dialogs.
 */
export const PorterProjectLock: React.FC<{
	id: string;
	value: string;
	section: MoveLine | null;
	onFollow: () => void;
	hint: string;
	/** Show the Move link only to those who may Move (`canUndoOutflow`): a Cashbook expense's (#1757). */
	undoOnly?: boolean;
}> = ({ id, value, section, onFollow, hint, undoOnly = false }) => {
	const { role, user_id } = useUserData();
	const showHint = !undoOnly || canUndoOutflow(role, user_id);
	return (
		<div className="grid grid-cols-4 items-center gap-4">
			<Label htmlFor={id} className="text-right">Project</Label>
			<div className="col-span-3">
				<Input id={id} value={value} disabled readOnly />
				{showHint && (
					<MoveOrderHint hint={hint} section={section} onFollow={onFollow} className="mt-1 text-xs text-muted-foreground" />
				)}
			</div>
		</div>
	);
};

/**
 * A Cashbook expense's import line, for its Move link (#1757): `rectify.get_move_line`, searched in Bulk Import by
 * its Txn Id. `enabled` false fetches nothing (SWR key null).
 */
export const useCashbookMoveLine = (doctype: string, name: string | undefined, enabled: boolean): MoveLine | null => {
	const { data } = useFrappeGetCall<{
		message: { import_batch: string; import_row: string; transfer_id: string } | null;
	}>(MOVE_LINE_METHOD, { doctype, name }, enabled && name ? `cashbook_move_line_${doctype}_${name}` : null);
	const line = data?.message;
	return line ? { crn: line.transfer_id, import_batch: line.import_batch, import_row: line.import_row } : null;
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

/**
 * The read-only block itself, for a caller that already holds the data. `moveHint` adds the Move link (story
 * 54), in those words, for a viewer who may Rectify; the edit dialogs leave it off, since their Project row carries it.
 */
export const PorterSectionBlock: React.FC<{
	section: PorterExpenseSection | null;
	isLoading?: boolean;
	error?: unknown;
	moveHint?: string;
}> = ({ section, isLoading, error, moveHint }) => (
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
		{moveHint && moveOrderLink(section) && (
			<MoveOrderHint hint={moveHint} section={section} onFollow={() => {}} className="pt-1 text-xs" />
		)}
	</div>
);

/**
 * The block, fetching its own data: for a detail card that knows only the expense's name. A viewer who may
 * Rectify (Admin, Accountant Lead: `canUndoOutflow`) also gets the Move link -- the way an Accountant Lead
 * reaches it, since a Paid expense's edit dialog stays Admin-only. `offerMove` false leaves it off where the
 * reader is already on Bulk Import, whose line carries Move (the link would land on the same page).
 */
export const PorterSection: React.FC<{ doctype: string; name: string; offerMove?: boolean }> = ({
	doctype,
	name,
	offerMove = true,
}) => {
	const { section, error, isLoading } = usePorterExpense(doctype, name, true);
	const { role, user_id } = useUserData();
	return (
		<PorterSectionBlock
			section={section}
			isLoading={isLoading}
			error={error}
			moveHint={offerMove && canUndoOutflow(role, user_id) ? moveLabel([doctype]) : undefined}
		/>
	);
};

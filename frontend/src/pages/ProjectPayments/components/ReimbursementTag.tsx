/**
 * The "Reimbursement" tag a payment list shows on a Non-Project Expense created from an approved
 * reimbursement claim (ADR-0040), beside its "Non Project Expense" type, the way a GST payment
 * carries its "GST" tag. Renders nothing on any other row.
 */
export const ReimbursementTag = ({ row }: { row: { source_type?: unknown } | null | undefined }) =>
	row?.source_type === "Reimbursement" ? (
		<span
			className="ml-1 inline-block whitespace-nowrap rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"
			title="Reimbursement — pays an approved claim back to the person who raised it"
		>
			Reimbursement
		</span>
	) : null;

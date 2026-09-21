import { Badge } from "@/components/ui/badge";

/**
 * "Reconciliation Pending" -- money has left (or, for a cheque, the cheque is written) and the bank
 * statement has not confirmed it yet. Light yellow and filled, so it reads apart from Approved's amber
 * outline beside it; on two lines, so the long label does not widen the column.
 */
export const ReconciliationPendingBadge = () => (
	<Badge
		variant="outline"
		className="flex-col border-yellow-300 bg-yellow-50 py-0.5 text-center leading-tight text-yellow-800"
	>
		<span>Reconciliation</span>
		<span>Pending</span>
	</Badge>
);

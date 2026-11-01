import { Landmark } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Pay by Cheque on a Credit term not yet due (owner, 2026-10-31): the PO page's payment terms and Credit
 * Payments' All Credits show the same button. Who sees it is `creditCheque.canPayCreditByCheque`.
 */
export const PayByChequeButton = ({ onClick }: { onClick: () => void }) => (
	<Button
		size="sm"
		variant="outline"
		className="h-7 px-2 text-xs border-amber-500 text-amber-700 hover:bg-amber-50"
		onClick={onClick}
	>
		<Landmark className="mr-1 h-3.5 w-3.5" />
		Pay by Cheque
	</Button>
);

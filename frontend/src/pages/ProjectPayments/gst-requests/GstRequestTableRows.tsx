import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { GSTPaymentRequestRow } from "@/types/NirmaanStack/GSTPaymentRequest";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { GST_REQUEST_CHIP } from "@/utils/gstPaymentRequests";

import { GstRequestDeleteButton } from "./GstRequestDeleteButton";

/** The requests a payments table shows: those with no payment, waiting or rejected. Once approved, the payment's own row takes over. */
export const requestsWithoutPayment = (rows: GSTPaymentRequestRow[]) =>
	rows.filter((r) => r.status === "Pending" || r.status === "Rejected");

/** How much of a rejection's reason the one-line row shows; the whole reason is on hover. */
const REASON_PREVIEW_CHARS = 50;
const previewOf = (text: string) =>
	text.length <= REASON_PREVIEW_CHARS ? text : `${text.slice(0, REASON_PREVIEW_CHARS).trimEnd()}…`;

/**
 * A Work Order's GST requests with no payment (waiting, or rejected), one short line each in its Transaction
 * Details table: the amount, the status (a rejection's reason beside it), who raised it and when, and the
 * delete icon for the deciders.
 */
export const GstRequestTableRows = ({ rows, onDeleted }: { rows: GSTPaymentRequestRow[]; onDeleted?: () => void }) => (
	<>
		{requestsWithoutPayment(rows).map((row) => (
			<TableRow key={row.name} className="bg-red-50 hover:bg-red-100/70 dark:bg-red-950/40 dark:hover:bg-red-950/60">
				<TableCell className="whitespace-nowrap font-semibold">
					{formatToRoundedIndianRupee(row.amount)}
					<span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">GST</span>
				</TableCell>
				<TableCell colSpan={6} className="whitespace-nowrap text-sm">
					<span className={`rounded px-2 py-0.5 text-xs font-medium ${GST_REQUEST_CHIP[row.status].className}`}>
						{GST_REQUEST_CHIP[row.status].label}
					</span>
					<span className="ml-2 text-muted-foreground">Raised by {row.raised_by_name} · {formatDate(row.creation)}</span>
					{row.status === "Rejected" && row.review_comment && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="ml-2 cursor-help text-red-700 dark:text-red-400" tabIndex={0}>· {previewOf(row.review_comment)}</span>
								</TooltipTrigger>
								<TooltipContent className="max-w-xs whitespace-normal break-words">
									<p>{row.review_comment}</p>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
				</TableCell>
				<TableCell className="text-end"><GstRequestDeleteButton row={row} onDeleted={onDeleted} /></TableCell>
			</TableRow>
		))}
	</>
);

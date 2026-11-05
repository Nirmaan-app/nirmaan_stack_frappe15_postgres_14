import { cn } from "@/lib/utils";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import type { GstDecisionFigures } from "@/utils/gstPaymentRequests";

const Line = ({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "good" | "bad" }) => (
	<div className={cn("flex items-baseline justify-between gap-3 px-3 py-1.5", strong && "bg-muted/40")}>
		<span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
		<span className={cn(
			"tabular-nums", strong && "font-semibold",
			tone === "good" && "font-semibold text-green-700 dark:text-green-400",
			tone === "bad" && "font-semibold text-red-600 dark:text-red-400",
		)}>{formatToIndianRupeeOrZero(value)}</span>
	</div>
);

interface GstFiguresBoxProps {
	figures: GstDecisionFigures;
	/** The line for this amount: "Approving now", "This request", "Paying now". */
	thisLabel: string;
	/** The line for what is left once it goes through. */
	leftLabel: string;
}

/**
 * A Work Order's GST at a glance: its GST, what approved invoices allow, what is paid, what waits, this
 * amount, and what is left after it (red once it no longer fits). Shared by the Accountant's approve / reject
 * dialog and an Accountant's own GST request.
 */
export const GstFiguresBox = ({ figures, thisLabel, leftLabel }: GstFiguresBoxProps) => (
	<div className="divide-y rounded-md border text-sm">
		<Line label="GST on this Work Order" value={figures.workOrderGst} />
		<Line label="GST on approved invoices" value={figures.invoiced} />
		<Line label="GST already paid / approved" value={figures.paid} />
		{figures.otherWaiting > 0 && <Line label="Other GST requests waiting" value={figures.otherWaiting} />}
		<Line label={thisLabel} value={figures.thisAmount} strong />
		{figures.fits
			? <Line label={leftLabel} value={Math.max(0, figures.leftAfter)} tone="good" />
			: <Line label="Over the GST left by" value={-figures.leftAfter} tone="bad" />}
	</div>
);

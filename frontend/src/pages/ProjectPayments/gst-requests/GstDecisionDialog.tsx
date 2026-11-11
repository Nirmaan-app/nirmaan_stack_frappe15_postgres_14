import { useState } from "react";
import { TailSpin } from "react-loader-spinner";

import {
	AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeErrorText } from "@/utils/frappeErrors";
import { gstDecisionFigures } from "@/utils/gstPaymentRequests";

import { usePaymentSummary } from "../components/PaymentSummaryBlock";
import { useGstRequestActions } from "../hooks/useGstPaymentRequests";
import { GstFiguresBox } from "./GstFiguresBox";

/** The longest rejection reason the box takes; typing stops there. The server refuses longer (`REJECT_REASON_MAX`). */
const REJECT_REASON_MAX = 250;

/** The request being decided, with the names its row already shows. */
export interface GstDecisionTarget {
	name: string;
	workOrder: string;
	amount: number;
	projectName: string;
	vendorName: string;
	raisedByName: string;
	creation: string;
}

interface GstDecisionDialogProps {
	target: GstDecisionTarget | null;
	kind: "approve" | "reject";
	onClose: () => void;
	/** After a decision the server accepted. */
	onDone: () => void;
}

/**
 * Approve or reject one GST Payment Request. The amount is the one asked for and is not edited here; the
 * box shows the Work Order's GST from the server's own limit (`get_payment_summary`), so it agrees with the
 * check the approval runs. A request that no longer fits (an invoice rejected since) cannot be approved.
 */
export const GstDecisionDialog = ({ target, kind, onClose, onDone }: GstDecisionDialogProps) => {
	const { summary, isLoading, error } = usePaymentSummary(target ? "Service Requests" : null, target?.workOrder ?? null);
	const { approveGst, rejectGst, busy } = useGstRequestActions();
	const [comment, setComment] = useState("");

	const limit = summary?.limit;
	const figures = limit && target ? gstDecisionFigures(limit, target.amount, true) : null;
	const approving = kind === "approve";

	const close = () => { setComment(""); onClose(); };

	const confirm = async () => {
		if (!target) return;
		try {
			if (approving) {
				const res = await approveGst(target.name);
				toast({ title: "GST approved", description: `Payment ${res.message.project_payment} is ${res.message.payment_status}.`, variant: "success" });
			} else {
				await rejectGst(target.name, comment.trim());
				toast({ title: "GST request rejected", description: `${target.name} is rejected and its GST is free again.`, variant: "success" });
			}
			setComment("");
			onDone();
		} catch (e) {
			toast({ title: "Not done", description: getFrappeErrorText(e) || "Something went wrong. Try again.", variant: "destructive" });
		}
	};

	return (
		<AlertDialog open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
			<AlertDialogContent className="max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>{approving ? "Approve GST payment" : "Reject GST request"}</AlertDialogTitle>
					{target && (
						<AlertDialogDescription className="space-y-0.5">
							<span className="block font-medium text-foreground">{target.workOrder} · {target.projectName}</span>
							<span className="block">{target.vendorName} · asked by {target.raisedByName} · {formatDate(target.creation)}</span>
						</AlertDialogDescription>
					)}
				</AlertDialogHeader>

				{isLoading && <div className="h-40 animate-pulse rounded-md border bg-muted/40" aria-label="Loading the Work Order's GST" />}
				{!isLoading && (error || !figures) && (
					<p className="text-sm text-red-600">Couldn't load this Work Order's GST. Close and try again.</p>
				)}
				{figures && (
					<GstFiguresBox figures={figures} thisLabel={approving ? "Approving now" : "This request"}
						leftLabel={approving ? "GST left after this approval" : "GST left if approved"} />
				)}

				{approving && figures && !figures.fits && (
					<p className="text-xs text-red-600">This no longer fits the GST on approved invoices. Reject it; a new request can be raised for what is left.</p>
				)}

				{!approving && (
					<div className="space-y-1.5">
						<Label htmlFor="gst-reject-reason">Reason</Label>
						<Textarea id="gst-reject-reason" value={comment} maxLength={REJECT_REASON_MAX}
							onChange={(e) => setComment(e.target.value.slice(0, REJECT_REASON_MAX))}
							placeholder="Tell the requester why" />
						<p className={`text-right text-xs ${comment.length >= REJECT_REASON_MAX ? "text-red-600" : "text-muted-foreground"}`}>
							{comment.length}/{REJECT_REASON_MAX}
						</p>
					</div>
				)}

				<div className="flex gap-2">
					{busy ? <div className="flex flex-1 justify-center"><TailSpin color="red" height={32} width={32} /></div> : <>
						<AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
						<Button className="flex-1" onClick={confirm}
							disabled={approving ? !figures?.fits : !comment.trim()}>
							{approving && target ? `Approve ${formatToIndianRupee(target.amount)}` : "Reject"}
						</Button>
					</>}
				</div>
			</AlertDialogContent>
		</AlertDialog>
	);
};

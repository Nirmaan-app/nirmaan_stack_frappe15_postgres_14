import { Trash2 } from "lucide-react";
import { useState } from "react";

import {
	AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import type { GSTPaymentRequestRow } from "@/types/NirmaanStack/GSTPaymentRequest";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeErrorText } from "@/utils/frappeErrors";
import { canDeleteGstRequest } from "@/utils/gstPaymentRequests";

import { useGstRequestActions } from "../hooks/useGstPaymentRequests";

/**
 * Delete a Pending or Rejected GST request: Accountant, Accountant Lead or Admin only. Renders nothing for
 * anyone else, or for an Approved or Paid request, which goes only with its payment.
 */
export const GstRequestDeleteButton = ({ row, onDeleted }: {
	row: Pick<GSTPaymentRequestRow, "name" | "status" | "amount" | "work_order">;
	onDeleted?: () => void;
}) => {
	const { role, user_id } = useUserData();
	const { deleteGst, busy } = useGstRequestActions();
	const [open, setOpen] = useState(false);
	if (!canDeleteGstRequest(role, user_id, row.status)) return null;

	const confirm = async () => {
		try {
			await deleteGst(row.name);
			toast({ title: "GST request deleted", description: `${row.name} is deleted.`, variant: "success" });
			setOpen(false);
			onDeleted?.();
		} catch (e) {
			toast({ title: "Not deleted", description: getFrappeErrorText(e) || "Something went wrong. Try again.", variant: "destructive" });
		}
	};

	return (
		<>
			<Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-red-50" title="Delete" aria-label={`Delete ${row.name}`}
				onClick={() => setOpen(true)}>
				<Trash2 className="h-4 w-4 text-red-600" />
			</Button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent className="max-w-md">
					<AlertDialogHeader>
						<AlertDialogTitle>Delete GST request?</AlertDialogTitle>
						<AlertDialogDescription>
							{row.name} for {formatToIndianRupee(row.amount)} on {row.work_order} will be deleted.
							{row.status === "Pending" && " Its GST can then be requested again."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-2">
						<AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
						<Button className="flex-1" variant="destructive" disabled={busy} onClick={confirm}>Delete</Button>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};

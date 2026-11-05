// src/utils/gstPaymentRequests.ts
//
// Frontend MIRROR of `nirmaan_stack/services/gst_payment_requests.py`. THE PYTHON FILE IS THE AUTHORITY:
// it refuses whatever this lets through. Every Work Order GST payment waits for approval in GST Requests as a
// GST Payment Request, an Accountant's or Admin's own too; the deciders (Admin, Accountant, Accountant Lead,
// the Administrator user) approve or reject it there.

import { ACCOUNTANT_PROFILES, ADMIN_PROFILE } from "@/constants/roles";
import type { GstRequestStatus } from "@/types/NirmaanStack/GSTPaymentRequest";
import type { WorkOrderLimit } from "@/pages/ProjectPayments/components/paymentSummaryView";

const API = "nirmaan_stack.api.payments.gst_payment_requests";
export const GST_REQUESTS_API = `${API}.get_gst_payment_requests`;
export const REQUEST_GST_PAYMENT_API = `${API}.request_gst_payment`;
export const APPROVE_GST_REQUEST_API = `${API}.approve_gst_payment_request`;
export const REJECT_GST_REQUEST_API = `${API}.reject_gst_payment_request`;
export const DELETE_GST_REQUEST_API = `${API}.delete_gst_payment_request`;

/** May this viewer approve or reject a GST request? Server twin: `gst_payment_requests.can_decide`. */
export const canDecideGstRequest = (role: string, userId: string): boolean =>
	userId === "Administrator" || role === ADMIN_PROFILE || ACCOUNTANT_PROFILES.includes(role);

/** The chip a request shows, by status. */
export const GST_REQUEST_CHIP: Record<GstRequestStatus, { label: string; className: string }> = {
	Pending: { label: "Waiting for Accountant Approval", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
	Approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
	Rejected: { label: "Rejected", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
	Paid: { label: "Paid", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
};

/**
 * May this viewer delete this request? A decider, while it is Pending or Rejected; an Approved or Paid one
 * goes only with its payment. Server twin: `gst_payment_requests.delete_problem`.
 */
export const canDeleteGstRequest = (role: string, userId: string, status: GstRequestStatus): boolean =>
	canDecideGstRequest(role, userId) && (status === "Pending" || status === "Rejected");

/** The server's ₹10 rounding tolerance on the GST cap (`work_order_payment_limit.TOLERANCE`). */
export const GST_CAP_TOLERANCE = 10;

/** The Work Order's GST, as the Accountant's approve / reject dialog shows it. */
export interface GstDecisionFigures {
	/** The Work Order's own GST. */
	workOrderGst: number;
	/** GST on approved invoices, never more than the Work Order's: the most that may be paid now. */
	invoiced: number;
	/** GST payments at any status, Rejected included until deleted. */
	paid: number;
	/** The Work Order's OTHER Pending requests. */
	otherWaiting: number;
	/** This request. */
	thisAmount: number;
	/** What is left once this one is approved; below 0 when it no longer fits. */
	leftAfter: number;
	/** Does it still fit, with the server's tolerance? */
	fits: boolean;
}

/**
 * The figures for approving request `amount` from the Work Order's limit (the server's, never re-derived).
 * `limit.gst_requested` counts every Pending request, this one included while it is Pending.
 */
export const gstDecisionFigures = (
	limit: Pick<WorkOrderLimit, "work_order_gst" | "gst_released" | "gst_paid" | "gst_requested">,
	amount: number,
	isPending: boolean,
): GstDecisionFigures => {
	const round = (n: number) => Math.round(n * 100) / 100;
	const otherWaiting = round(Math.max(0, Number(limit.gst_requested || 0) - (isPending ? amount : 0)));
	const leftAfter = round(Number(limit.gst_released || 0) - Number(limit.gst_paid || 0) - otherWaiting - amount);
	return {
		workOrderGst: Number(limit.work_order_gst || 0),
		invoiced: Number(limit.gst_released || 0),
		paid: Number(limit.gst_paid || 0),
		otherWaiting,
		thisAmount: amount,
		leftAfter,
		fits: leftAfter >= -GST_CAP_TOLERANCE,
	};
};

// What a user may do to a Vendor Refund from its PO's Transaction Details (#1396, ADR-0032): edit it
// (stories 8, 10), and the ways out for a waiting one whose bank line never comes (#1403); its
// "No bank proof" mark, and the 15-day warning. Pure: no React, no network.
//
// The gates MIRROR the server (`api/vendor_refunds/waiting_refunds`), which re-checks and is
// authoritative. Edit: amount and PO = its creator or an Accountant, while it waits; proof, UTR and
// description = anyone who works the PO's payments (`REFUND_PAPERWORK_PROFILES`), the UTR fixed while a
// bank line is matched to it. Cancel = its creator or an Accountant, while it waits. Mark Received with
// no bank line = an Admin, while it waits. Delete = an Admin or material Procurement, once Cancelled.

import {
    isNirmaanAdmin,
    REFUND_ACCOUNTANT_PROFILES,
    REFUND_DELETE_PROFILES,
    REFUND_PAPERWORK_PROFILES,
} from "@/constants/roles";
import { VENDOR_REFUND_STATUS, type VendorRefundStatus } from "@/types/NirmaanStack/VendorRefunds";

/** A waiting refund older than this many days (since it was recorded) is flagged on its PO. */
export const WAITING_REFUND_OVERDUE_DAYS = 15;

const { WAITING, RECEIVED, CANCELLED } = VENDOR_REFUND_STATUS;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RefundState {
    status: VendorRefundStatus;
    creation: string;
    waiting_created_by?: string | null;
    no_bank_line?: number | null;
    refund_attachment?: string | null;
    bank_matched?: boolean;
}

/** A Frappe datetime ("2026-10-01 09:00:00.000000"), read as local time like the rest of the app. */
const parseFrappeDatetime = (value: string) => new Date(value.replace(" ", "T"));

const pad = (n: number) => String(n).padStart(2, "0");
const toFrappeDatetime = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const overdueCutoff = (now: Date) => new Date(now.getTime() - WAITING_REFUND_OVERDUE_DAYS * DAY_MS);

/** Has this refund waited for its bank line more than 15 days since it was recorded? */
export const isOverdueWaitingRefund = (refund: RefundState, now: Date = new Date()): boolean =>
    refund.status === WAITING && parseFrappeDatetime(refund.creation) < overdueCutoff(now);

/** The list filters for "waiting more than 15 days" -- the same rule, asked of the server. */
export const overdueWaitingFilters = (now: Date = new Date()): [string, string, string][] => [
    ["status", "=", WAITING],
    ["creation", "<", toFrappeDatetime(overdueCutoff(now))],
];

/** Received with no bank line, and no bank line matched to it yet: the "No bank proof" badge. */
export const hasNoBankProof = (refund: Pick<RefundState, "status" | "no_bank_line">): boolean =>
    refund.status === RECEIVED && Boolean(refund.no_bank_line);

/** "No bank proof" and no attachment either: nothing on record shows the money arrived (e.g. a refund
 *  migrated from Adjust Payments without proof, #1404). Accounts should attach the proof. */
export const hasNoProofAtAll = (
    refund: Pick<RefundState, "status" | "no_bank_line" | "refund_attachment">
): boolean => hasNoBankProof(refund) && !refund.refund_attachment;

/** `services/vendor_refunds.creator_and_accountant`: did this user record it, or are they an Accountant?
 *  The Administrator passes the Accountant test, as `has_role_profile` lets the superuser through. */
const isCreatorOrAccountant = (refund: RefundState, user: string, role: string): boolean =>
    user === "Administrator" ||
    (Boolean(refund.waiting_created_by) && refund.waiting_created_by === user) ||
    REFUND_ACCOUNTANT_PROFILES.includes(role);

/** What this user may change on this refund: its amount and PO, its paperwork, and whether its UTR is fixed. */
export const refundEditAccess = (
    refund: RefundState,
    user: string,
    role: string
): { money: boolean; paperwork: boolean; utrLocked: boolean } => {
    const isCreator = Boolean(refund.waiting_created_by) && refund.waiting_created_by === user;
    return {
        money: refund.status === WAITING && isCreatorOrAccountant(refund, user, role),
        paperwork: user === "Administrator" || isCreator || REFUND_PAPERWORK_PROFILES.includes(role),
        utrLocked: Boolean(refund.bank_matched),
    };
};

/** May this user cancel this refund? Its creator or an Accountant, while it waits. */
export const canCancelRefund = (refund: RefundState, user: string, role: string): boolean =>
    refund.status === WAITING && isCreatorOrAccountant(refund, user, role);

/** May this user mark this refund Received with no bank line? An Admin, while it waits. */
export const canMarkReceivedWithoutBankLine = (refund: RefundState, user: string, role: string): boolean =>
    refund.status === WAITING && isNirmaanAdmin(role, user);

/** May this user delete this refund? An Admin or material Procurement, once it is Cancelled. The server
 *  also keeps one a bank line was once matched to. */
export const canDeleteRefund = (refund: RefundState, user: string, role: string): boolean =>
    refund.status === CANCELLED && (user === "Administrator" || REFUND_DELETE_PROFILES.includes(role));

/** A refund edit as `update_waiting_refund` takes it. A field left out is left as it is; `null` clears it. */
export interface RefundEdit {
    amount?: number;
    po_id?: string;
    utr?: string | null;
    refund_attachment?: string | null;
    description?: string | null;
}

/** The edit dialog's fields, as typed. */
export interface RefundEditForm {
    amount: string;
    poId: string;
    utr: string;
    description: string;
}

const typed = (value: string) => value.trim() || null;

/** What the edit dialog posts: only the fields that changed, and only those this user may change. */
export const refundEditChanges = (
    saved: { amount: number; document_name?: string | null; utr?: string | null; description?: string | null },
    form: RefundEditForm,
    access: ReturnType<typeof refundEditAccess>
): RefundEdit => {
    const changes: RefundEdit = {};
    if (access.money) {
        const amount = Number(form.amount);
        if (Number.isFinite(amount) && Math.round(amount * 100) !== Math.round(saved.amount * 100)) {
            changes.amount = amount;
        }
        if (form.poId && form.poId !== saved.document_name) changes.po_id = form.poId;
    }
    if (access.paperwork) {
        if (!access.utrLocked && typed(form.utr) !== (saved.utr || null)) changes.utr = typed(form.utr);
        if (typed(form.description) !== (saved.description || null)) changes.description = typed(form.description);
    }
    return changes;
};

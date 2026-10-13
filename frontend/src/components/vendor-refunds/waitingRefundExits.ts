// The ways out for a waiting Vendor Refund whose bank line never comes (#1403, ADR-0032), its
// "No bank proof" mark, and the 15-day warning. Pure: no React, no network.
//
// The gates MIRROR the server (`api/vendor_refunds/waiting_refunds`), which re-checks and is
// authoritative: Cancel = its creator or an Accountant (`REFUND_ACCOUNTANT_PROFILES`); Mark Received
// with no bank line = an Admin (`is_nirmaan_admin`). Both only while it waits.

import { ADMIN_PROFILE } from "@/constants/roles";
import type { VendorRefundStatus } from "./RefundStatusBadge";

/** A waiting refund older than this many days (since it was recorded) is flagged on its PO. */
export const WAITING_REFUND_OVERDUE_DAYS = 15;

/** `services/role_profiles.REFUND_ACCOUNTANT_PROFILES`: "an Accountant" for a waiting refund. */
const REFUND_ACCOUNTANT_PROFILES: readonly string[] = [
    "Nirmaan Accountant Profile",
    "Nirmaan Accountant Lead Profile",
];

const WAITING: VendorRefundStatus = "Reconciliation Pending";
const DAY_MS = 24 * 60 * 60 * 1000;

interface RefundState {
    status: VendorRefundStatus;
    creation: string;
    waiting_created_by?: string | null;
    no_bank_line?: number | null;
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
    refund.status === "Received" && Boolean(refund.no_bank_line);

/** May this user cancel this refund? Its creator or an Accountant, while it waits. */
export const canCancelRefund = (refund: RefundState, user: string, role: string): boolean =>
    refund.status === WAITING &&
    (user === "Administrator" ||
        (Boolean(refund.waiting_created_by) && refund.waiting_created_by === user) ||
        REFUND_ACCOUNTANT_PROFILES.includes(role));

/** May this user mark this refund Received with no bank line? An Admin, while it waits. */
export const canMarkReceivedWithoutBankLine = (refund: RefundState, user: string, role: string): boolean =>
    refund.status === WAITING && (user === "Administrator" || role === ADMIN_PROFILE);

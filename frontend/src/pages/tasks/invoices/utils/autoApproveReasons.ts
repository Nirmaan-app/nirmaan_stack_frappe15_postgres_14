/**
 * Reviewer-facing reading of `Vendor Invoices.auto_approve_skip_reasons`.
 *
 * The backend (`api/invoices/_auto_approve.py`) runs 13 gates on insert and
 * persists a comma-joined list of machine tokens for every gate that failed.
 * That list is written for a machine: flat, unranked, and cascading. This module
 * turns it into something a reviewer can act on.
 *
 * Two ideas do the work:
 *
 * 1. TIERS, not a flat list. `autofill_not_used` and `not_procurement_order` are
 *    not failures — auto-approval is AI-only and PO-only BY DESIGN, so they
 *    explain why the invoice was never a candidate. Presenting them as "why
 *    auto-approval failed" misreads the data. Everything else ranks
 *    blocker > check > info.
 *
 * 2. CASCADE SUPPRESSION. A hand-typed invoice mechanically trips ~10 further
 *    gates that all reduce to "there was no AI extraction". Measured on 413 live
 *    rows, five counts are identical — autofill_not_used, the two
 *    *_gstin_not_extracted, source_file_url_missing and amounts_incomplete all
 *    sit at exactly 32 — which is what a cascade looks like. Collapsing it takes
 *    the worst real row from 12 tokens to 0 flags plus 2 eligibility lines.
 *
 * The suppression set is deliberately MINIMAL. `po_number_mismatch` and the two
 * `*_gstin_mismatch` tokens are NOT in it: `_auto_approve.py` uses
 * `if not extracted → …_not_extracted / elif mismatch → …_mismatch`, so with no
 * extraction the elif is unreachable and a `*_mismatch` on a manual invoice
 * would be genuinely anomalous. `file_swap_detected` is excluded for the same
 * structural reason (gate 13's else-branch needs a source URL).
 *
 * ⚠️ Reasons are a snapshot from CREATION. Auto-approve never re-runs on edit
 * (see the comment at update_invoice_data.py's insert branch), so a reason can
 * be stale after someone corrects the invoice.
 *
 * Pure module, no React — unit-tested, per ADR-0010 F4.
 */
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

/**
 * - `eligibility` — structural; the invoice was never an auto-approve candidate
 * - `blocker`     — evidence of a real problem; verify before approving
 * - `check`       — the AI could not confirm something; needs a human eye
 * - `info`        — master-data gap, not a problem with this invoice
 * - `legacy`      — a retired gate; only appears on historical rows
 */
export type ReasonTier = "eligibility" | "blocker" | "check" | "info" | "legacy";

export interface AutoApproveReason {
    token: string;
    label: string;
    tier: ReasonTier;
}

/**
 * Token → reviewer-facing label + tier.
 *
 * Covers every token `_auto_approve.py` can emit today, plus the three
 * `low_confidence_*` tokens from the retired per-field confidence gate (gate 5
 * was rewritten to deterministic intrinsic validation, but 29 live rows still
 * carry them). Anything not listed falls through to `humanizeReasonToken`.
 */
export const AUTO_APPROVE_REASON_LABELS: Readonly<
    Record<string, { label: string; tier: ReasonTier }>
> = {
    // --- Eligibility: never a candidate, by design -------------------------
    autofill_not_used: {
        label: "Entered manually — AI checks don't apply",
        tier: "eligibility",
    },
    not_procurement_order: {
        label: "Work Order invoice — auto-approval is PO-only",
        tier: "eligibility",
    },

    // --- Blockers: evidence of a real problem ------------------------------
    po_number_mismatch: {
        label: "PO number on the invoice doesn't match this PO",
        tier: "blocker",
    },
    would_exceed_delivered: {
        label: "Invoiced total exceeds what's been delivered",
        tier: "blocker",
    },
    would_exceed_po_total: {
        label: "Invoiced total would exceed the PO value",
        tier: "blocker",
    },
    amount_unreconciled: {
        label: "Net + tax doesn't add up to the invoice total",
        tier: "blocker",
    },
    invoice_date_in_future: {
        label: "Invoice is dated in the future",
        tier: "blocker",
    },
    duplicate_invoice_no: {
        label: "This vendor already has an invoice with this number",
        tier: "blocker",
    },
    supplier_gstin_mismatch: {
        label: "Supplier GSTIN doesn't match the vendor master",
        tier: "blocker",
    },
    receiver_gstin_mismatch: {
        label: "Receiver GSTIN doesn't match the project's GSTIN",
        tier: "blocker",
    },
    supplier_gstin_checksum_failed: {
        label: "Supplier GSTIN fails its checksum — likely misread",
        tier: "blocker",
    },
    receiver_gstin_checksum_failed: {
        label: "Receiver GSTIN fails its checksum — likely misread",
        tier: "blocker",
    },
    file_swap_detected: {
        label: "Attached file differs from the one AI read",
        tier: "blocker",
    },
    no_attachment: {
        label: "No invoice document attached",
        tier: "blocker",
    },
    invoice_amount_unparseable: {
        label: "Invoice amount couldn't be read as a number",
        tier: "blocker",
    },
    invoice_date_unparseable: {
        label: "Invoice date couldn't be read as a date",
        tier: "blocker",
    },

    // --- Checks: unconfirmed, needs a human eye ----------------------------
    nothing_delivered_yet: {
        label: "Nothing delivered against this PO yet",
        tier: "check",
    },
    po_number_not_extracted: {
        label: "AI couldn't find a PO number on the invoice",
        tier: "check",
    },
    invoice_amount_edited: {
        label: "Amount was changed from what AI read",
        tier: "check",
    },
    invoice_date_edited: {
        label: "Date was changed from what AI read",
        tier: "check",
    },
    invoice_no_edited: {
        label: "Invoice number was changed from what AI read",
        tier: "check",
    },
    supplier_gstin_not_extracted: {
        label: "AI couldn't find a supplier GSTIN",
        tier: "check",
    },
    receiver_gstin_not_extracted: {
        label: "AI couldn't find a receiver GSTIN",
        tier: "check",
    },
    amounts_incomplete: {
        label: "AI couldn't read enough amounts to cross-check",
        tier: "check",
    },

    // --- Info: master-data gaps, not invoice problems ----------------------
    source_file_url_missing: {
        label: "Upload predates file-swap tracking",
        tier: "info",
    },
    vendor_gst_not_configured: {
        label: "Vendor master has no GSTIN — fix on the vendor",
        tier: "info",
    },
    project_gst_not_configured: {
        label: "Project has no GSTIN — fix on the project",
        tier: "info",
    },
    po_total_invalid: {
        label: "PO has no valid total to check against",
        tier: "info",
    },

    // --- Legacy: retired gate, historical rows only ------------------------
    low_confidence_amount: {
        label: "Low AI confidence on amount (retired check)",
        tier: "legacy",
    },
    low_confidence_invoice_date: {
        label: "Low AI confidence on date (retired check)",
        tier: "legacy",
    },
    low_confidence_invoice_no: {
        label: "Low AI confidence on invoice no. (retired check)",
        tier: "legacy",
    },
};

/**
 * Tokens that are mechanically implied by `autofill_not_used` and carry no
 * independent information once we've said "entered manually".
 *
 * Suppressed ONLY when `autofill_not_used` is present — on an autofilled
 * invoice every one of these is a real signal.
 */
export const MANUAL_ENTRY_CASCADE: ReadonlySet<string> = new Set([
    "invoice_no_edited",
    "invoice_date_edited",
    "invoice_amount_edited",
    "invoice_amount_unparseable",
    "supplier_gstin_not_extracted",
    "receiver_gstin_not_extracted",
    "supplier_gstin_checksum_failed",
    "receiver_gstin_checksum_failed",
    "amount_unreconciled",
    "amounts_incomplete",
    "po_number_not_extracted",
    "source_file_url_missing",
    "low_confidence_amount",
    "low_confidence_invoice_date",
    "low_confidence_invoice_no",
]);

/** Severity ordering for display — most urgent first. */
const TIER_RANK: Record<ReasonTier, number> = {
    eligibility: 0,
    blocker: 1,
    check: 2,
    info: 3,
    legacy: 4,
};

/** Splits the stored comma-joined token list, dropping blanks. */
export const parseSkipReasons = (raw: string | undefined | null): string[] => {
    if (!raw) return [];
    return String(raw)
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
};

/**
 * Fallback label for a token this map doesn't know — a future gate, or one
 * retired before this file was updated. Rendered as a `check` so it stays
 * visible: silently dropping an unrecognised reason would hide real signal.
 */
export const humanizeReasonToken = (token: string): string => {
    const words = token.replace(/_/g, " ").trim();
    if (!words) return token;
    return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Resolves one token to its label + tier, with the humanized fallback. */
export const describeReason = (token: string): AutoApproveReason => {
    const known = AUTO_APPROVE_REASON_LABELS[token];
    if (known) return { token, label: known.label, tier: known.tier };
    return { token, label: humanizeReasonToken(token), tier: "check" };
};

export interface SkipReasonSummary {
    /** Structural "never a candidate" reasons — render as prose, not badges. */
    eligibility: AutoApproveReason[];
    /** The gates that actually failed, most urgent first. */
    flags: AutoApproveReason[];
    /** How many cascade tokens were folded away (for an explanatory note). */
    suppressedCount: number;
    /** True when the invoice was hand-typed (drives the cascade collapse). */
    isManualEntry: boolean;
    /** Highest severity present among `flags`, or null when there are none. */
    highestTier: Exclude<ReasonTier, "eligibility"> | null;
}

const EMPTY_SUMMARY: SkipReasonSummary = {
    eligibility: [],
    flags: [],
    suppressedCount: 0,
    isManualEntry: false,
    highestTier: null,
};

/**
 * Turns the stored token list into the two lists a reviewer should see.
 *
 * An invoice the system auto-approved has no reasons by construction
 * (`apply_auto_approval` clears the field on the pass path), so this returns the
 * empty summary for those.
 */
export const summariseSkipReasons = (
    invoice: Pick<VendorInvoice, "auto_approve_skip_reasons"> | undefined | null
): SkipReasonSummary => {
    const tokens = parseSkipReasons(invoice?.auto_approve_skip_reasons);
    if (tokens.length === 0) return EMPTY_SUMMARY;

    const isManualEntry = tokens.includes("autofill_not_used");
    const eligibility: AutoApproveReason[] = [];
    const flags: AutoApproveReason[] = [];
    let suppressedCount = 0;

    for (const token of tokens) {
        const reason = describeReason(token);
        if (reason.tier === "eligibility") {
            eligibility.push(reason);
            continue;
        }
        if (isManualEntry && MANUAL_ENTRY_CASCADE.has(token)) {
            suppressedCount += 1;
            continue;
        }
        flags.push(reason);
    }

    flags.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);

    return {
        eligibility,
        flags,
        suppressedCount,
        isManualEntry,
        highestTier: (flags[0]?.tier as SkipReasonSummary["highestTier"]) ?? null,
    };
};

/**
 * What the Actioned-By / reason column should say about this invoice overall.
 *
 * - `auto`              — the system approved it; nothing to review
 * - `approved-with-flags` — a human approved it despite unresolved flags
 * - `flagged`           — still Pending, with flags to work through
 * - `clean`             — no reasons recorded
 */
export type InvoiceApprovalNarrative =
    | "auto"
    | "approved-with-flags"
    | "flagged"
    | "clean";

export const describeApprovalNarrative = (
    invoice: Pick<VendorInvoice, "status" | "auto_approved" | "auto_approve_skip_reasons">,
    summary: SkipReasonSummary
): InvoiceApprovalNarrative => {
    if (invoice.auto_approved === 1) return "auto";
    const hasAnything = summary.flags.length > 0 || summary.eligibility.length > 0;
    if (!hasAnything) return "clean";
    if (invoice.status === "Approved") return "approved-with-flags";
    return "flagged";
};

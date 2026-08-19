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
 * The suppression set is deliberately MINIMAL. The two `*_gstin_mismatch`
 * tokens are NOT in it: `_auto_approve.py` uses `if not extracted →
 * …_not_extracted / elif mismatch → …_mismatch`, so with no extraction the elif
 * is unreachable and a `*_mismatch` on a manual invoice would be genuinely
 * anomalous. `file_swap_detected` is excluded for the same structural reason
 * (gate 13's else-branch needs a source URL).
 *
 * Separately, RETIRED_REASONS drops tokens for gates that no longer exist at
 * all — see the note there.
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

/**
 * The reviewer-facing write-up behind one token.
 *
 * `label` is all the table cell can afford — one line, scannable. The other
 * three are the detail summary the reason key opens up, and they are kept as
 * SEPARATE fields rather than one paragraph because a reviewer reads them for
 * different purposes: `detail` says what the machine did, `impact` says why
 * that stops the invoice (the question the column can never answer), `action`
 * says what to do next. Merged into prose, the impact is the part that gets
 * skimmed past — and it is the only part that justifies the block.
 */
export interface ReasonEntry {
    /** One-line label — what the table cell and its hover list show. */
    label: string;
    /** Which of the 13 gates recorded this, e.g. "Gate 10 · delivered-value ceiling". */
    gate: string;
    /** What the gate checked, and what it found. */
    detail: string;
    /** Why that blocks — the risk carried if it is approved anyway. */
    impact: string;
    /** What the reviewer should do about it. */
    action: string;
    tier: ReasonTier;
}

/** A `ReasonEntry` resolved against a specific token. */
export interface AutoApproveReason extends ReasonEntry {
    token: string;
}

/**
 * Token → reviewer-facing label, gate, detail summary and tier.
 *
 * Covers every token `_auto_approve.py` can emit today, plus the three
 * `low_confidence_*` tokens from the retired per-field confidence gate (gate 5
 * was rewritten to deterministic intrinsic validation, but 29 live rows still
 * carry them). Anything not listed falls through to `humanizeReasonToken`.
 */
export const AUTO_APPROVE_REASON_LABELS: Readonly<
    Record<string, ReasonEntry>
> = {
    // --- Eligibility: never a candidate, by design -------------------------
    autofill_not_used: {
        label:
            "Entered manually — AI checks don't apply",
        gate: "Gate 1 · AI extraction used",
        detail:
            "Gate 1 requires the invoice to have been created from an AI extraction run. This one was typed in by hand.",
        impact:
            "Every other gate works by comparing what was submitted against what the AI read off the document. With no extraction there is nothing to compare, so the invoice can never clear auto-approval — it is not a fault, it is a missing input.",
        action:
            "Nothing to fix. Review it the normal way. To make future invoices eligible, upload the document and use Autofill rather than typing the values.",
        tier: "eligibility",
    },
    not_procurement_order: {
        label:
            "Work Order invoice — auto-approval is PO-only",
        gate: "Gate 2 · Purchase Orders only",
        detail:
            "Gate 2 limits auto-approval to invoices raised against a Purchase Order. This one sits on a Work Order (Service Request).",
        impact:
            "The two money ceilings that make auto-approval safe — PO value and delivered value — have no equivalent on a Work Order, so there is no amount the system could approve against.",
        action:
            "Review it against the Work Order by hand. This is a deliberate scope limit, not a problem with the invoice.",
        tier: "eligibility",
    },

    // --- Blockers: evidence of a real problem ------------------------------
    would_exceed_delivered: {
        label:
            "Invoiced total exceeds what's been delivered",
        gate: "Gate 10 · delivered-value ceiling",
        detail:
            "Gate 10 adds every non-rejected invoice already on this PO to this one and compares the total against the value delivered, allowing ₹10 of tolerance.",
        impact:
            "The total goes over what has actually been received. Approving it means paying for goods the site has not got yet — the exposure auto-approval exists to prevent.",
        action:
            "Check the Delivery Notes on the PO. Approve only if paying ahead of delivery is a deliberate decision here.",
        tier: "blocker",
    },
    would_exceed_po_total: {
        label:
            "Invoiced total would exceed the PO value",
        gate: "Gate 9 · PO value ceiling",
        detail:
            "Gate 9 adds every non-rejected invoice already on this PO to this one and compares the total against the PO's own value, allowing ₹10 of tolerance.",
        impact:
            "The vendor would be billing more than the order is worth. Approving it books a payable the PO does not authorise, and it later surfaces as an unexplained overrun.",
        action:
            "Review the earlier invoices on the PO. If the extra scope is genuine, raise a PO revision first; if not, reject and ask for a corrected bill.",
        tier: "blocker",
    },
    amount_unreconciled: {
        label:
            "Net + tax doesn't add up to the invoice total",
        gate: "Gate 5 · intrinsic validity",
        detail:
            "Gate 5 adds the extracted net and tax — allowing for round-off, other charges and TCS — and compares the result to the extracted total. They do not agree.",
        impact:
            "Either the document's own arithmetic is wrong or a figure was misread. In both cases the amount about to be approved may not be the amount actually payable.",
        action:
            "Add the totals up on the document by hand. If the document itself is inconsistent, ask the vendor for a corrected invoice.",
        tier: "blocker",
    },
    invoice_date_in_future: {
        label:
            "Invoice is dated in the future",
        gate: "Gate 11 · invoice date",
        detail:
            "Gate 11 rejects any invoice dated later than today. This one is.",
        impact:
            "A future-dated invoice lands in the wrong tax period, corrupts aging on the pending queue, and is usually a typo rather than an intentional post-dating.",
        action:
            "Check the date printed on the document and correct the record. If the vendor genuinely post-dated it, approve that deliberately.",
        tier: "blocker",
    },
    duplicate_invoice_no: {
        label:
            "This vendor already has an invoice with this number",
        gate: "Gate 12 · duplicate check",
        detail:
            "Gate 12 searches every Vendor Invoice in the system for the same vendor with the same invoice number. It found one.",
        impact:
            "This is nearly always the same bill uploaded twice. Approving both creates two payables for one invoice, and the vendor gets paid twice.",
        action:
            "Search that invoice number for this vendor, compare the two records, and reject the duplicate.",
        tier: "blocker",
    },
    supplier_gstin_mismatch: {
        label:
            "Supplier GSTIN doesn't match the vendor master",
        gate: "Gate 6 · supplier GSTIN",
        detail:
            "Gate 6 compares the supplier GSTIN printed on the invoice with the GSTIN on the vendor master. They are different.",
        impact:
            "The bill comes from a different legal entity or branch than the vendor on the PO. Paying it sends money to a party the order was never placed with, and the input credit will not tie back.",
        action:
            "Establish which entity actually supplied. Either correct the vendor master, or reject and ask for an invoice from the right entity.",
        tier: "blocker",
    },
    receiver_gstin_mismatch: {
        label:
            "Receiver GSTIN doesn't match the project's GSTIN",
        gate: "Gate 7 · receiver GSTIN",
        detail:
            "Gate 7 compares the bill-to GSTIN on the invoice with the project GSTIN on the PO. They are different.",
        impact:
            "The vendor has billed a different entity than the one that placed the order, so the GST input credit cannot be claimed against this invoice as it stands.",
        action:
            "Ask the vendor to re-issue against the correct GSTIN — or confirm it is the project's GSTIN that is out of date.",
        tier: "blocker",
    },
    supplier_gstin_checksum_failed: {
        label:
            "Supplier GSTIN fails its checksum — likely misread",
        gate: "Gate 5 · intrinsic validity",
        detail:
            "Gate 5 runs the GSTIN check-digit algorithm over the supplier GSTIN the AI read. It fails, so that string cannot be a valid GSTIN at all.",
        impact:
            "An impossible GSTIN means either the extraction misread it or the document prints a wrong one. Until that is settled, the supplier-identity match in gate 6 cannot be trusted either way.",
        action:
            "Read the GSTIN off the document. If the document is right, it is an OCR misread (0 for O, 1 for I); if the document is wrong, take it up with the vendor.",
        tier: "blocker",
    },
    receiver_gstin_checksum_failed: {
        label:
            "Receiver GSTIN fails its checksum — likely misread",
        gate: "Gate 5 · intrinsic validity",
        detail:
            "Gate 5 runs the GSTIN check-digit algorithm over the receiver GSTIN the AI read. It fails, so that string cannot be a valid GSTIN at all.",
        impact:
            "An impossible bill-to GSTIN means the receiver match in gate 7 is meaningless — nothing has confirmed the invoice is addressed to the right entity, which is what the input credit rests on.",
        action:
            "Check the bill-to block on the document against the project's GSTIN. Usually an OCR misread rather than a genuinely wrong address.",
        tier: "blocker",
    },
    file_swap_detected: {
        label:
            "Attached file differs from the one AI read",
        gate: "Gate 13 · file-swap guard",
        detail:
            "Gate 13 compares the file the AI extracted from with the file finally saved on the record. They are not the same file.",
        impact:
            "The document changed between extraction and submission, so every value the AI reported describes a different file. All of it is unverified here — and this is exactly the shape a deliberate substitution would take.",
        action:
            "Open the attachment and check the number, date, amount and GSTINs against it by hand before approving anything.",
        tier: "blocker",
    },
    no_attachment: {
        label:
            "No invoice document attached",
        gate: "Gate 3 · document attached",
        detail:
            "Gate 3 requires an invoice document on the record. None is attached.",
        impact:
            "There is no source document to check the number, date or amount against. Approving it puts a payable on the PO that nobody can evidence later.",
        action:
            "Get the vendor's invoice uploaded onto the record, then review it.",
        tier: "blocker",
    },
    invoice_amount_unparseable: {
        label:
            "Invoice amount couldn't be read as a number",
        gate: "Gate 4 · submitted = extracted",
        detail:
            "Gate 4 could not read the submitted invoice amount as a number when the checks ran.",
        impact:
            "With no usable figure, none of the money checks could run at all — not the comparison with the AI reading, not the PO ceiling, not the delivered ceiling. The invoice is completely unchecked on amount.",
        action:
            "Open the record, fix the amount field, and review it manually.",
        tier: "blocker",
    },
    invoice_date_unparseable: {
        label:
            "Invoice date couldn't be read as a date",
        gate: "Gate 11 · invoice date",
        detail:
            "Gate 11 could not read the submitted invoice date as a date when the checks ran.",
        impact:
            "The future-date check never ran, and aging on this invoice — which drives the red rows on this queue — will be wrong for as long as the date stays unreadable.",
        action:
            "Fix the date on the record, then review it manually.",
        tier: "blocker",
    },

    // --- Checks: unconfirmed, needs a human eye ----------------------------
    nothing_delivered_yet: {
        label:
            "Nothing delivered against this PO yet",
        gate: "Gate 10 · delivered-value ceiling",
        detail:
            "Gate 10 checks cumulative invoicing against the value delivered on the PO. This PO records nothing delivered at all.",
        impact:
            "With zero delivered, the ceiling that normally stops payment running ahead of receipt has nothing to work with, so the invoice cannot be cleared automatically. This is the single most common reason in production — usually advance or proforma billing rather than an error.",
        action:
            "Confirm billing ahead of delivery is intended on this order, or wait until the Delivery Note is recorded.",
        tier: "check",
    },
    po_number_not_extracted: {
        label:
            "AI couldn't find a PO number on the invoice",
        gate: "Gate 8 · PO number",
        detail:
            "Gate 8 needs a PO number on the invoice document to confirm the invoice belongs to this order. The AI found none.",
        impact:
            "Nothing but the uploader's intent links this document to this PO, so a misfiled invoice would pass unnoticed.",
        action:
            "Check the document actually references this PO before approving.",
        tier: "check",
    },
    invoice_amount_edited: {
        label:
            "Amount was changed from what AI read",
        gate: "Gate 4 · submitted = extracted",
        detail:
            "Gate 4 requires the submitted amount to equal the AI-extracted amount within a paisa. It does not.",
        impact:
            "The amount is what gets paid and what counts against both PO ceilings, and the edited figure no longer has the document's own reading behind it. Often a legitimate correction of an AI misread — but a person has to say so.",
        action:
            "Read the total off the document and confirm the record matches it.",
        tier: "check",
    },
    invoice_date_edited: {
        label:
            "Date was changed from what AI read",
        gate: "Gate 4 · submitted = extracted",
        detail:
            "Gate 4 requires the submitted invoice date to match the AI-extracted date. It was changed after extraction.",
        impact:
            "The date drives aging and the period the payable falls in, and the change means the document no longer backs the value on the record.",
        action:
            "Check the date printed on the document and keep whichever is right.",
        tier: "check",
    },
    invoice_no_edited: {
        label:
            "Invoice number was changed from what AI read",
        gate: "Gate 4 · submitted = extracted",
        detail:
            "Gate 4 requires the submitted invoice number to match the AI-extracted one exactly. It was changed after extraction.",
        impact:
            "The duplicate check keys off exactly this number, so an edited one can hide a bill that is already in the system — and the AI's reading no longer supports what was entered.",
        action:
            "Compare the number on the attached document with the record and keep whichever is right.",
        tier: "check",
    },
    supplier_gstin_not_extracted: {
        label:
            "AI couldn't find a supplier GSTIN",
        gate: "Gate 6 · supplier GSTIN",
        detail:
            "Gate 6 needs a supplier GSTIN from the document to match against the vendor master. The AI found none.",
        impact:
            "Nothing has confirmed this bill actually came from the vendor on the PO. Not evidence of a problem — some documents simply do not print it legibly — but an unconfirmed one.",
        action:
            "Find the supplier GSTIN on the document and confirm it is the right vendor.",
        tier: "check",
    },
    receiver_gstin_not_extracted: {
        label:
            "AI couldn't find a receiver GSTIN",
        gate: "Gate 7 · receiver GSTIN",
        detail:
            "Gate 7 needs a receiver (bill-to) GSTIN from the document to match against the project's GSTIN. The AI found none.",
        impact:
            "Nothing has confirmed the invoice is addressed to the right entity, which is what the GST input credit depends on.",
        action:
            "Check the bill-to block on the document matches the project's GSTIN.",
        tier: "check",
    },
    amounts_incomplete: {
        label:
            "AI couldn't read enough amounts to cross-check",
        gate: "Gate 5 · intrinsic validity",
        detail:
            "Gate 5 needs net, tax and total together to cross-check that the invoice adds up. At least one of the three was missing from the extraction.",
        impact:
            "The arithmetic check never ran, so nothing has verified that the total being approved is internally consistent. Under the strict policy an unrun check counts as unpassed.",
        action:
            "Eyeball the net, tax and total on the document before approving.",
        tier: "check",
    },

    // --- Info: master-data gaps, not invoice problems ----------------------
    source_file_url_missing: {
        label:
            "Upload predates file-swap tracking",
        gate: "Gate 13 · file-swap guard",
        detail:
            "Gate 13 compares the file the AI read against the file on the record. The URL the extraction ran on was never recorded, so the comparison could not run.",
        impact:
            "It blocks because an unrun swap check cannot be treated as a passed one — but there is no evidence of a swap either. Mostly older uploads from before this tracking existed.",
        action:
            "Nothing to fix in master data. Just confirm the attached document is the one the values came from.",
        tier: "info",
    },
    vendor_gst_not_configured: {
        label:
            "Vendor master has no GSTIN — fix on the vendor",
        gate: "Gate 6 · supplier GSTIN",
        detail:
            "Gate 6 matches the invoice's supplier GSTIN against the vendor master's GSTIN. The vendor master has none recorded.",
        impact:
            "With nothing to match against, the system cannot confirm the bill came from this vendor — so the check fails on missing master data, not on anything the invoice did wrong.",
        action:
            "Add the GSTIN on the Vendor record. Until that is done, every invoice from this vendor will stop here.",
        tier: "info",
    },
    project_gst_not_configured: {
        label:
            "Project has no GSTIN — fix on the project",
        gate: "Gate 7 · receiver GSTIN",
        detail:
            "Gate 7 matches the invoice's receiver GSTIN against the project GSTIN carried on the PO. The PO has none.",
        impact:
            "There is nothing to confirm the invoice was billed to the right Nirmaan entity, so the check cannot pass — again a master-data gap rather than an invoice fault.",
        action:
            "Set the project GSTIN on the Project / PO. Until then every invoice on this project will stop here.",
        tier: "info",
    },
    po_total_invalid: {
        label:
            "PO has no valid total to check against",
        gate: "Gate 9 · PO value ceiling",
        detail:
            "Gate 9 compares cumulative invoicing against the PO's total value. This PO has no usable total — zero or missing.",
        impact:
            "The over-billing ceiling could not be applied at all, so there is no upper bound the system could have approved within.",
        action:
            "Fix the total on the PO. A data problem on the order, not on this invoice.",
        tier: "info",
    },

    // --- Legacy: retired gate, historical rows only ------------------------
    low_confidence_amount: {
        label:
            "Low AI confidence on amount (retired check)",
        gate: "Gate 5 · retired confidence check",
        detail:
            "The retired version of gate 5 blocked any invoice where the extractor reported low confidence on the AMOUNT it read.",
        impact:
            "It blocked auto-approval when the invoice was created. The gate was replaced because a generative extractor self-reports near-100% confidence on everything, which made the signal meaningless rather than reassuring.",
        action:
            "Nothing to act on. Amounts are now checked by reconciliation (net + tax = total) instead. Only appears on invoices created before the change.",
        tier: "legacy",
    },
    low_confidence_invoice_date: {
        label:
            "Low AI confidence on date (retired check)",
        gate: "Gate 5 · retired confidence check",
        detail:
            "The retired version of gate 5 blocked any invoice where the extractor reported low confidence on the DATE it read.",
        impact:
            "It blocked auto-approval at creation time, and was retired with the rest of the confidence gate for the same reason — self-reported confidence carried no information.",
        action:
            "Nothing to act on. The date is now checked for being unparseable or in the future. Only appears on older invoices.",
        tier: "legacy",
    },
    low_confidence_invoice_no: {
        label:
            "Low AI confidence on invoice no. (retired check)",
        gate: "Gate 5 · retired confidence check",
        detail:
            "The retired version of gate 5 blocked any invoice where the extractor reported low confidence on the INVOICE NUMBER it read.",
        impact:
            "It blocked auto-approval at creation time, and was retired with the rest of the confidence gate — the score did not track whether the reading was actually right.",
        action:
            "Nothing to act on. The number is now checked by exact match against what was submitted, plus the duplicate search. Only appears on older invoices.",
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

/**
 * Tokens for gates that have been REMOVED from `_auto_approve.py` — dropped on
 * sight, never rendered, never counted.
 *
 * This is not the same as the `legacy` tier. A legacy token (the three
 * `low_confidence_*`) records a check that was real when it ran and was
 * replaced by a better one, so historical rows still deserve to show it. A
 * retired token records a check we decided should never have blocked: showing
 * it on old rows would keep asking reviewers to act on a signal the system has
 * stopped believing.
 *
 * `po_number_mismatch` (gate 8's match half, removed 2026-08-19) sits on 140
 * live invoices — 118 Approved, 22 Pending. None carries it as its only reason,
 * so dropping it never turns a flagged invoice into a silently clean one.
 *
 * The raw token stays in `auto_approve_skip_reasons` in the database; this only
 * governs what a reviewer is asked to act on.
 */
export const RETIRED_REASONS: ReadonlySet<string> = new Set(["po_number_mismatch"]);

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

/** Resolves one token to its full write-up, with the humanized fallback. */
export const describeReason = (token: string): AutoApproveReason => {
    const known = AUTO_APPROVE_REASON_LABELS[token];
    if (known) return { token, ...known };
    return {
        token,
        label: humanizeReasonToken(token),
        gate: "Unmapped gate",
        detail:
            "A gate this screen has no write-up for yet — either newer than this key, or retired before the key was updated.",
        impact:
            "The invoice was held back for manual review, but nothing here can tell you what the machine objected to, so treat every field on it as unverified.",
        action:
            "Check the invoice against its document by hand, and ask for this reason to be added to the key.",
        tier: "check",
    };
};

/** Display order for the tiers — most actionable first. */
export const REASON_TIER_ORDER: readonly ReasonTier[] = [
    "blocker",
    "check",
    "info",
    "eligibility",
    "legacy",
] as const;

/**
 * Every reason this screen knows about, grouped by tier in display order — the
 * catalogue behind the reason key above the pending table.
 *
 * Reads straight off AUTO_APPROVE_REASON_LABELS, so a token added to (or
 * commented out of) the map appears in (or vanishes from) the key with it.
 */
export const listReasonsByTier = (): Array<{
    tier: ReasonTier;
    reasons: AutoApproveReason[];
}> =>
    REASON_TIER_ORDER.map((tier) => ({
        tier,
        reasons: Object.entries(AUTO_APPROVE_REASON_LABELS)
            .filter(([, entry]) => entry.tier === tier)
            .map(([token, entry]) => ({ token, ...entry })),
    })).filter((group) => group.reasons.length > 0);

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
        // Retired gates are dropped outright — not tiered, not counted as
        // suppressed, because there is nothing left to act on.
        if (RETIRED_REASONS.has(token)) continue;
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

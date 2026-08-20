import { describe, expect, it } from "vitest";
import {
    AUTO_APPROVE_REASON_LABELS,
    MANUAL_ENTRY_CASCADE,
    describeApprovalNarrative,
    describeReason,
    humanizeReasonToken,
    listReasonsByTier,
    REASON_TIER_ORDER,
    RETIRED_REASONS,
    parseSkipReasons,
    summariseSkipReasons,
} from "./autoApproveReasons";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

const inv = (
    reasons: string | undefined,
    status: VendorInvoice["status"] = "Pending",
    autoApproved: 0 | 1 = 0
) =>
    ({
        auto_approve_skip_reasons: reasons,
        status,
        auto_approved: autoApproved,
    }) as Pick<
        VendorInvoice,
        "auto_approve_skip_reasons" | "status" | "auto_approved"
    >;

describe("parseSkipReasons", () => {
    it("splits the stored comma-joined list", () => {
        expect(parseSkipReasons("duplicate_invoice_no,nothing_delivered_yet")).toEqual([
            "duplicate_invoice_no",
            "nothing_delivered_yet",
        ]);
    });

    it("trims whitespace and drops blanks", () => {
        expect(parseSkipReasons(" a , , b ,")).toEqual(["a", "b"]);
    });

    it.each([undefined, null, ""])("returns [] for %p", (input) => {
        expect(parseSkipReasons(input as string | undefined)).toEqual([]);
    });
});

describe("describeReason", () => {
    it("resolves a known token to its label, gate, breakdown and tier", () => {
        const r = describeReason("invoice_date_in_future");
        expect(r.token).toBe("invoice_date_in_future");
        expect(r.label).toBe("Invoice is dated in the future");
        expect(r.tier).toBe("blocker");
        expect(r.gate).toContain("Gate 11");
        expect(r.detail).toContain("later than today");
        expect(r.impact).toContain("tax period");
        expect(r.action).toContain("document");
    });

    // Silently dropping an unrecognised reason would hide real signal.
    it("humanizes an unknown token as a visible check", () => {
        const r = describeReason("some_future_gate");
        expect(r.token).toBe("some_future_gate");
        expect(r.label).toBe("Some future gate");
        expect(r.tier).toBe("check");
        // The key still says something useful rather than rendering blank.
        expect(r.detail.length).toBeGreaterThan(0);
        expect(r.impact.length).toBeGreaterThan(0);
        expect(r.action.length).toBeGreaterThan(0);
    });

    it("keeps the retired low-confidence tokens readable", () => {
        expect(describeReason("low_confidence_amount").tier).toBe("legacy");
        expect(describeReason("low_confidence_amount").label).toContain("retired");
    });
});

describe("humanizeReasonToken", () => {
    it("converts snake_case to a sentence", () => {
        expect(humanizeReasonToken("would_exceed_po_total")).toBe("Would exceed po total");
    });
});

describe("summariseSkipReasons", () => {
    it("returns the empty summary when nothing is recorded", () => {
        const s = summariseSkipReasons(inv(undefined));
        expect(s.flags).toEqual([]);
        expect(s.eligibility).toEqual([]);
        expect(s.highestTier).toBeNull();
    });

    it("splits eligibility away from real flags", () => {
        const s = summariseSkipReasons(inv("not_procurement_order,nothing_delivered_yet"));
        expect(s.eligibility.map((r) => r.token)).toEqual(["not_procurement_order"]);
        expect(s.flags.map((r) => r.token)).toEqual(["nothing_delivered_yet"]);
    });

    it("ranks blockers above checks above info", () => {
        const s = summariseSkipReasons(
            inv("source_file_url_missing,nothing_delivered_yet,duplicate_invoice_no")
        );
        expect(s.flags.map((r) => r.tier)).toEqual(["blocker", "check", "info"]);
        expect(s.highestTier).toBe("blocker");
    });

    // The headline case: VI-2026-04669, a hand-typed Work Order invoice.
    it("collapses the real 12-token manual-entry cascade to zero flags", () => {
        const s = summariseSkipReasons(
            inv(
                "autofill_not_used,not_procurement_order,invoice_no_edited," +
                "invoice_date_edited,invoice_amount_edited,low_confidence_invoice_no," +
                "low_confidence_invoice_date,low_confidence_amount," +
                "supplier_gstin_not_extracted,receiver_gstin_not_extracted," +
                "po_number_not_extracted,source_file_url_missing"
            )
        );
        expect(s.isManualEntry).toBe(true);
        expect(s.flags).toEqual([]);
        expect(s.eligibility.map((r) => r.token)).toEqual([
            "autofill_not_used",
            "not_procurement_order",
        ]);
        expect(s.suppressedCount).toBe(10);
        expect(s.highestTier).toBeNull();
    });

    it("keeps cascade tokens when the invoice WAS autofilled", () => {
        const s = summariseSkipReasons(inv("po_number_not_extracted,invoice_amount_edited"));
        expect(s.isManualEntry).toBe(false);
        expect(s.suppressedCount).toBe(0);
        expect(s.flags).toHaveLength(2);
    });

    // A mismatch is unreachable without an extraction, so seeing one on a
    // manual invoice is anomalous and must survive the collapse.
    it.each([
        "supplier_gstin_mismatch",
        "receiver_gstin_mismatch",
        "file_swap_detected",
    ])("never suppresses %s on a manual entry", (token) => {
        const s = summariseSkipReasons(inv(`autofill_not_used,${token}`));
        expect(s.flags.map((r) => r.token)).toEqual([token]);
    });

    // Delivery state is real regardless of how the invoice was entered.
    it("never suppresses delivery-based flags on a manual entry", () => {
        const s = summariseSkipReasons(
            inv("autofill_not_used,nothing_delivered_yet,would_exceed_delivered")
        );
        expect(s.flags.map((r) => r.token).sort()).toEqual([
            "nothing_delivered_yet",
            "would_exceed_delivered",
        ]);
    });

    it("handles the common live shapes", () => {
        // VI-2026-05100 — two tokens stored, but po_number_mismatch is retired,
        // so a reviewer is left with the one flag that still means something.
        expect(
            summariseSkipReasons(inv("po_number_mismatch,nothing_delivered_yet")).flags
        ).toHaveLength(1);
        // VI-2026-05103 — the single most common reason in production
        const single = summariseSkipReasons(inv("nothing_delivered_yet"));
        expect(single.flags).toHaveLength(1);
        expect(single.highestTier).toBe("check");
    });
});

describe("map integrity", () => {
    it("has no token in both the cascade set and the eligibility tier", () => {
        for (const token of MANUAL_ENTRY_CASCADE) {
            expect(AUTO_APPROVE_REASON_LABELS[token]?.tier).not.toBe("eligibility");
        }
    });

    it("only lists known tokens in the cascade set", () => {
        for (const token of MANUAL_ENTRY_CASCADE) {
            expect(AUTO_APPROVE_REASON_LABELS[token]).toBeDefined();
        }
    });

    it("gives every mapped token a non-empty label", () => {
        for (const [token, entry] of Object.entries(AUTO_APPROVE_REASON_LABELS)) {
            expect(entry.label.length, token).toBeGreaterThan(0);
        }
    });

    // The reason key is only worth opening if every chip explains itself.
    it("gives every mapped token a real breakdown, not a restated label", () => {
        for (const [token, entry] of Object.entries(AUTO_APPROVE_REASON_LABELS)) {
            for (const part of ["detail", "impact", "action"] as const) {
                expect(entry[part].length, `${token}.${part}`).toBeGreaterThan(40);
                expect(entry[part], `${token}.${part}`).not.toBe(entry.label);
            }
            // The three parts answer different questions — never the same text.
            expect(new Set([entry.detail, entry.impact, entry.action]).size, token).toBe(3);
        }
    });

    // The gate tag is what lets a reviewer trace a flag back to _auto_approve.py.
    it("tags every mapped token with the gate that recorded it", () => {
        for (const [token, entry] of Object.entries(AUTO_APPROVE_REASON_LABELS)) {
            expect(entry.gate, token).toMatch(/^Gate \d+ · /);
        }
    });
});

describe("listReasonsByTier", () => {
    it("covers every mapped token exactly once", () => {
        const listed = listReasonsByTier().flatMap((g) => g.reasons.map((r) => r.token));
        expect(listed.slice().sort()).toEqual(
            Object.keys(AUTO_APPROVE_REASON_LABELS).sort()
        );
    });

    it("groups in severity order and never returns an empty group", () => {
        const groups = listReasonsByTier();
        const order = groups.map((g) => g.tier);
        expect(order).toEqual(REASON_TIER_ORDER.filter((t) => order.includes(t)));
        for (const g of groups) expect(g.reasons.length).toBeGreaterThan(0);
    });

    it("carries the tier down onto each reason", () => {
        for (const g of listReasonsByTier()) {
            for (const r of g.reasons) expect(r.tier, r.token).toBe(g.tier);
        }
    });
});

describe("retired reasons", () => {
    it("is gone from the catalogue entirely", () => {
        for (const token of RETIRED_REASONS) {
            expect(AUTO_APPROVE_REASON_LABELS[token], token).toBeUndefined();
        }
        const listed = listReasonsByTier().flatMap((g) => g.reasons.map((r) => r.token));
        for (const token of RETIRED_REASONS) expect(listed).not.toContain(token);
    });

    it("drops the token from the flags a reviewer sees", () => {
        const s = summariseSkipReasons(inv("po_number_mismatch,duplicate_invoice_no"));
        expect(s.flags.map((r) => r.token)).toEqual(["duplicate_invoice_no"]);
    });

    // Not "suppressed" — suppression is the manual-entry cascade note, and this
    // did not get folded into anything. It simply no longer exists.
    it("does not count as a suppressed cascade token", () => {
        const s = summariseSkipReasons(inv("autofill_not_used,po_number_mismatch"));
        expect(s.suppressedCount).toBe(0);
        expect(s.flags).toEqual([]);
    });

    // No live invoice carries it alone (checked against 140 rows), but the
    // degenerate case must still read honestly rather than as a flagged one.
    it("reads as clean when it was the only reason recorded", () => {
        const i = inv("po_number_mismatch", "Pending", 0);
        const s = summariseSkipReasons(i);
        expect(s.flags).toEqual([]);
        expect(describeApprovalNarrative(i, s)).toBe("clean");
    });
});

describe("describeApprovalNarrative", () => {
    it("reports an auto-approved invoice", () => {
        const i = inv(undefined, "Approved", 1);
        expect(describeApprovalNarrative(i, summariseSkipReasons(i))).toBe("auto");
    });

    // 116 already-Approved invoices carry a blocker-grade flag a human waved past.
    it("reports a human approval that carried flags", () => {
        const i = inv("duplicate_invoice_no", "Approved", 0);
        expect(describeApprovalNarrative(i, summariseSkipReasons(i))).toBe(
            "approved-with-flags"
        );
    });

    it("reports a flagged pending invoice", () => {
        const i = inv("nothing_delivered_yet", "Pending", 0);
        expect(describeApprovalNarrative(i, summariseSkipReasons(i))).toBe("flagged");
    });

    it("reports a clean invoice", () => {
        const i = inv(undefined, "Pending", 0);
        expect(describeApprovalNarrative(i, summariseSkipReasons(i))).toBe("clean");
    });
});

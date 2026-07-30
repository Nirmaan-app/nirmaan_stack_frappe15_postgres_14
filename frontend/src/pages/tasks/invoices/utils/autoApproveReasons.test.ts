import { describe, expect, it } from "vitest";
import {
    AUTO_APPROVE_REASON_LABELS,
    MANUAL_ENTRY_CASCADE,
    describeApprovalNarrative,
    describeReason,
    humanizeReasonToken,
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
        expect(parseSkipReasons("po_number_mismatch,nothing_delivered_yet")).toEqual([
            "po_number_mismatch",
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
    it("resolves a known token to its label and tier", () => {
        expect(describeReason("invoice_date_in_future")).toEqual({
            token: "invoice_date_in_future",
            label: "Invoice is dated in the future",
            tier: "blocker",
        });
    });

    // Silently dropping an unrecognised reason would hide real signal.
    it("humanizes an unknown token as a visible check", () => {
        expect(describeReason("some_future_gate")).toEqual({
            token: "some_future_gate",
            label: "Some future gate",
            tier: "check",
        });
    });

    it("keeps the retired low-confidence tokens readable", () => {
        expect(describeReason("low_confidence_amount").tier).toBe("legacy");
        expect(describeReason("low_confidence_amount").label).toContain("retired");
    });
});

describe("humanizeReasonToken", () => {
    it("converts snake_case to a sentence", () => {
        expect(humanizeReasonToken("po_number_mismatch")).toBe("Po number mismatch");
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
        "po_number_mismatch",
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
        // VI-2026-05100
        expect(
            summariseSkipReasons(inv("po_number_mismatch,nothing_delivered_yet")).flags
        ).toHaveLength(2);
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
});

describe("describeApprovalNarrative", () => {
    it("reports an auto-approved invoice", () => {
        const i = inv(undefined, "Approved", 1);
        expect(describeApprovalNarrative(i, summariseSkipReasons(i))).toBe("auto");
    });

    // 116 already-Approved invoices carry a blocker-grade flag a human waved past.
    it("reports a human approval that carried flags", () => {
        const i = inv("po_number_mismatch", "Approved", 0);
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

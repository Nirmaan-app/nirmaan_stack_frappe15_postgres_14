import { describe, expect, it } from "vitest";
import {
    AUTO_APPROVE_REASON_LABELS,
    MANUAL_ENTRY_CASCADE,
    describeApprovalNarrative,
    describeReason,
    humanizeReasonToken,
    isDailyWorkOrderReason,
    listReasonsByTier,
    REASON_TIER_ORDER,
    parseSkipReasons,
    summariseSkipReasons,
    WORK_ORDER_REASONS,
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

// ADR-0050 decision 8: a Work Order invoice's reasons say why not, with the two figures each compared.
describe("Work Order reasons", () => {
    it("shows the WO total against the Approved invoices plus this one", () => {
        const r = describeReason("wo_total_mismatch:100000.00:30000.00");
        expect(r.token).toBe("wo_total_mismatch:100000.00:30000.00");
        expect(r.label).toBe("Invoices + this ₹30,000 ≠ WO total ₹1,00,000");
        expect(r.tier).toBe("check");
    });

    it("shows Amount Paid against the same", () => {
        expect(describeReason("wo_paid_mismatch:40000.00:30000.50").label).toBe(
            "Invoices + this ₹30,001 ≠ Amount Paid ₹40,000"
        );
    });

    it("shows base against base on a GST-on Work Order", () => {
        expect(describeReason("wo_base_paid_mismatch:60000.00:50000.00").label).toBe(
            "Base invoiced + this ₹50,000 ≠ base paid ₹60,000"
        );
    });

    it("names an unsigned generated invoice upload", () => {
        expect(describeReason("wo_generated_copy_not_signed").label).toBe("Generated invoice not signed");
    });

    it("lists each in the key without figures", () => {
        const tokens = listReasonsByTier().flatMap((g) => g.reasons.map((r) => r.token));
        expect(tokens).toEqual(expect.arrayContaining(["wo_total_mismatch", "wo_paid_mismatch",
            "wo_base_paid_mismatch", "wo_generated_copy_not_signed"]));
    });

    it("says the daily re-check takes the figure reasons, not an unsigned copy's", () => {
        expect(isDailyWorkOrderReason("wo_paid_mismatch:40000.00:30000.00")).toBe(true);
        expect(isDailyWorkOrderReason("wo_base_paid_mismatch:1.00:2.00")).toBe(true);
        expect(isDailyWorkOrderReason("wo_generated_copy_not_signed")).toBe(false);
        expect(isDailyWorkOrderReason("nothing_delivered_yet")).toBe(false);
    });

    it("flags a Work Order invoice's reasons in the summary", () => {
        const s = summariseSkipReasons(inv("wo_total_mismatch:100000.00:30000.00,wo_paid_mismatch:40000.00:30000.00"));
        expect(s.flags.map((r) => r.label)).toEqual([
            "Invoices + this ₹30,000 ≠ WO total ₹1,00,000",
            "Invoices + this ₹30,000 ≠ Amount Paid ₹40,000",
        ]);
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

    // The headline case: VI-2026-04669, a hand-typed Work Order invoice. It
    // stored 12 tokens; retire_po_number_gate.py erased the gate-8 one, so the
    // shape a reviewer can actually meet today is the 11 below.
    it("collapses the real manual-entry cascade to zero flags", () => {
        const s = summariseSkipReasons(
            inv(
                "autofill_not_used,not_procurement_order,invoice_no_edited," +
                "invoice_date_edited,invoice_amount_edited,low_confidence_invoice_no," +
                "low_confidence_invoice_date,low_confidence_amount," +
                "supplier_gstin_not_extracted,receiver_gstin_not_extracted," +
                "source_file_url_missing"
            )
        );
        expect(s.isManualEntry).toBe(true);
        expect(s.flags).toEqual([]);
        expect(s.eligibility.map((r) => r.token)).toEqual([
            "autofill_not_used",
            "not_procurement_order",
        ]);
        expect(s.suppressedCount).toBe(9);
        expect(s.highestTier).toBeNull();
    });

    it("keeps cascade tokens when the invoice WAS autofilled", () => {
        const s = summariseSkipReasons(
            inv("supplier_gstin_not_extracted,invoice_amount_edited")
        );
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
    // A PO invoice's reasons come from numbered gates; a Work Order invoice's from ADR-0050's three rules.
    it("tags every mapped token with the gate or Work Order rule that recorded it", () => {
        for (const [token, entry] of Object.entries(AUTO_APPROVE_REASON_LABELS)) {
            expect(entry.gate, token).toMatch(/^(Gate|WO rule) \d+ · /);
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

    const tokensOf = (documentType: "Procurement Orders" | "Service Requests") =>
        listReasonsByTier(documentType).flatMap((g) => g.reasons.map((r) => r.token));

    it("lists only the Work Order rules' reasons on the WO tab (ADR-0050)", () => {
        expect(tokensOf("Service Requests").sort()).toEqual([
            "wo_base_paid_mismatch",
            "wo_generated_copy_not_signed",
            "wo_paid_mismatch",
            "wo_total_mismatch",
        ]);
    });

    it("lists no Work Order reason on the PO tab, and every PO gate's", () => {
        const po = tokensOf("Procurement Orders");
        expect(po.filter((t) => WORK_ORDER_REASONS.has(t))).toEqual([]);
        expect(po).not.toContain("not_procurement_order");
        expect(po).toEqual(expect.arrayContaining(["would_exceed_delivered", "supplier_gstin_mismatch",
            "autofill_not_used"]));
    });

    it("splits the catalogue between the two tabs, leaving out only the retired not_procurement_order", () => {
        const both = [...tokensOf("Procurement Orders"), ...tokensOf("Service Requests")].sort();
        expect(both).toEqual(Object.keys(AUTO_APPROVE_REASON_LABELS).filter((t) => t !== "not_procurement_order").sort());
    });
});

describe("the removed PO-number gate", () => {
    // Gate 8 is gone from _auto_approve.py and its two tokens are erased from
    // the database by patches/v3_0/retire_po_number_gate.py, so no invoice can
    // present one again. There is no deny-list guarding this any more — the
    // catalogue simply has no entry, which is what this pins.
    it.each(["po_number_mismatch", "po_number_not_extracted"])(
        "has no catalogue entry for %s",
        (token) => {
            expect(AUTO_APPROVE_REASON_LABELS[token]).toBeUndefined();
            const listed = listReasonsByTier().flatMap((g) =>
                g.reasons.map((r) => r.token)
            );
            expect(listed).not.toContain(token);
        }
    );

    // The safety net if a row somehow survives the patch: it does NOT vanish.
    // An unmapped token falls through to the humanized `check` fallback, so the
    // reviewer sees something to chase rather than a silently clean invoice.
    it("still surfaces the token if a row somehow survives the patch", () => {
        const s = summariseSkipReasons(inv("po_number_not_extracted"));
        expect(s.flags.map((r) => r.token)).toEqual(["po_number_not_extracted"]);
        expect(s.flags[0].gate).toBe("Unmapped gate");
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

describe("the Work Order reasons' labels read in words (owner, 2026-11-25)", () => {
    const labels = Object.fromEntries(
        listReasonsByTier("Service Requests").flatMap((g) => g.reasons).map((r) => [r.token, r.label])
    );

    it("not '+ this' and '≠'", () => {
        expect(labels).toEqual({
            wo_total_mismatch: "Invoiced doesn't match WO total",
            wo_paid_mismatch: "Invoiced doesn't match Amount Paid",
            wo_base_paid_mismatch: "Base invoiced doesn't match base paid",
            wo_generated_copy_not_signed: "Generated invoice not signed",
        });
    });
});

import { describe, expect, it } from "vitest";
import { daysOutstanding, summariseChequeStatuses } from "./chequePaymentTable.config";
import { ChequePaymentRow, ListDocs, loadChequeExtras } from "../utils/chequePaymentExtras";

describe("summariseChequeStatuses", () => {
    it("folds per-status sums into the four buckets", () => {
        const s = summariseChequeStatuses(
            [
                { group_key: "Requested", aggregate_value: 100 },
                { group_key: "CEO Pending", aggregate_value: 50 },
                { group_key: "Approved", aggregate_value: 10 },
                { group_key: "Reconciliation Pending", aggregate_value: 20 },
                { group_key: "Paid", aggregate_value: 300 },
                { group_key: "Rejected", aggregate_value: 7 },
            ],
            { sum_of_amount: 487 },
            9,
        );
        expect(s.total).toEqual({ count: 9, amount: 487 });
        expect(s.buckets).toEqual({ awaiting: 150, issued: 30, cleared: 300, rejected: 7 });
    });

    it("reads a missing payload as zero, never NaN", () => {
        const s = summariseChequeStatuses(null, null, 0);
        expect(s.total).toEqual({ count: 0, amount: 0 });
        expect(s.buckets).toEqual({ awaiting: 0, issued: 0, cleared: 0, rejected: 0 });
    });

    it("ignores a status outside every bucket", () => {
        const s = summariseChequeStatuses([{ group_key: "Something Else", aggregate_value: 99 }], null, 1);
        expect(s.buckets).toEqual({ awaiting: 0, issued: 0, cleared: 0, rejected: 0 });
    });
});

describe("daysOutstanding", () => {
    const today = new Date(2026, 9, 6); // 6-Oct-2026, local

    it("counts days since the cheque date while not cleared", () => {
        expect(daysOutstanding({ status: "Reconciliation Pending", cheque_date: "2026-09-26" }, today)).toBe(10);
        expect(daysOutstanding({ status: "Requested", cheque_date: "2026-10-06" }, today)).toBe(0);
    });

    it("is null once Paid or Rejected, or with no cheque date", () => {
        expect(daysOutstanding({ status: "Paid", cheque_date: "2026-01-01" }, today)).toBeNull();
        expect(daysOutstanding({ status: "Rejected", cheque_date: "2026-01-01" }, today)).toBeNull();
        expect(daysOutstanding({ status: "Approved", cheque_date: undefined }, today)).toBeNull();
    });

    it("goes negative for a post-dated cheque", () => {
        expect(daysOutstanding({ status: "Approved", cheque_date: "2026-10-16" }, today)).toBe(-10);
    });
});

const row = (over: Partial<ChequePaymentRow>): ChequePaymentRow =>
    ({ name: "PAY-1", document_type: "Procurement Orders", document_name: "PO/1", status: "Approved", amount: 0, ...over }) as ChequePaymentRow;

describe("loadChequeExtras", () => {
    it("joins PO / WO figures, TDS and the per-cheque count onto each row", async () => {
        const calls: { doctype: string; filters: unknown[] }[] = [];
        const listDocs: ListDocs = async (doctype, _fields, filters) => {
            calls.push({ doctype, filters });
            if (doctype === "Procurement Orders")
                return [{ name: "PO/1", status: "Dispatched", total_amount: 1000, amount_paid: 400, amount_invoiced: 600 }];
            if (doctype === "Service Requests")
                return [{ name: "SR-1", status: "Approved", total_amount: "2000", amount_paid: 0, amount_invoiced: null }];
            if (doctype === "Payment TDS Deduction") return [{ project_payment: "PAY-2", tds_amount: 20 }];
            if (doctype === "Project Payments")
                return [{ name: "PAY-1", cheque_no: "9000" }, { name: "PAY-3", cheque_no: "9000" }, { name: "PAY-2", cheque_no: "123" }];
            return [];
        };
        const extras = await loadChequeExtras(
            [
                row({ name: "PAY-1", cheque_no: "9000" }),
                row({ name: "PAY-2", document_type: "Service Requests", document_name: "SR-1", cheque_no: " 123 " }),
            ],
            listDocs,
        );
        expect(extras.get("PAY-1")).toEqual({
            order: { status: "Dispatched", total_amount: 1000, amount_paid: 400, amount_invoiced: 600 },
            tds: 0,
            chequePaymentCount: 2,
        });
        expect(extras.get("PAY-2")).toEqual({
            order: { status: "Approved", total_amount: 2000, amount_paid: 0, amount_invoiced: 0 },
            tds: 20,
            chequePaymentCount: 1,
        });
        // Siblings are counted among live cheque payments only.
        const siblingCall = calls.find((c) => c.doctype === "Project Payments")!;
        expect(siblingCall.filters).toContainEqual(["mode_of_payment", "=", "Cheque"]);
        expect(siblingCall.filters).toContainEqual(["status", "!=", "Rejected"]);
    });

    it("splits a long name list so no single IN carries more than 500 values", async () => {
        const sizes: number[] = [];
        const listDocs: ListDocs = async (doctype, _fields, filters) => {
            if (doctype === "Procurement Orders") {
                const inFilter = filters.find((f) => Array.isArray(f) && f[1] === "in") as [string, string, string[]];
                sizes.push(inFilter[2].length);
            }
            return [];
        };
        const rows = Array.from({ length: 1201 }, (_, i) => row({ name: `PAY-${i}`, document_name: `PO/${i}` }));
        await loadChequeExtras(rows, listDocs);
        expect(sizes.sort((a, b) => a - b)).toEqual([201, 500, 500]);
    });

    it("makes no call for an empty page", async () => {
        let called = false;
        await loadChequeExtras([], async () => {
            called = true;
            return [];
        });
        expect(called).toBe(false);
    });
});

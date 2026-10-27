import { describe, expect, it } from "vitest";

import type { ApprovalColumnCtx } from "./approvalColumns";
import { buildApprovalExportColumns } from "./approvalExportColumns";
import type { ApprovalQueueRow } from "./approvalsTable.config";
import { PP_TABS } from "./ppTabs.constants";

const ctx: ApprovalColumnCtx = { tab: PP_TABS.NEW_PAYMENTS, projectLabels: new Map(), vendorLabels: new Map() };

/** The CSV "Cheque" cell for a payment row. */
const chequeCell = (row: Partial<ApprovalQueueRow>): unknown => {
    const column = buildApprovalExportColumns(ctx).find((c) => c.id === "cheque");
    const exportValue = (column?.meta as { exportValue: (r: ApprovalQueueRow) => unknown }).exportValue;
    return exportValue({ utr_ref: "", cheque_no: "", cheque_status: "", ...row } as ApprovalQueueRow);
};

describe("the CSV Cheque column", () => {
    it("writes the cheque chip's text for a payment on a Cheque", () => {
        expect(chequeCell({ status: "Approved", cheque_no: "004521", cheque_status: "Issued" })).toBe(
            "Cheque 004521 · Issued",
        );
    });

    it("is blank on an Online payment", () => {
        expect(chequeCell({ status: "Approved" })).toBe("");
    });

    it("is blank on a Rejected payment, as its chip is: it has dropped off its Cheque", () => {
        expect(chequeCell({ status: "Rejected", cheque_no: "004521", cheque_status: "Issued" })).toBe("");
    });
});

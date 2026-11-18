// @vitest-environment jsdom
/**
 * Approve Payments: an Expense an import created shows the SYSTEM tier (#1710, spec #1711). The server sends
 * `tier: "system"` for it; the Tier chip reads SYSTEM in grey and the CSV export writes SYSTEM. The amount tiers are
 * unchanged.
 */
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { buildApprovalColumns, type ApprovalColumnCtx } from "./approvalColumns";
import { buildApprovalExportColumns } from "./approvalExportColumns";
import type { ApprovalQueueRow } from "./approvalsTable.config";
import { PP_TABS } from "./ppTabs.constants";

const ctx: ApprovalColumnCtx = { tab: PP_TABS.PAYMENTS_DONE, projectLabels: new Map(), vendorLabels: new Map() };

const row = (tier: ApprovalQueueRow["tier"]) => ({ name: "NPE-TEST-1", tier }) as unknown as ApprovalQueueRow;

/** The CSV "Tier" cell for a row of this tier. */
const exported = (tier: ApprovalQueueRow["tier"]): unknown => {
    const column = buildApprovalExportColumns(ctx).find((c) => c.id === "tier");
    return (column?.meta as { exportValue: (r: ApprovalQueueRow) => unknown }).exportValue(row(tier));
};

/** The Tier chip a row of this tier renders: its text and its class. */
const chip = (tier: ApprovalQueueRow["tier"]) => {
    const [column] = buildApprovalColumns(["tier"], ctx);
    const Cell = column.cell as (c: { row: { original: ApprovalQueueRow } }) => ReactElement;
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(Cell({ row: { original: row(tier) } })));
    const span = container.querySelector("span");
    const shown = { text: span?.textContent, className: span?.className ?? "" };
    act(() => root.unmount());
    return shown;
};

describe("the SYSTEM tier", () => {
    it("the chip reads SYSTEM, in grey", () => {
        const shown = chip("system");
        expect(shown.text).toBe("SYSTEM");
        expect(shown.className).toMatch(/bg-gray-100/);
    });

    it("the export writes SYSTEM", () => {
        expect(exported("system")).toBe("SYSTEM");
    });

    it("the amount tiers read as before", () => {
        expect([chip("auto").text, chip("l1").text, chip("l1_l2").text]).toEqual(["AUTO", "L1", "L1+L2"]);
        expect([exported("auto"), exported("l1"), exported("l1_l2")]).toEqual(["AUTO", "L1", "L1+L2"]);
    });
});

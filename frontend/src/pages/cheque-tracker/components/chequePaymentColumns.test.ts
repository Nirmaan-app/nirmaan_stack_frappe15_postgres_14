import { describe, expect, it, vi } from "vitest";

// The site URL reads `window` at import; these node tests only read the column definitions.
vi.mock("@/constants/siteURL", () => ({ default: "" }));

import { CHEQUE_DATE_COLUMNS } from "../config/chequePaymentTable.config";
import { getChequePaymentColumns } from "./chequePaymentColumns";

const columns = getChequePaymentColumns({ actionsOf: () => [], onOpen: () => {}, onEdit: () => {}, onCancel: () => {} });
const ids = columns.map((c) => ("accessorKey" in c ? String(c.accessorKey) : c.id));
const exportHeaders = columns.map((c) => (c.meta as { exportHeaderName?: string } | undefined)?.exportHeaderName);

// #1520: a Cheque carries one Cheque/Payment Date besides its issue date.
describe("the Cheque Tracker's date columns", () => {
    it("show one Cheque/Payment Date beside the Issue Date", () => {
        const at = ids.indexOf("cheque_date");
        expect(exportHeaders[at]).toBe("Cheque/Payment Date");
        expect(ids[at + 1]).toBe("issue_date");
    });

    it("show no clearance date and no Cleared by", () => {
        expect(ids).not.toContain("clearance_date");
        expect(ids).not.toContain("cleared_by");
        expect(exportHeaders.filter((h) => /clearance|cleared|^cheque date$/i.test(h ?? ""))).toEqual([]);
    });

    it("filter by date on the Cheque/Payment Date, the issue date and when it was made", () => {
        expect(CHEQUE_DATE_COLUMNS).toEqual(["cheque_date", "issue_date", "creation"]);
    });
});

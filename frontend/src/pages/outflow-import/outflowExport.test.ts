import { describe, expect, it } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { EXPORT_ONLY_COLUMNS, exportFileBase, toExportColumns } from "./outflowExport";
import {
    DEFAULT_HIDDEN_COLUMNS,
    OUTFLOW_COLUMNS,
    referenceValue,
    shortReference,
} from "./outflowTableModel";

const row = (over: Partial<OutflowImportRow> = {}): OutflowImportRow =>
    ({
        name: "OFR-0001",
        transfer_id: "CFPAY-2026-000000000091827",
        added_on: "2026-08-11 14:32:07",
        amount: 125000,
        beneficiary_name: "Acme Electricals",
        remarks: "Payment for site 4",
        bank_reference_no: "N123456789012345",
        row_status: "Matched",
        service_charge: 0,
        service_tax: 0,
        matches: [],
        ...over,
    }) as OutflowImportRow;

describe("toExportColumns", () => {
    it("produces one entry per column, in the table's order, then the export-only pair", () => {
        const columns = toExportColumns(OUTFLOW_COLUMNS);
        expect(columns).toHaveLength(OUTFLOW_COLUMNS.length + EXPORT_ONLY_COLUMNS.length);
        // The screen's columns come first, in the screen's order, so somebody comparing a download
        // against the table reads the same sequence.
        expect(columns.slice(0, OUTFLOW_COLUMNS.length).map((c) => c.id)).toEqual(
            OUTFLOW_COLUMNS.map((c) => c.id)
        );
        expect(columns.slice(OUTFLOW_COLUMNS.length).map((c) => c.id)).toEqual([
            "settled_target_name",
            "settled_target_amount",
        ]);
    });

    it("carries the two settlement facts the SCREEN cannot show", () => {
        // ⚠️ These are export-only: `get_outflow_rows` does not select them, only
        // `export_outflow_rows` does. Declaring them in `OUTFLOW_COLUMNS` would render an em dash
        // on every row forever — the `settlement_origin` defect wearing the other face.
        const modelIds = new Set(OUTFLOW_COLUMNS.map((c) => c.id));
        expect(modelIds.has("settled_target_name")).toBe(false);
        expect(modelIds.has("settled_target_amount")).toBe(false);

        const byId = new Map(toExportColumns(OUTFLOW_COLUMNS).map((c) => [c.id, c]));
        expect(byId.get("settled_target_name")!.meta.exportHeaderName).toBe("Settled record");
        expect(byId.get("settled_target_amount")!.meta.exportHeaderName).toBe("Settled amount");

        const settled = row({
            settled_target_name: "PAY-26-00042",
            settled_target_amount: 27504.31,
        });
        expect(byId.get("settled_target_name")!.meta.exportValue(settled)).toBe("PAY-26-00042");
        expect(byId.get("settled_target_amount")!.meta.exportValue(settled)).toBe(27504.31);
    });

    it("leaves an unsettled row BLANK, never zero", () => {
        // 0 is a claim that nothing was owed. An open transfer did not settle nothing — it has not
        // settled YET, and only absence says that.
        const byId = new Map(toExportColumns(OUTFLOW_COLUMNS).map((c) => [c.id, c]));
        const open = row({});
        expect(byId.get("settled_target_name")!.meta.exportValue(open)).toBe("");
        expect(byId.get("settled_target_amount")!.meta.exportValue(open)).toBe("");
        expect(byId.get("settled_target_amount")!.meta.exportValue(row({ settled_target_amount: null }))).toBe("");
    });

    it("names every heading with the column's own title, on both keys the writer reads", () => {
        // `exportToCsv` prefers `meta.exportHeaderName` and falls back to a string `header`.
        // Filling one and not the other would leave the file's headings depending on which branch
        // of the writer ran.
        const mapped = toExportColumns(OUTFLOW_COLUMNS).slice(0, OUTFLOW_COLUMNS.length);
        for (const [i, column] of mapped.entries()) {
            expect(column.header).toBe(OUTFLOW_COLUMNS[i].title);
            expect(column.meta.exportHeaderName).toBe(OUTFLOW_COLUMNS[i].title);
        }
        const byId = new Map(toExportColumns(OUTFLOW_COLUMNS).map((c) => [c.id, c]));
        expect(byId.get("added_on")!.meta.exportHeaderName).toBe("Payment Date");
        expect(byId.get("bank_reference_no")!.meta.exportHeaderName).toBe("Reference");
    });

    it("pulls each cell through the column's own `get`", () => {
        const byId = new Map(toExportColumns(OUTFLOW_COLUMNS).map((c) => [c.id, c]));
        const sample = row();
        expect(byId.get("added_on")!.meta.exportValue(sample)).toBe("2026-08-11");
        expect(byId.get("beneficiary_name")!.meta.exportValue(sample)).toBe("Acme Electricals");
        expect(byId.get("amount")!.meta.exportValue(sample)).toBe(125000);
        expect(byId.get("row_status")!.meta.exportValue(sample)).toBe("Matched");
        expect(byId.get("time")!.meta.exportValue(sample)).toBe("14:32");
    });

    it("EXPORTS THE WHOLE REFERENCE, never the 12-character tail the table shows", () => {
        // ⚠️ THE ONE THAT MATTERS. `shortReference` is display-only; a truncated UTR in an archived
        // file is a reference that finds nothing at the other end.
        const byId = new Map(toExportColumns(OUTFLOW_COLUMNS).map((c) => [c.id, c]));
        const sample = row();
        const exported = byId.get("bank_reference_no")!.meta.exportValue(sample);
        expect(exported).toBe("N123456789012345");
        expect(exported).toBe(referenceValue(sample));
        expect(exported).not.toBe(shortReference(referenceValue(sample)));
    });

    it("carries a Cashbook row's wallet id, which is the reference it has", () => {
        const byId = new Map(toExportColumns(OUTFLOW_COLUMNS).map((c) => [c.id, c]));
        const wallet = row({ bank_reference_no: "", transfer_id: "CB-2026-0000441" });
        expect(byId.get("bank_reference_no")!.meta.exportValue(wallet)).toBe("CB-2026-0000441");
    });

    it("exports the Outcome note, which is all a file can carry of a button", () => {
        const byId = new Map(toExportColumns(OUTFLOW_COLUMNS).map((c) => [c.id, c]));
        expect(
            byId.get("outcome")!.meta.exportValue(row({ outcome_note: "Settled against PAY-0091" }))
        ).toBe("Settled against PAY-0091");
        // Falls back to the skip reason, then to blank — never to `undefined` in a cell.
        expect(
            byId.get("outcome")!.meta.exportValue(
                row({ outcome_note: undefined, skip_reason: "Already recorded as Paid" })
            )
        ).toBe("Already recorded as Paid");
        expect(
            byId.get("outcome")!.meta.exportValue(
                row({ outcome_note: undefined, skip_reason: undefined })
            )
        ).toBe("");
    });

    it("SHIPS THE HIDDEN COLUMNS TOO — a CSV is an archive, not a screenshot", () => {
        // ⚠️ There is no `hidden` parameter at all, so no call site can reintroduce the question.
        const ids = new Set(toExportColumns(OUTFLOW_COLUMNS).map((c) => c.id));
        expect(DEFAULT_HIDDEN_COLUMNS.length).toBeGreaterThan(0);
        for (const hidden of DEFAULT_HIDDEN_COLUMNS) expect(ids.has(hidden)).toBe(true);
        expect(ids.has("bank_account")).toBe(true);
        expect(ids.has("ifsc")).toBe(true);
        expect(ids.has("time")).toBe(true);
        expect(toExportColumns.length).toBe(1);
    });

    it("marks nothing as excluded — every column it is given is exportable", () => {
        for (const column of toExportColumns(OUTFLOW_COLUMNS)) {
            expect((column.meta as Record<string, unknown>).excludeFromExport).toBeUndefined();
        }
    });

    it("does not mutate the model it reads", () => {
        const before = JSON.stringify(OUTFLOW_COLUMNS.map((c) => [c.id, c.title, c.width]));
        toExportColumns(OUTFLOW_COLUMNS);
        expect(JSON.stringify(OUTFLOW_COLUMNS.map((c) => [c.id, c.title, c.width]))).toBe(before);
    });

    it("invents no screen column for an empty model, but still carries the settlement pair", () => {
        // The export-only pair does not come from the screen's model, so it does not disappear with
        // it. Both callers must produce the same file shape whatever they pass.
        expect(toExportColumns([]).map((c) => c.id)).toEqual([
            "settled_target_name",
            "settled_target_amount",
        ]);
    });
});

describe("exportFileBase", () => {
    it("names the scope, because the file itself cannot", () => {
        expect(exportFileBase("all")).toBe("outflow-transfers-all");
        expect(exportFileBase("not_matched")).toBe("outflow-transfers-not-matched");
        expect(exportFileBase("matched")).toBe("outflow-transfers-matched");
        expect(exportFileBase("skipped")).toBe("outflow-skipped");
    });

    it("falls back to the bare stem for a scope this screen does not have", () => {
        // A filename is not the place to discover that a scope was renamed server-side.
        expect(exportFileBase("pending")).toBe("outflow-transfers");
        expect(exportFileBase("")).toBe("outflow-transfers");
    });

    it("adds NO timestamp — `exportToCsv` appends its own", () => {
        for (const scope of ["all", "not_matched", "matched", "skipped", "nonsense"]) {
            expect(exportFileBase(scope)).not.toMatch(/\d/);
        }
    });
});

// src/pages/outflow-import/outflowExport.ts
//
// PURE MODULE -- no React, no fetching, no DOM. The adapter between this screen's own column model
// and the app-wide CSV writer.
//
// ⚠️ IT ADAPTS; IT DOES NOT WRITE. `src/utils/exportToCsv.ts` is the ONE CSV writer in this app --
// it filters the exportable columns, resolves the headers, pulls the cells, unparses and triggers
// the download. This screen has its own `OutflowColumn` model (`outflowTableModel.OUTFLOW_COLUMNS`)
// because its table is hand-rolled rather than a TanStack `DataTable`, so the two shapes do not meet
// on their own. Translating here is what lets the writer stay the single implementation: a second
// one would be free to disagree about quoting, about how a null renders, and about the filename
// convention -- and the symptom, a CSV that opens differently from every other export in the app,
// is invisible to every test on either side (ADR-0010 F1/F3).
//
// ⚠️ NOTHING HERE COUNTS, SORTS OR FORMATS ANYTHING. Every value comes out of `column.get`, which is
// the same function the table's sort, funnels and facet values read, so the file and the screen can
// never disagree about what a cell holds.

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import type { OutflowColumn } from "./outflowTableModel";

/**
 * One column as `exportToCsv` reads it.
 *
 * ⚠️ DECLARED HERE RATHER THAN IMPORTED AS A TanStack `ColumnDef`, deliberately. `ColumnDef`'s
 * `meta` is TanStack's `ColumnMeta`, an interface this repo does not augment, so an object literal
 * carrying `exportHeaderName` / `exportValue` is an excess-property error against it -- while the
 * writer reads exactly those two keys off `col.meta as any`. This is the shape the writer actually
 * consumes, stated once, and it keeps a pure model file free of a table library. The render site
 * casts on the way into `exportToCsv`.
 */
export interface OutflowExportColumn {
    id: string;
    header: string;
    meta: {
        exportHeaderName: string;
        exportValue: (row: OutflowImportRow) => string | number | null | undefined;
    };
}

/**
 * This screen's columns, as the CSV writer's column definitions.
 *
 * ⚠️ EVERY COLUMN SHIPS, INCLUDING THE ONES HIDDEN ON SCREEN, AND THAT IS WHY THERE IS NO `hidden`
 * PARAMETER. A CSV is an archive, not a screenshot. Bank a/c, IFSC, Import, Settled via and Time
 * ship hidden precisely because they are rare lookups that would cost every reader horizontal space
 * (see `OUTFLOW_COLUMNS`) -- but "rarely worth a column" and "not worth keeping" are different
 * claims, and a rare lookup is exactly what somebody opens a downloaded statement to do. Taking the
 * visible set would also make the file a function of a menu somebody clicked, so two exports of the
 * same table would differ with nothing in either file saying so. The parameter is not merely
 * defaulted off; it is absent, so no call site can reintroduce the question.
 *
 * ⚠️ `exportValue` IS `column.get`, WHICH RETURNS THE STORED VALUE, NOT THE RENDERED ONE. That is
 * the point on the Reference column: `get` is `referenceValue` (the WHOLE reference, falling back to
 * a Cashbook row's `transfer_id`), never `shortReference`, whose 12-character tail is display-only
 * and must never leave the render layer -- a truncated UTR in an archived file is a reference that
 * finds nothing at the other end. The Outcome column's `get` is `outcome_note ?? skip_reason ?? ""`,
 * which is right here for the same reason: on screen that cell is a BUTTON, and the note behind it
 * is the only part of it a file can carry.
 */
/**
 * The two settlement facts the CSV carries that the SCREEN does not have.
 *
 * ⚠️ THEY ARE NOT IN `OUTFLOW_COLUMNS`, AND THEY MUST NOT BE. `get_outflow_rows` does not select
 * `settled_target_name` / `settled_target_amount`; only `export_outflow_rows` does. A column
 * declared on the screen for a field its own query never returns renders an em dash on every row
 * forever -- the mirror image of the `settlement_origin` defect, where a facet was registered
 * without adding the field to the SELECT and 849 settled rows read blank.
 *
 * ⚠️ THEY ARE APPENDED, NEVER INTERLEAVED. The file's leading columns are the screen's, in the
 * screen's order, so somebody comparing a download against the table reads the same sequence; the
 * facts the screen cannot show sit after them, where supplementary data belongs.
 *
 * `Settled amount` is the RECORD's amount, which is not the transfer's `Amount Paid` -- on a
 * partial settle the two differ, and that difference is a reason somebody exports a spreadsheet in
 * the first place. It stays BLANK rather than 0 on an unsettled row: 0 is a claim that nothing was
 * owed, absence is the truth (the same blank-is-not-a-zero rule the BCS cost layer states).
 */
export const EXPORT_ONLY_COLUMNS: readonly OutflowExportColumn[] = [
    {
        id: "settled_target_name",
        header: "Settled record",
        meta: {
            exportHeaderName: "Settled record",
            exportValue: (row: OutflowImportRow) => row.settled_target_name ?? "",
        },
    },
    {
        id: "settled_target_amount",
        header: "Settled amount",
        meta: {
            exportHeaderName: "Settled amount",
            // ⚠️ `?? ""`, never `?? 0`. See the block comment above.
            exportValue: (row: OutflowImportRow) => row.settled_target_amount ?? "",
        },
    },
];

export const toExportColumns = (
    columns: readonly OutflowColumn[]
): OutflowExportColumn[] =>
    [
        ...columns.map((column) => ({
            id: column.id,
            // Both, on purpose: `exportHeaderName` is what the writer prefers, and `header` is what
            // it falls back to. Giving it one of the two would leave the file's headings depending
            // on which branch of `exportToCsv` ran.
            header: column.title,
            meta: {
                exportHeaderName: column.title,
                exportValue: (row: OutflowImportRow) => column.get(row),
            },
        })),
        // ⚠️ APPENDED HERE, NOT AT THE CALL SITES. Both callers (the master table and the Skipped
        // dialog) must produce the same file shape, and a caller that had to remember to spread a
        // second list would eventually be a caller that forgot.
        ...EXPORT_ONLY_COLUMNS,
    ];

/**
 * The filename stem for one scope's download.
 *
 * ⚠️ NO TIMESTAMP -- `exportToCsv` appends its own (`${filename}_yyyyMMdd_HHmmss.csv`). Adding one
 * here would stamp the file twice, and the two stamps would be taken at different moments.
 *
 * ⚠️ THE NAME STATES THE SCOPE BECAUSE THE FILE CANNOT. A downloaded CSV of the Not-Matched tab
 * looks exactly like a downloaded CSV of the whole table -- same columns, same order, fewer rows --
 * and there is nothing inside it that says which. Somebody reconciling from `outflow-transfers` has
 * no way to know they are holding a filtered set.
 *
 * ⚠️ `skipped` DROPS "transfers" ON PURPOSE. Skipped rows are the ones nothing was done with -- a
 * failed transfer, a duplicate, a payment ticked Paid by hand -- and naming that file
 * `outflow-transfers-skipped` reads as a list of transfers that happened.
 *
 * An unknown scope falls back to the bare stem rather than being interpolated into the name: a
 * filename is not the place to discover that a scope was renamed server-side, and a stem naming a
 * scope this screen does not have would be a claim nothing here can honour.
 */
export const exportFileBase = (scope: string): string => {
    switch ((scope || "").trim()) {
        case "all":
            return "outflow-transfers-all";
        case "not_matched":
            return "outflow-transfers-not-matched";
        case "matched":
            return "outflow-transfers-matched";
        case "skipped":
            return "outflow-skipped";
        default:
            return "outflow-transfers";
    }
};

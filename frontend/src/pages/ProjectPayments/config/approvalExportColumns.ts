/**
 * Unified approval queue — the EXPORT column set.
 *
 * ⚠️ THIS IS NOT THE SCREEN'S COLUMN LIST, AND THAT IS THE POINT.
 *
 * `TAB_COLUMNS` curates what a tab SHOWS: nine or ten columns, chosen so an
 * approver's eye lands on the decision. A CSV has no such constraint — it is read in
 * a spreadsheet, filtered and pivoted — so the export carries EVERY field the union
 * row holds, identically on all five tabs. One file shape, whatever tab produced it.
 *
 * Three reasons this is a separate module rather than `meta` added to the registry:
 *
 *  1. The registry's columns are RENDER defs. Three of them (`actions`,
 *     `project_value`, `cashflow_gap`) carry no `accessorKey` and no `exportValue`,
 *     so the default exporter emitted them as columns of blanks — "Actions" full of
 *     nothing, and headers reading the raw ids `project_value` / `cashflow_gap`. An
 *     export-only list cannot have that failure mode: a column here exists ONLY to
 *     be exported, so it always has a value function.
 *  2. A field absent from every tab's layout (`doctype`, `comment_text`, `tds`,
 *     `document_name`, `auto_approved`) has no registry entry at all and therefore
 *     no way to reach a CSV through the render path.
 *  3. It keeps `new-data-table.tsx` untouched. The page hands its own list to
 *     `exportToCsv`, so nothing about the shared table component changes.
 *
 * Every entry is `{ id, meta: { exportHeaderName, exportValue } }` — no `header`, no
 * `cell`. `exportToCsv` reads exactly those two meta keys, so a def with nothing else
 * on it is complete. Do NOT add `accessorKey` here: `exportValue` already wins over
 * it, and a second source for the same cell is a place for the two to disagree.
 */

import { ColumnDef } from "@tanstack/react-table";
import { formatDate } from "@/utils/FormatDate";

import {
  ApprovalQueueRow,
  SOURCE_LABEL,
  TIER_LABEL,
} from "./approvalsTable.config";
import { ApprovalColumnCtx } from "./approvalColumns";

/** A date cell that is genuinely empty stays empty — never "N/A", never today. */
const day = (value?: string | null): string => (value ? formatDate(value) : "");

const col = (
  id: string,
  header: string,
  value: (r: ApprovalQueueRow) => string | number,
): ColumnDef<ApprovalQueueRow> => ({
  id,
  meta: { exportHeaderName: header, exportValue: value },
});

/**
 * Every column, in file order. Identity first, then what it is against, then who and
 * how much, then the dates in lifecycle order, then settlement.
 *
 * `ctx` is the SAME `ApprovalColumnCtx` the render registry already receives, so the
 * label maps resolving ids → names are the ones the screen resolved; an exported
 * Project reads exactly as the on-screen Project did. Each lookup keeps the raw id as
 * its fallback — a missing label must never blank a real value.
 */
export const buildApprovalExportColumns = (
  ctx: ApprovalColumnCtx,
): ColumnDef<ApprovalQueueRow>[] => [
  col("name", "ID", (r) => r.name),
  col("source", "Source", (r) => SOURCE_LABEL[r.source] ?? r.source),
  // The ledger a row came from. Invisible on screen — Source is the friendly form —
  // but it is what makes a merged export traceable back to a doctype.
  col("doctype", "Ledger", (r) => r.doctype),
  col("status", "Status", (r) => r.status),

  col("against_primary", "Against", (r) => r.against_primary || ""),
  col("against_secondary", "Against (Detail)", (r) => r.against_secondary || ""),
  col("against_type", "Against Type", (r) => r.against_type || ""),
  col("expense_type", "Expense Type", (r) => r.expense_type || ""),
  // Hover-only on screen. In a sheet it is a column like any other, and it is often
  // the only place the reason for an expense is written down.
  col("comment_text", "Comment", (r) => r.comment_text || ""),

  col("vendor", "Vendor", (r) =>
    r.vendor ? ctx.vendorLabels.get(r.vendor) || r.vendor : "",
  ),
  col("project", "Project", (r) =>
    r.project ? ctx.projectLabels.get(r.project) || r.project : "",
  ),

  // A RAW number, deliberately unformatted: `formatToRoundedIndianRupee` returns
  // "₹1,23,456", which a spreadsheet imports as TEXT and will not sum. The screen
  // formats; the file stays arithmetic.
  col("amount", "Req. Amount", (r) => r.amount),
  col("tier", "Tier", (r) => TIER_LABEL[r.tier] ?? r.tier ?? ""),
  col("raised_by", "Raised By", (r) =>
    ctx.userLabels?.get(r.raised_by) || r.raised_by || "",
  ),
  col("auto_approved", "Auto Approved", (r) => (r.auto_approved ? "Yes" : "No")),

  // ⚠️ ALL FOUR DATES GO THROUGH `day`. The render registry is inconsistent here —
  // `requested_on` exports `formatDate(...)` while `dateCol` exports the raw ISO
  // string — so a single CSV carried two date formats in different columns. One
  // format, applied once, for every date in the file.
  col("creation", "Requested On", (r) => day(r.creation)),
  col("approved_on", "Approved On", (r) => day(r.approved_on)),
  col("paid_on", "Paid On", (r) => day(r.paid_on)),
  // Always blank today: all three union branches select `NULL::date` until the
  // reconciliation writers land. Carried anyway so the file's shape does not change
  // on the day they do.
  col("reconciled_on", "Reconciled On", (r) => day(r.reconciled_on)),

  col("utr_ref", "UTR / Ref", (r) => r.utr_ref || ""),
  // `proof` is a file URL; `has_proof` is the server's own verdict on it. Export the
  // verdict — a reader wants to know WHETHER there is proof, and the URL is useless
  // without a session anyway.
  col("proof", "Proof", (r) => (r.has_proof ? "yes" : "")),
  col("payment_by", "Payment By", (r) => r.payment_by || ""),

  // Payment-only fields. Blank on an expense, which has no PO/SR parent and never
  // withholds tax — the blank IS the true value, so no placeholder.
  col("document_name", "PO / SR", (r) => r.document_name || ""),
  col("document_type", "PO / SR Type", (r) => r.document_type || ""),
  col("tds", "TDS", (r) => r.tds || ""),

  // The two CEO figures. They are per-PROJECT lookups rather than row fields, so they
  // ride the ctx callbacks — and are emitted ONLY when the page supplied them, since
  // a tab without the rollup hook would otherwise export two columns of zeroes.
  ...(ctx.getProjectValue
    ? [
        col("project_value", "Project Value", (r) =>
          r.project ? ctx.getProjectValue!(r.project) : "",
        ),
      ]
    : []),
  ...(ctx.getProjectCashflowGap
    ? [
        col("cashflow_gap", "Cashflow Gap", (r) =>
          r.project ? ctx.getProjectCashflowGap!(r.project) : "",
        ),
      ]
    : []),
];

import { ColumnDef, HeaderContext } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { ExpenseBankLinesPopover } from "@/pages/ProjectPayments/components/ExpenseBankLinesPopover";
import { OrderDetailLink } from "@/pages/ProjectPayments/components/OrderDetailLink";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { facetedFilterFn } from "@/utils/tableFilters";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import {
  AuditAgainst,
  AuditColumnKey,
  AuditColumnSpec,
  AuditRow,
  AuditTab,
  AuditTableRow,
  AuditView,
  auditColumnSpecs,
} from "../../utils/auditView";

/** Reads one key of any tab's row: each key is present on its own tab's rows, null where n/a. */
const field = (row: AuditRow, key: string): unknown => (row as unknown as Record<string, unknown>)[key];

export const AGAINST_CLASSES: Record<AuditAgainst, string> = {
  PO: "border-blue-200 bg-blue-50 text-blue-700",
  WO: "border-violet-200 bg-violet-50 text-violet-700",
  "Project Expense": "border-amber-200 bg-amber-50 text-amber-800",
  "Non-Project Expense": "border-slate-200 bg-slate-100 text-slate-700",
};

const text = (row: AuditRow, key: string): string | null => {
  const v = field(row, key);
  return typeof v === "string" && v !== "" ? v : null;
};

const num = (row: AuditRow, key: string): number | null => {
  const v = field(row, key);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const Dash = () => <span className="text-muted-foreground">—</span>;

/** A stored file URL is site-relative ("/private/files/…"); a full URL (cloud storage) is used as is. */
const fileHref = (url: string) => (/^https?:\/\//.test(url) ? url : SITEURL + url);

const isOrder = (row: AuditRow) => row.against === "PO" || row.against === "WO";

/** The headline money column of each tab, in bold. */
const HEADLINE: AuditColumnKey[] = ["incl_gst", "invoice_amount", "net_paid"];

/**
 * Column widths (px). The shared table is `table-fixed` and gives every column 150px unless told
 * otherwise, which overflowed long headers and pushed the money columns off-screen. Each tab adds up
 * to at most ~1,094px: the table's width on a 1440px screen with the sidebar open. A date column
 * needs ~132px for "Payment date" plus its sort arrow.
 */
const WIDTH: Record<AuditColumnKey, number> = {
  against: 112,
  id: 170,
  invoice_no: 130,
  project: 125,
  vendor: 115,
  expense_type: 170,
  date: 132,
  utr: 125,
  excl_gst: 110,
  gst: 90,
  incl_gst: 115,
  total_invoiced: 125,
  invoice_amount: 135,
  amount_paid: 115,
  tds: 85,
  net_paid: 115,
};
const TEXT_KEYS: ReadonlySet<AuditColumnKey> = new Set(["against", "id", "invoice_no", "project", "vendor", "expense_type", "date", "utr"]);
const isMoneyKey = (key: AuditColumnKey) => !TEXT_KEYS.has(key);

/**
 * Columns with a faceted filter get a filter icon in front of their header title (the shared table
 * puts it there), which pushes the title ~24px right of the values. Their TEXT cells are indented by
 * the same amount so the text starts under the title. (The Against badge is not: a chip reads fine
 * under the icon, and the indent would cost the table 24px it does not have.)
 */
const FACET_INDENT = "pl-6";

/** One column from its spec. */
const column = (spec: AuditColumnSpec): ColumnDef<AuditTableRow> => ({ size: WIDTH[spec.key], ...columnBody(spec) });

const columnBody = (spec: AuditColumnSpec): ColumnDef<AuditTableRow> => {
  // Money headers sit on the right, over their right-aligned figures (`ml-auto` inside the header's flex row).
  const header = ({ column: c }: HeaderContext<AuditTableRow, unknown>) => (
    <DataTableColumnHeader
      column={c}
      title={spec.label}
      className={cn(isMoneyKey(spec.key) ? "ml-auto text-right" : "whitespace-nowrap")}
    />
  );

  switch (spec.key) {
    case "against":
      return {
        id: "against",
        accessorKey: "against",
        header,
        cell: ({ row }) => (
          <Badge variant="outline" className={cn("whitespace-nowrap text-[11px] font-medium", AGAINST_CLASSES[row.original.against])}>
            {row.original.against}
          </Badge>
        ),
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: spec.label, exportValue: (row: AuditRow) => row.against },
      };
    case "id":
      return {
        id: "id",
        accessorKey: "id",
        header,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              {isOrder(r) ? (
                <OrderDetailLink docName={r.id} className="font-medium text-blue-600 underline-offset-2 hover:underline">
                  {r.id}
                </OrderDetailLink>
              ) : (
                // An expense opens the same Expense details card as the Payments & Expenses table:
                // type, project, vendor, description and its bank lines, fetched only when opened.
                <ExpenseBankLinesPopover
                  doctype={r.against === "Project Expense" ? "Project Expenses" : "Non Project Expenses"}
                  name={r.id}
                  subtitle={text(r, "expense_type") ?? undefined}
                  status="Paid"
                >
                  <span className="font-medium">{r.id}</span>
                </ExpenseBankLinesPopover>
              )}
              {field(r, "is_gst_payment") === true && (
                <span className="text-[11px] font-medium text-red-600">GST payment</span>
              )}
            </div>
          );
        },
        meta: { exportHeaderName: spec.label, exportValue: (row: AuditRow) => row.id },
      };
    case "project":
    case "vendor": {
      const nameKey = `${spec.key}_name`;
      return {
        id: spec.key,
        accessorFn: (row) => text(row, nameKey) ?? text(row, spec.key) ?? "",
        header,
        cell: ({ getValue }) => {
          const v = getValue<string>();
          return <div className={cn("line-clamp-2 break-words", FACET_INDENT)} title={v || undefined}>{v || <Dash />}</div>;
        },
        filterFn: facetedFilterFn,
        meta: {
          exportHeaderName: spec.label,
          exportValue: (row: AuditRow) => text(row, nameKey) ?? text(row, spec.key) ?? "",
        },
      };
    }
    case "expense_type":
      return {
        id: "expense_type",
        accessorFn: (row) => text(row, "expense_type") ?? "",
        header,
        cell: ({ getValue }) => (
          <div className={cn("line-clamp-2 break-words", FACET_INDENT)} title={getValue<string>() || undefined}>
            {getValue<string>() || <Dash />}
          </div>
        ),
        filterFn: facetedFilterFn,
        meta: { exportHeaderName: spec.label, exportValue: (row: AuditRow) => text(row, "expense_type") ?? "" },
      };
    case "date":
      return {
        id: "date",
        // A row with no date (one Paid payment has none) sorts after the dated rows, not before them.
        accessorFn: (row) => row.date ?? undefined,
        sortUndefined: 1,
        header,
        cell: ({ row }) => (row.original.date ? <span className="whitespace-nowrap">{formatDate(row.original.date)}</span> : <Dash />),
        meta: { exportHeaderName: spec.label, exportValue: (row: AuditRow) => (row.date ? formatDate(row.date) : "") },
      };
    case "invoice_no":
      return {
        id: "invoice_no",
        accessorFn: (row) => text(row, "invoice_no") ?? "",
        header,
        // A link to the invoice file when one is attached; plain text otherwise.
        cell: ({ row, getValue }) => {
          const invoiceNo = getValue<string>();
          if (!invoiceNo) return <Dash />;
          const url = text(row.original, "invoice_url");
          return url ? (
            <a
              href={fileHref(url)}
              target="_blank"
              rel="noreferrer"
              title={`Open invoice ${invoiceNo}`}
              className="block truncate font-mono text-xs text-blue-600 underline-offset-2 hover:underline"
            >
              {invoiceNo}
            </a>
          ) : (
            <div className="truncate font-mono text-xs" title={invoiceNo}>{invoiceNo}</div>
          );
        },
        meta: { exportHeaderName: spec.label, exportValue: (row: AuditRow) => text(row, "invoice_no") ?? "" },
      };
    case "utr":
      return {
        id: spec.key,
        accessorFn: (row) => text(row, spec.key) ?? "",
        header,
        cell: ({ getValue }) =>
          getValue<string>() ? (
            <div className="truncate font-mono text-xs" title={getValue<string>()}>{getValue<string>()}</div>
          ) : (
            <Dash />
          ),
        meta: { exportHeaderName: spec.label, exportValue: (row: AuditRow) => text(row, spec.key) ?? "" },
      };
    default: {
      // A money column. TDS is null on an expense (no TDS field): "—".
      const key = spec.key;
      return {
        id: key,
        accessorFn: (row) => num(row, key) ?? 0,
        header,
        cell: ({ row }) => {
          const v = num(row.original, key);
          return (
            <div className={cn("whitespace-nowrap text-right tabular-nums", HEADLINE.includes(key) && "font-medium")}>
              {v === null ? <Dash /> : formatToRoundedIndianRupee(v)}
            </div>
          );
        },
        sortingFn: "basic",
        meta: {
          exportHeaderName: spec.label,
          exportValue: (row: AuditRow) => {
            const v = num(row, key);
            return v === null ? "" : String(formatForReport(v));
          },
        },
      };
    }
  }
};

/** The table's columns for a view and tab (order and labels from `auditColumnSpecs`). */
export const getAuditViewColumns = (view: AuditView, tab: AuditTab): ColumnDef<AuditTableRow>[] =>
  auditColumnSpecs(view, tab).map(column);

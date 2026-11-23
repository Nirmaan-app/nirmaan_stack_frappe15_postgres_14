import { format, formatISO, parseISO } from "date-fns";

import { formatToCompactRupee } from "@/utils/FormatPrice";

/**
 * Reports → Audit View: the pure rules behind the tab (F4). Which tab may be open in which view, the
 * column set of each table and the summary-strip sums. The rows come from
 * `api/reports/audit_view.get_audit_view_rows`; every key is always present, null where n/a.
 */

/** The Report Type select: "All Project View" → project, "Non Project View" → nonproject. */
export type AuditView = "project" | "nonproject";
export type AuditTab = "orders" | "invoices" | "payments";
export type AuditAgainst = "PO" | "WO" | "Project Expense" | "Non-Project Expense";

/** One PO / WO, dated by its created date. Project view only. */
export interface AuditOrderRow {
  against: "PO" | "WO";
  id: string;
  project: string | null;
  project_name: string | null;
  vendor: string | null;
  vendor_name: string | null;
  date: string | null;
  excl_gst: number | null;
  gst: number | null;
  incl_gst: number | null;
  total_invoiced: number | null;
}

/** One approved invoice (credit notes are negative), dated by its invoice date. */
export interface AuditInvoiceRow {
  against: AuditAgainst;
  id: string;
  invoice_no: string | null;
  project: string | null;
  project_name: string | null;
  vendor: string | null;
  vendor_name: string | null;
  expense_type: string | null;
  /** An expense's description, shown in the Against column; null on a PO / WO invoice. */
  description: string | null;
  date: string | null;
  invoice_amount: number | null;
  /** The PO / WO's created date; null for an expense. */
  order_date: string | null;
  /** The attached invoice file's URL (site-relative), or null when no file is attached. */
  invoice_url: string | null;
}

/** One paid payment, dated by its payment date. `tds` is null for an expense (no TDS field). */
export interface AuditPaymentRow {
  against: AuditAgainst;
  id: string;
  project: string | null;
  project_name: string | null;
  vendor: string | null;
  vendor_name: string | null;
  expense_type: string | null;
  /** An expense's description, shown in the Against column; null on a PO / WO payment. */
  description: string | null;
  date: string | null;
  utr: string | null;
  amount_paid: number | null;
  tds: number | null;
  net_paid: number | null;
  is_gst_payment: boolean;
  order_date: string | null;
}

export type AuditRow = AuditOrderRow | AuditInvoiceRow | AuditPaymentRow;

/**
 * A row as the table holds it: `name` is a client-side key (the table hook needs one), unique even
 * when one PO has several invoices or payments. Added by `useAuditViewData`, never sent by the server.
 */
export type AuditTableRow = AuditRow & { name: string };

/** `get_audit_view_summary`: the three tab cards' figures. `orders` is null in Non Project View. */
export interface AuditViewSummary {
  orders: { count: number; incl_gst: number; total_invoiced: number; by_against: AuditByAgainst } | null;
  invoices: { count: number; invoice_amount: number; by_against: AuditByAgainst };
  payments: { count: number; amount_paid: number; tds: number; net_paid: number; by_against: AuditByAgainst };
}

/** The tab's headline figure per Against (orders incl. GST, invoices amount, payments net paid). */
export type AuditByAgainst = Partial<Record<AuditAgainst, number>>;

export const AUDIT_TABS: readonly AuditTab[] = ["orders", "invoices", "payments"];

/** The URL param that keeps the open tab card. */
export const AUDIT_TAB_PARAM = "audit_tab";

/**
 * Set ("1") while step 1 is done on this page, so a refresh keeps it. The shared report date stores a preset or
 * custom range in the URL but nothing for ALL, so without this a refreshed page could not tell "ALL picked"
 * from "nothing picked yet" and dropped the range and the open tab.
 */
export const AUDIT_RANGE_PARAM = "audit_range";

/** Whether step 1 counts as done when the page loads: a range in the URL, or ALL picked here before a refresh. */
export const auditRangeChosenAtLoad = (selectionKind: string, rangeParam: string | null | undefined): boolean =>
  selectionKind !== "all" || rangeParam === "1";

interface AuditTabMeta {
  title: string;
  /** The date each tab is dated by, lower case ("Dated by <basis>"). */
  basis: string;
  /** What each tab's scope leaves out, for the context line. */
  scope: string;
}

export const AUDIT_TAB_META: Record<AuditTab, AuditTabMeta> = {
  orders: { title: "Orders", basis: "created date", scope: "PO status not Inactive, Cancelled or Merged" },
  invoices: { title: "Invoices", basis: "invoice date", scope: "Approved invoices only" },
  payments: { title: "Payments", basis: "payment date", scope: "Paid only" },
};

/** What a tab card's subtitle says the tab covers ("By created date · PO + WO"). */
export const auditTabSources = (view: AuditView, tab: AuditTab): string => {
  if (view === "nonproject") return "Non-Project Expense";
  return tab === "orders" ? "PO + WO" : "PO + WO + Expense";
};

/** True for the Orders card in Non Project View: overheads have no PO / WO. */
export const isAuditTabDisabled = (view: AuditView, tab: AuditTab): boolean =>
  view === "nonproject" && tab === "orders";

/**
 * The tab to open from the URL's `audit_tab`. An unknown or missing value opens the view's first
 * usable tab, and Orders in Non Project View falls back to Invoices.
 */
export const resolveAuditTab = (view: AuditView, raw: string | null | undefined): AuditTab => {
  const asked = AUDIT_TABS.find((t) => t === raw);
  const fallback: AuditTab = view === "nonproject" ? "invoices" : "orders";
  if (!asked || isAuditTabDisabled(view, asked)) return fallback;
  return asked;
};

/** A table column of the Audit View: its key (the column id) and its header. */
export type AuditColumnKey =
  | "against"
  | "id"
  | "invoice_no"
  | "project"
  | "vendor"
  | "expense_type"
  | "date"
  | "utr"
  | "excl_gst"
  | "gst"
  | "incl_gst"
  | "total_invoiced"
  | "invoice_amount"
  | "amount_paid"
  | "tds"
  | "net_paid";

export interface AuditColumnSpec {
  key: AuditColumnKey;
  label: string;
}

/**
 * The columns of one table, in order. No status column anywhere. Type and Against come first, as on the
 * Payments page. Non Project View has no Project or Vendor column (the expense type sits under the Type
 * pill), and UTR reads "Payment ref". All Project View's UTR column reads "UTR / Ref": a PO /
 * WO payment's UTR, a project expense's payment ref. Orders in Non Project View has no table: [].
 */
export const auditColumnSpecs = (view: AuditView, tab: AuditTab): AuditColumnSpec[] => {
  if (isAuditTabDisabled(view, tab)) return [];
  const project = view === "project";
  // As on the Payments page: Type = the PO / WO / Expense pill with the expense type under it; Against = the
  // PO / WO number, or the expense's description. The keys stay `against` / `id` (URL-synced filters).
  const against: AuditColumnSpec = { key: "against", label: "Type" };
  const id: AuditColumnSpec = { key: "id", label: "Against" };
  // Non Project View has no column of its own for the expense type: it sits under the Type pill.
  const who: AuditColumnSpec[] = project
    ? [{ key: "project", label: "Project" }, { key: "vendor", label: "Vendor" }]
    : [];

  if (tab === "orders") {
    return [
      against, id, ...who,
      { key: "date", label: "Created date" },
      { key: "excl_gst", label: "Excl. GST" },
      { key: "gst", label: "GST" },
      { key: "incl_gst", label: "Incl. GST" },
      { key: "total_invoiced", label: "Total Invoiced" },
    ];
  }
  if (tab === "invoices") {
    return [
      against, id,
      { key: "invoice_no", label: "Invoice No." },
      ...who,
      { key: "date", label: "Invoice date" },
      { key: "invoice_amount", label: "Invoice Amount" },
    ];
  }
  return [
    against, id, ...who,
    { key: "date", label: "Payment date" },
    { key: "utr", label: project ? "UTR / Ref" : "Payment ref" },
    { key: "amount_paid", label: "Amount Paid" },
    { key: "tds", label: "TDS" },
    { key: "net_paid", label: "Net Paid" },
  ];
};

/** The date part of a "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" string; null when blank. */
const datePart = (value: string | null | undefined): string | null => {
  const d = (value ?? "").trim().slice(0, 10);
  return d.length === 10 ? d : null;
};

/**
 * True when the row's order was created before the selected range: it is listed because its invoice
 * or payment date is inside the range. Never true without a from-date (ALL) or without an order date.
 * The table's "Order created / Order outside range" line that read it is hidden for now (owner
 * 2026-11-20); kept, with its tests, so the line can come back. Rows still carry `order_date`.
 */
export const isOrderOutsideRange = (
  orderDate: string | null | undefined,
  fromDate: string | null | undefined,
): boolean => {
  const order = datePart(orderDate);
  const from = datePart(fromDate);
  return !!order && !!from && order < from;
};

/** A DateRange end as the API's "YYYY-MM-DD"; undefined when unset (an unbounded side). */
export const toAuditApiDate = (d: Date | undefined | null): string | undefined =>
  d ? formatISO(d, { representation: "date" }) : undefined;

/** The range for the context line: "01-Apr-2026 – 30-Apr-2026", "From 01-Apr-2026", or "All dates". */
export const auditRangeLabel = (from?: string, to?: string): string => {
  const show = (d: string) => format(parseISO(d), "dd-MMM-yyyy");
  if (from && to) return from === to ? show(from) : `${show(from)} – ${show(to)}`;
  if (from) return `From ${show(from)}`;
  if (to) return `Until ${show(to)}`;
  return "All dates";
};

/** A money figure as a finite number: null, undefined and NaN count as 0. */
const money = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const sum = <T>(rows: readonly T[], get: (r: T) => number | null | undefined): number =>
  rows.reduce((s, r) => s + money(get(r)), 0);

/** Invoiced as a % of order value, to 1 decimal; null when the order value is 0 (no % to show). */
export const invoicedPercent = (invoiced: number, orderValue: number): number | null =>
  orderValue ? Math.round((invoiced / orderValue) * 1000) / 10 : null;

export interface AuditOrdersSummary {
  count: number;
  exclGst: number;
  gst: number;
  inclGst: number;
  totalInvoiced: number;
  invoicedPct: number | null;
}

export const summariseAuditOrders = (rows: readonly AuditOrderRow[]): AuditOrdersSummary => {
  const inclGst = sum(rows, (r) => r.incl_gst);
  const totalInvoiced = sum(rows, (r) => r.total_invoiced);
  return {
    count: rows.length,
    exclGst: sum(rows, (r) => r.excl_gst),
    gst: sum(rows, (r) => r.gst),
    inclGst,
    totalInvoiced,
    invoicedPct: invoicedPercent(totalInvoiced, inclGst),
  };
};

export interface AuditInvoicesSummary {
  count: number;
  /** Credit notes are negative, so they net off. */
  invoiceAmount: number;
}

export const summariseAuditInvoices = (rows: readonly AuditInvoiceRow[]): AuditInvoicesSummary => ({
  count: rows.length,
  invoiceAmount: sum(rows, (r) => r.invoice_amount),
});

export interface AuditPaymentsSummary {
  count: number;
  amountPaid: number;
  tds: number;
  netPaid: number;
  /** True when no row has a TDS figure (all expenses): the card shows "—" for TDS. */
  noTds: boolean;
  /** Rows with no TDS field (expenses), for the card's note. */
  rowsWithoutTds: number;
  /** WO GST paid as its own row. */
  gstPayments: number;
}

/** Amount paid + TDS = Net paid, summed from the rows; Net paid is the server's figure per row. */
export const summariseAuditPayments = (rows: readonly AuditPaymentRow[]): AuditPaymentsSummary => {
  const rowsWithoutTds = rows.filter((r) => r.tds === null || r.tds === undefined).length;
  return {
    count: rows.length,
    amountPaid: sum(rows, (r) => r.amount_paid),
    tds: sum(rows, (r) => r.tds),
    netPaid: sum(rows, (r) => r.net_paid),
    noTds: rows.length > 0 && rowsWithoutTds === rows.length,
    rowsWithoutTds,
    gstPayments: rows.filter((r) => r.is_gst_payment === true).length,
  };
};

/** Faceted-filter options from the loaded rows: "<value> (<count>)", sorted, blanks left out. */
export const auditFacetOptions = <T>(
  rows: readonly T[],
  get: (r: T) => string | null | undefined,
): { label: string; value: string }[] => {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = get(r);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, n]) => ({ label: `${value} (${n})`, value }));
};

/** The tab cards' short headline figure ("₹3.23 Cr"); the formatter lives in utils/FormatPrice (rule R1). */
export const compactRupees = formatToCompactRupee;

/** Share of a total as a % to 1 decimal; 0 when the total is 0 (bars and legends never divide by 0). */
export const sharePercent = (part: number, total: number): number =>
  total ? Math.round((part / total) * 1000) / 10 : 0;

export interface AuditBreakdownItem {
  key: string;
  count: number;
  value: number;
}

/**
 * Rows grouped by `getKey` with their count and summed `getValue`, largest value first (ties by key).
 * With `order`, the keys come in that order instead and a missing key is listed with 0 (the By type card
 * always shows every type of the tab). Blank keys group as "Other".
 */
export const auditBreakdown = <T>(
  rows: readonly T[],
  getKey: (r: T) => string | null | undefined,
  getValue: (r: T) => number | null | undefined,
  order?: readonly string[],
): AuditBreakdownItem[] => {
  const by = new Map<string, AuditBreakdownItem>();
  for (const r of rows) {
    const key = getKey(r) || "Other";
    const item = by.get(key) ?? { key, count: 0, value: 0 };
    const v = Number(getValue(r));
    item.count += 1;
    item.value += Number.isFinite(v) ? v : 0;
    by.set(key, item);
  }
  if (order) return order.map((key) => by.get(key) ?? { key, count: 0, value: 0 });
  return [...by.values()].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
};

/** The Against values a tab can hold, in card order. */
export const auditAgainstFor = (view: AuditView, tab: AuditTab): AuditAgainst[] => {
  if (view === "nonproject") return tab === "orders" ? [] : ["Non-Project Expense"];
  return tab === "orders" ? ["PO", "WO"] : ["PO", "WO", "Project Expense"];
};

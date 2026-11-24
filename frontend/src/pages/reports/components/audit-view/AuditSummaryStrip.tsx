/** Audit View: the compact summary strip above the table (from the loaded rows). */
import { CSSProperties, ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { AGAINST_BAR, STRIPES } from "./auditViewStyles";
import { InfoTip } from "./InfoTip";
import { AUDIT_TAB_META, AuditAgainst, AuditInvoiceRow, AuditOrderRow, AuditPaymentRow, AuditTab, AuditTableRow, AuditView, auditAgainstFor, auditBreakdown, compactRupees, summariseAuditInvoices, summariseAuditOrders, summariseAuditPayments } from "../../utils/auditView";

const rupees = formatToRoundedIndianRupee;

// ---------------------------------------------------------------------------------------------
// Summary cards (from the loaded rows): one row of cards above the table, in the look of the old
// "Show details" cards; each a label (notes behind ⓘ), a figure and, under a dashed line, one line of chips. The type split comes
// first, under the tab's own name. No bars, badge counts or percentages (owner, 2026-11-23).
// ---------------------------------------------------------------------------------------------

/** One chip of a segment: swatch, label and amount. */
interface StripPart {
  label: string;
  value: number;
  className?: string;
  style?: CSSProperties;
}

function StripLabel({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <span className="flex h-3.5 items-center gap-1 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
      {note && <InfoTip note={note} />}
    </span>
  );
}

/** One segment; `grow` sets its share of spare width (widths follow content first, so chips stay on one line).
 * Side by side from xl only: with the sidebar open, narrower screens leave too little width for the payments sum. */
function StripSeg({ grow, children }: { grow: number; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border bg-card p-3.5 shadow-sm" style={{ flex: `${grow} 1 220px` }}>
      {children}
    </div>
  );
}

function StripFigure({ value, sub, className }: { value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="mt-0.5 flex min-h-[22px] min-w-0 items-baseline gap-2.5">
      <b className={cn("whitespace-nowrap text-xl font-bold leading-[22px] tracking-tight tabular-nums", className)}>{value}</b>
      {sub && <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** One line of chips split by "·": swatch, label, compact amount. */
function StripChips({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2.5 flex flex-wrap border-t border-dashed pt-2 text-[11.5px] leading-[15px] text-muted-foreground [&>*+*]:before:mx-1.5 [&>*+*]:before:text-muted-foreground/50 [&>*+*]:before:content-['·']">
      {children}
    </div>
  );
}

function StripChip({ part, text }: { part: StripPart; text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
      {(part.className || part.style) && <Swatch className={cn("h-2 w-2 rounded-[2px]", part.className)} style={part.style} />}
      {part.label} <b className="font-semibold text-foreground/80">{text ?? compactRupees(part.value)}</b>
    </span>
  );
}

const STRIP_DARK = "bg-slate-700 dark:bg-slate-300";

/** One term of the payments sum: its label over its figure. */
function EqTerm({ label, value, className }: { label: ReactNode; value: string; className?: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      {label}
      <b className={cn("whitespace-nowrap text-xl font-bold leading-[22px] tracking-tight tabular-nums", className)}>{value}</b>
    </span>
  );
}

const EqOp = ({ label, children }: { label: string; children: ReactNode }) => (
  <span className="pb-px text-[15px] leading-[22px] text-muted-foreground/70" aria-label={label}>{children}</span>
);

/** The tab's amount split by type (project), under the tab's name: PO / WO / Project Expense, each its amount. */
function StripByType({ view, tab, rows, value, note }: {
  view: AuditView; tab: AuditTab; rows: AuditTableRow[]; value: (r: AuditTableRow) => number | null | undefined; note: string;
}) {
  const parts: StripPart[] = auditBreakdown(rows, (r) => r.against, value, auditAgainstFor(view, tab)).map((it) => ({
    label: it.key, value: Math.max(it.value, 0), className: AGAINST_BAR[it.key as AuditAgainst],
  }));
  return (
    <StripSeg grow={1}>
      <StripLabel note={note}>{AUDIT_TAB_META[tab].title}</StripLabel>
      <StripChips>{parts.map((p) => <StripChip key={p.label} part={p} />)}</StripChips>
    </StripSeg>
  );
}

/** The non-project shades: biggest type darkest; the rest ("N more") lightest. */
const TOP_TYPE_SHADES = ["bg-slate-700 dark:bg-slate-200", "bg-slate-500 dark:bg-slate-400", "bg-slate-400/70 dark:bg-slate-500", "bg-slate-200 dark:bg-slate-700"];

/** Top expense types (non-project): the 3 biggest by amount, the rest as "N more". */
function StripTopTypes({ rows, value, what }: { rows: AuditTableRow[]; value: (r: AuditTableRow) => number | null | undefined; what: string }) {
  const items = auditBreakdown(rows, (r) => (r as AuditInvoiceRow).expense_type, value);
  const top = items.slice(0, 3).map((it) => ({ label: it.key, value: Math.max(it.value, 0) }));
  const rest = items.slice(3).reduce((s, it) => s + Math.max(it.value, 0), 0);
  // "N more", not "Others": "Other" is itself an expense type (and the label of blank types).
  if (rest > 0) top.push({ label: `${items.length - 3} more`, value: rest });
  const parts: StripPart[] = top.map((p, i) => ({ ...p, className: TOP_TYPE_SHADES[i] }));
  return (
    <StripSeg grow={1}>
      <StripLabel note={`The 3 biggest expense types by ${what}; the rest are grouped as "N more".`}>
        Top expense types
      </StripLabel>
      <StripFigure
        className="text-base"
        value={items.length.toLocaleString("en-IN")}
        sub={`expense type${items.length === 1 ? "" : "s"}${items[0] ? ` · biggest: ${items[0].key}` : ""}`}
      />
      <StripChips>{parts.map((p) => <StripChip key={p.label} part={p} />)}</StripChips>
    </StripSeg>
  );
}

export function SummaryStrip({ view, tab, rows }: { view: AuditView; tab: AuditTab; rows: AuditTableRow[] }) {
  const project = view === "project";
  let segments: ReactNode;

  if (tab === "orders") {
    const s = summariseAuditOrders(rows as AuditOrderRow[]);
    const notYet = Math.max(0, s.inclGst - s.totalInvoiced);
    const value: StripPart[] = [
      { label: "Excl", value: s.exclGst, className: STRIP_DARK },
      { label: "GST", value: s.gst, className: "bg-rose-400" },
    ];
    const invoiced: StripPart[] = [
      { label: "Invoiced", value: s.totalInvoiced, className: STRIP_DARK },
      { label: "Not yet", value: notYet, style: STRIPES },
    ];
    segments = (
      <>
        <StripByType view={view} tab={tab} rows={rows} value={(r) => (r as AuditOrderRow).incl_gst}
          note="Order value incl. GST, split by order type." />
        <StripSeg grow={1.3}>
          <StripLabel note="Created date in the selected range. Only live POs and WOs: Inactive, Cancelled and Merged orders are never counted.">
            Order value incl. GST
          </StripLabel>
          <StripFigure
            value={rupees(s.inclGst)}
            sub={`${s.count.toLocaleString("en-IN")} orders${s.count ? ` · avg ${rupees(Math.round(s.inclGst / s.count))}` : ""}`}
          />
          <StripChips>{value.map((p) => <StripChip key={p.label} part={p} />)}</StripChips>
        </StripSeg>
        <StripSeg grow={1.3}>
          <StripLabel note="All approved invoices of these orders, whatever the invoice date.">Total invoiced</StripLabel>
          <StripFigure value={rupees(s.totalInvoiced)} />
          <StripChips>{invoiced.map((p) => <StripChip key={p.label} part={p} />)}</StripChips>
        </StripSeg>
      </>
    );
  } else if (tab === "invoices") {
    const s = summariseAuditInvoices(rows as AuditInvoiceRow[]);
    const value = (r: AuditTableRow) => (r as AuditInvoiceRow).invoice_amount;
    segments = (
      <>
        {project ? (
          <StripByType view={view} tab={tab} rows={rows} value={value} note="Invoice amount, split by type." />
        ) : (
          <StripTopTypes rows={rows} value={value} what="invoice amount" />
        )}
        <StripSeg grow={1.3}>
          <StripLabel
            note={project
              ? "Full invoice amount only. Expense invoices count only when the expense is Paid and has an invoice date and ref."
              : "Non-project expenses with status Paid that have both an invoice date and an invoice ref. Full amount only."}
          >
            Invoice amount
          </StripLabel>
          <StripFigure
            value={rupees(s.invoiceAmount)}
            sub={`${s.count.toLocaleString("en-IN")} ${project ? "approved invoices" : "expense invoices"}${s.count ? ` · avg ${rupees(Math.round(s.invoiceAmount / s.count))}` : ""}`}
          />
          <StripChips>
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              {project ? "Approved invoices only · pending and rejected are never counted" : "Paid expenses with invoice date and ref only"}
            </span>
          </StripChips>
        </StripSeg>
      </>
    );
  } else {
    const s = summariseAuditPayments(rows as AuditPaymentRow[]);
    const value = (r: AuditTableRow) => (r as AuditPaymentRow).net_paid;
    const notes = [
      // The server counts all recorded tax (Payment TDS Deduction), Vendor- and Company-borne.
      project && "TDS = all recorded TDS: vendor-borne (withheld from the vendor) and company-borne (paid on top).",
      s.gstPayments > 0 && `Includes ${s.gstPayments} separate WO GST payment${s.gstPayments > 1 ? "s" : ""} (no TDS).`,
      s.rowsWithoutTds > 0 &&
        (project ? "Expenses have no TDS field (shown as —), so for them Net paid = Amount paid." : "Non-project expenses have no TDS field, so TDS shows — and Net paid = Amount paid."),
    ].filter(Boolean).join(" ");
    const split: StripPart[] = [
      { label: "Amount paid", value: s.amountPaid, className: STRIP_DARK },
      { label: "TDS", value: s.noTds ? 0 : s.tds, className: "bg-amber-500" },
    ];
    segments = (
      <>
        {project ? (
          <StripByType view={view} tab={tab} rows={rows} value={value}
            note="Net paid, split by type (WO includes its separate GST payments)." />
        ) : (
          <StripTopTypes rows={rows} value={value} what="net paid" />
        )}
        <StripSeg grow={1.8}>
          {/* Each term is its label over its figure; on a narrow strip the terms wrap to the next line. */}
          <div className="flex min-w-0 flex-wrap items-end gap-x-2 gap-y-1.5">
            <EqTerm label={<StripLabel>Amount paid</StripLabel>} value={rupees(s.amountPaid)} />
            <EqOp label="plus">+</EqOp>
            <EqTerm label={<StripLabel>TDS</StripLabel>} value={s.noTds ? "—" : rupees(s.tds)} className={cn(s.noTds && "font-semibold text-muted-foreground/70")} />
            <EqOp label="equals">=</EqOp>
            <EqTerm
              label={<StripLabel note={`Net paid = Amount paid + TDS. ${notes}`.trim()}>Net paid</StripLabel>}
              value={rupees(s.netPaid)}
              className="text-green-700 dark:text-green-400"
            />
            <span className="whitespace-nowrap pb-0.5 pl-1 text-xs tabular-nums text-muted-foreground">{s.count.toLocaleString("en-IN")} payments</span>
          </div>
          <StripChips>
            <StripChip part={split[0]} />
            <StripChip part={split[1]} text={s.noTds ? "—" : undefined} />
          </StripChips>
        </StripSeg>
      </>
    );
  }

  return (
    <div
      role="group"
      aria-label={`${AUDIT_TAB_META[tab].title} summary`}
      className="mb-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap"
    >
      {segments}
    </div>
  );
}

const Swatch = ({ className, style }: { className?: string; style?: CSSProperties }) => (
  <i className={cn("block h-2.5 w-2.5 flex-none rounded-[3px]", className)} style={style} />
);

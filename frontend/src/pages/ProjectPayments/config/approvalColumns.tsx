/**
 * Unified approval queue — the column registry.
 *
 * ONE definition per column id. `buildApprovalColumns` maps a tab's id array over
 * this registry, so the array IS the order and a change to a column reaches every
 * tab at once.
 *
 * This deliberately replaces the payments-screen idiom of one inline `useMemo`
 * with `...(tab === "X" ? [...] : [])` spreads running through it: that is already
 * two near-duplicate 300-line blocks for TWO tabs, and does not survive six tabs
 * across three ledgers.
 */

import { ColumnDef } from "@tanstack/react-table";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatDate } from "@/utils/FormatDate";
import { formatToApproxLakhs, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { CircleCheck, CircleX, IndianRupee, Paperclip, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";
import { TruncatedText } from "@/components/common/TruncatedText";
import {
  DocumentDetailPopover,
  ProjectDetailPopover,
  VendorDetailPopover,
} from "../components/DetailPopovers";

import {
  APPROVAL_STATUS,
  ApprovalColumnId,
  ApprovalQueueRow,
  ApprovalTab,
  descriptionFirstLine,
  TIER_LABEL,
  TYPE_BADGE,
  TYPE_LABEL,
} from "./approvalsTable.config";
import { PP_TABS } from "./ppTabs.constants";

export interface ApprovalColumnCtx {
  tab: ApprovalTab;
  /**
   * id -> display name. The endpoint returns IDS (so facet filters and deep links
   * keep working on ids); the label is resolved here at render time, which is the
   * pattern the payments screen already used.
   */
  projectLabels: Map<string, string>;
  vendorLabels: Map<string, string>;
  /** owner email -> full name. The old "Requested By" column resolved these. */
  userLabels?: Map<string, string>;
  /** PO/SR figures behind the Amount hover — payments only, absent on expenses. */
  getDocumentTotal?: (docName: string, docType: string) => number;
  getAmountPaid?: (docName: string) => number;
  getPoAmountDelivered?: (docName: string, docType: string) => number;
  /** CEO-tab figures, looked up per project. */
  getProjectValue?: (projectId?: string) => number;
  getProjectCashflowGap?: (projectId?: string) => number;
  /**
   * The old Req. On column carried a pulsing dot for a payment the user has not
   * seen yet. Kept — dropping it would be a silent feature regression on a screen
   * people already rely on.
   */
  isUnseen?: (row: ApprovalQueueRow) => boolean;
  onSeen?: (row: ApprovalQueueRow) => void;
  onApprove?: (row: ApprovalQueueRow) => void;
  onReject?: (row: ApprovalQueueRow) => void;
  onRecordPayment?: (row: ApprovalQueueRow) => void;
  onMarkReconciled?: (row: ApprovalQueueRow) => void;
  /**
   * Admin edit on a settled payment (EditFulfilledPaymentDialog). The column
   * matrix says the Paid tab carries no actions — but this one EXISTS on the live
   * screen, so it is preserved rather than silently dropped. Absent => no column
   * content, which is what the matrix describes.
   */
  onEdit?: (row: ApprovalQueueRow) => void;
  /**
   * The Trash icon on "Payment By Me", shown on REJECTED rows only ("--" otherwise). It opens a
   * dialog: an expense is deleted from it; a PO / SR payment is not — the dialog links to its
   * PO / SR page, whose payment table deletes it.
   */
  onDelete?: (row: ApprovalQueueRow) => void;
}

const AGAINST_LINE_LIMIT = 40;

/**
 * The identity of an expense row is its description, but 35% of project-expense
 * descriptions carry a line break — and those extra lines are BANK DETAILS, not
 * description. 98.6% of first lines fit 40 characters.
 *
 * ⚠️ Never render a raw line break in a table cell: 911 rows would break the row
 * height. The full text is one hover away.
 *
 * ⚠️ AND THE FIRST LINE IS NOT ALWAYS THE IDENTITY. Where a description opens with
 * "Account Name: …", line 1 is a bank detail and says nothing about the expense —
 * which is why line 2 carries the TYPE ("Labour Charges") rather than the comment.
 */
const firstLine = (text: string): string => {
  // The line-break rule itself lives in the config module — the bulk-approve
  // dialog renders the same descriptions and must not carry a second copy of it.
  const line = descriptionFirstLine(text);
  return line.length <= AGAINST_LINE_LIMIT
    ? line
    : `${line.slice(0, AGAINST_LINE_LIMIT - 1)}…`;
};

const daysSince = (iso?: string | null): number | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
};

const TypeChip = ({ type }: { type: ApprovalQueueRow["source_type"] }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TYPE_BADGE[type] ?? ""}`}>
    {TYPE_LABEL[type] ?? type}
  </span>
);

const TIER_CLASSES: Record<ApprovalQueueRow["tier"], string> = {
  auto: "bg-green-100 text-green-800",
  l1: "bg-amber-100 text-amber-800",
  l1_l2: "bg-red-100 text-red-800",
};

const TierChip = ({ tier }: { tier: ApprovalQueueRow["tier"] }) => (
  <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-wide ${TIER_CLASSES[tier]}`}>
    {TIER_LABEL[tier]}
  </span>
);

/** A blank is the TRUE value for a non-project expense — never "N/A", never 0. */
const Blank = () => <span className="text-muted-foreground">—</span>;

const dateCol = (
  id: ApprovalColumnId,
  accessor: keyof ApprovalQueueRow,
  title: string,
): ColumnDef<ApprovalQueueRow> => ({
  id,
  accessorKey: accessor,
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
  cell: ({ row }) => {
    const value = row.original[accessor] as string | null;
    return value ? <span className="whitespace-nowrap">{formatDate(value)}</span> : <Blank />;
  },
  size: 120,
  meta: { exportHeaderName: title, exportValue: (r: ApprovalQueueRow) => (r[accessor] as string) || "" },
});

const REGISTRY: Record<
  ApprovalColumnId,
  (ctx: ApprovalColumnCtx) => ColumnDef<ApprovalQueueRow>
> = {
  // Position 2 on every tab that has it. The approver's hand never travels to the
  // right edge, and the button stays put as the other columns change between tabs.
  //
  // WIDTH IS PER TAB: two icon buttons need ~72px, but "Mark as Paid" + delete needs
  // ~150. A single size would either clip the label or waste 58px on every approval
  // row — measured in the browser, where Actions was over-allocated by exactly that.
  actions: (ctx) => ({
    id: "actions",
    header: "Actions",
    enableSorting: false,
    size:
      // 148: measured — the button itself is 136px and the cell needs 144. Was 172
      // while a trash icon sat beside it; that icon is no longer offered on this tab.
      ctx.tab === PP_TABS.NEW_PAYMENTS ? 148
        : ctx.tab === PP_TABS.RECONCILIATION_PENDING ? 160
        : ctx.tab === PP_TABS.PAYMENTS_DONE ? 80
        : ctx.tab === PP_TABS.PAYMENT_BY_ME ? 64
        : 72,
    cell: ({ row }) => {
      const r = row.original;

      if (ctx.tab === PP_TABS.PAYMENTS_DONE) {
        if (!ctx.onEdit) return null;
        return (
          <Button variant="ghost" size="icon" aria-label="Edit payment"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => ctx.onEdit?.(r)}>
            <Pencil className="h-4 w-4" />
          </Button>
        );
      }

      if (ctx.tab === PP_TABS.NEW_PAYMENTS) {
        // "Mark as Paid" (owner, 16 Sep — reverses the 15 Sep "Mark as Done" label).
        // ⚠️ THE LABEL IS NOT THE STATUS: it does NOT write `Paid`. It states that the
        // money went out, moving the row to Reconciliation Pending; the UTR / date /
        // proof are captured later on that tab, which is what actually settles it.
        return (
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700"
              onClick={() => ctx.onRecordPayment?.(r)}>
              <IndianRupee className="mr-1 h-3.5 w-3.5" />
              Mark as Paid
            </Button>
            {ctx.onDelete && (
              <Button variant="ghost" size="icon" aria-label="Delete"
                className="h-7 w-7 text-destructive hover:text-destructive/80"
                onClick={() => ctx.onDelete?.(r)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      }

      // ⚠️ MUST stay above the Approve / Reject fall-through below, or this view-only tab
      // would render approval buttons on every row.
      if (ctx.tab === PP_TABS.PAYMENT_BY_ME) {
        if (!ctx.onDelete || r.status !== APPROVAL_STATUS.REJECTED) {
          return <span className="text-muted-foreground">--</span>;
        }
        return (
          <Button variant="ghost" size="icon" aria-label="Delete"
            className="h-7 w-7 text-destructive hover:text-destructive/80"
            onClick={() => ctx.onDelete?.(r)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        );
      }

      if (ctx.tab === PP_TABS.RECONCILIATION_PENDING) {
        return (
          <Button size="sm" variant="outline"
            className="h-7 border-primary text-primary"
            onClick={() => ctx.onMarkReconciled?.(r)}>
            Mark Reconciled
          </Button>
        );
      }

      // Approve / Reject — the circled icons the screen has always used.
      return (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Approve"
            className="h-7 w-7 text-green-600 hover:text-green-700"
            onClick={() => ctx.onApprove?.(r)}>
            <CircleCheck className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Reject"
            className="h-7 w-7 text-destructive hover:text-destructive/80"
            onClick={() => ctx.onReject?.(r)}>
            <CircleX className="h-5 w-5" />
          </Button>
        </div>
      );
    },
  }),

  // The only column unification adds. Faceted, so the queue narrows to one ledger — or,
  // for payments, to PO or SR. The registry key stays `source`; the column id is the
  // server field it filters and sorts on (see the id note on `against` below).
  source: () => ({
    id: "source_type",
    accessorKey: "source_type",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    cell: ({ row }) => <TypeChip type={row.original.source_type} />,
    // Sized for the longest label, "Non Project Expense", rendered as a pill.
    size: 158,
    meta: { exportHeaderName: "Type", exportValue: (r: ApprovalQueueRow) => TYPE_LABEL[r.source_type] ?? r.source_type },
  }),

  against: (ctx) => ({
    // ⚠️ THE ColumnDef `id` MUST BE THE SERVER FIELD NAME, not the registry key.
    // The table builds `order_by` from the column id, keys faceted filters by it,
    // and `dateFilterColumns` matches on it. An id of "against" made the Against
    // header's sort send `order_by=against`, which the endpoint does not recognise
    // — so it silently fell back to the default sort and the header did nothing.
    id: "against_primary",
    accessorKey: "against_primary",
    // The identity column on every row — the widest content in the table, and the
    // one thing that tells an approver WHAT they are approving. Gets the most.
    // 285 left a visible gap on payment rows — a PO number is ~150px. Trimmed;
    // long descriptions still truncate, with the full text one hover away.
    header: ({ column }) => <DataTableColumnHeader column={column} title="Against" />,
    size: 232,
    cell: ({ row }) => {
      const r = row.original;
      const isPayment = r.source === "Vendor Payment";
      // ⚠️ SPANS, NOT DIVS. On a payment row this whole block becomes the child of
      // the popover's <button> trigger, and a <div> inside a <button> is invalid
      // markup — React warns on every one of the 50 rows a page renders.
      const body = (
        <span className="block min-w-0">
          <span className={isPayment ? "block max-w-[215px] truncate font-mono text-xs" : "block max-w-[215px] truncate font-medium"} title={isPayment ? r.against_primary : undefined}>
            {isPayment ? r.against_primary : firstLine(r.against_primary)}
          </span>
          {!isPayment && r.against_secondary && (
            <span className="block max-w-[215px] truncate text-[10px] font-medium text-muted-foreground">
              {r.against_secondary}
            </span>
          )}
        </span>
      );
      // A payment row IS a PO/WO number, so the whole cell opens that document's
      // card. An expense row has no parent document — it keeps the hover that
      // shows the untrimmed description, which is the only "more" it has.
      if (isPayment) {
        if (!r.document_name) return body;
        return (
          <DocumentDetailPopover
            docName={r.document_name}
            docType={r.document_type}
            vendorLabel={r.vendor ? ctx.vendorLabels.get(r.vendor) : undefined}
            projectId={r.project || undefined}
            projectLabel={r.project ? ctx.projectLabels.get(r.project) : undefined}
          >
            {body}
          </DocumentDetailPopover>
        );
      }
      // Everything trimmed off is one hover away — nothing is lost.
      if (!r.against_full) return body;
      return (
        <HoverCard>
          <HoverCardTrigger asChild><div className="cursor-help">{body}</div></HoverCardTrigger>
          <HoverCardContent className="w-auto max-w-sm p-2 text-xs">
            <p className="whitespace-pre-wrap">{r.against_full}</p>
            {/* The comment lives here, not in the column: it is free text and is
                often an abbreviation only its author can read. */}
            {r.comment_text && (
              <p className="mt-2 border-t pt-2 text-muted-foreground">{r.comment_text}</p>
            )}
          </HoverCardContent>
        </HoverCard>
      );
    },
    meta: {
      exportHeaderName: "Against",
      exportValue: (r: ApprovalQueueRow) => r.against_full || r.against_primary,
    },
  }),

  // One column, not two: the age sub-line makes a separate Waiting column
  // unnecessary. Anything past 30 days reads red — and since the queues now open
  // NEWEST-first (owner, 2026-09-16), that red age IS how a long-waiting row is
  // found, rather than it sitting at the top by default.
  requested_on: (ctx) => ({
    // Same rule: the id is `creation`, the field the union exposes — that is what
    // makes both the sort AND the date filter on this column reach the server.
    id: "creation",
    accessorKey: "creation",
    // 118 is not slack: "15-Sept-2026" measures 126px with cell padding, and the
    // dd-MMM-yyyy format is a house rule. This is the column at its minimum.
    header: ({ column }) => <DataTableColumnHeader column={column} title="Req. On" />,
    size: 118,
    cell: ({ row }) => {
      const r = row.original;
      const days = daysSince(r.creation);
      const unseen = ctx.isUnseen?.(r) ?? false;
      return (
        <div
          className="relative whitespace-nowrap"
          role={unseen ? "button" : undefined}
          tabIndex={unseen ? 0 : undefined}
          onClick={unseen ? () => ctx.onSeen?.(r) : undefined}
        >
          {unseen && (
            <span className="absolute -left-4 top-1.5 h-2 w-2 animate-pulse rounded-full bg-red-500" />
          )}
          <div>{formatDate(r.creation)}</div>
          {days !== null && (
            <div className={`text-[10px] ${days > 30 ? "text-red-600" : "text-muted-foreground"}`}>
              {days} days
            </div>
          )}
        </div>
      );
    },
    meta: { exportHeaderName: "Requested On", exportValue: (r: ApprovalQueueRow) => formatDate(r.creation) },
  }),

  vendor: (ctx) => ({
    id: "vendor",
    accessorKey: "vendor",
    // Starved at 180: real vendor names measure up to 431px. Still truncates, but
    // far fewer rows lose their name.
    header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
    size: 205,
    cell: ({ row }) => {
      const v = row.original.vendor;
      // Blank on every non-project expense, and on 99.4% of project expenses.
      if (!v) return <Blank />;
      const label = ctx.vendorLabels.get(v) || v;
      return (
        <VendorDetailPopover vendorId={v} vendorLabel={label}>
          <span className="block max-w-[190px] truncate" title={label}>{label}</span>
        </VendorDetailPopover>
      );
    },
    meta: {
      exportHeaderName: "Vendor",
      exportValue: (r: ApprovalQueueRow) => (r.vendor ? ctx.vendorLabels.get(r.vendor) || r.vendor : ""),
    },
  }),

  project: (ctx) => ({
    id: "project",
    accessorKey: "project",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
    size: 175,
    cell: ({ row }) => {
      const p = row.original.project;
      // Non-project expenses are company-wide by definition — the blank IS the value.
      if (!p) return <Blank />;
      const label = ctx.projectLabels.get(p) || p;
      return (
        <ProjectDetailPopover projectId={p} projectLabel={label}>
          <span className="block max-w-[160px] truncate" title={label}>{label}</span>
        </ProjectDetailPopover>
      );
    },
    meta: {
      exportHeaderName: "Project",
      exportValue: (r: ApprovalQueueRow) => (r.project ? ctx.projectLabels.get(r.project) || r.project : ""),
    },
  }),

  amount: (ctx) => ({
    id: "amount",
    accessorKey: "amount",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Req. Amount" className="justify-end" />,
    // 128, not 112: "Req. Amount" plus the sort control needs the extra 16px, and
    // a clipped header on a money column reads as a different column.
    size: 128,
    cell: ({ row }) => {
      const r = row.original;
      const figure = (
        <div className="pr-2 text-right font-medium tabular-nums">
          {formatToRoundedIndianRupee(r.amount)}
        </div>
      );
      // WO/PO Value, Total Paid and Payable Against Delivery used to be three
      // separate columns. They are meaningless on an expense row, so rather than
      // three permanently blank columns they live here — context one hover away.
      const isPayment = r.source === "Vendor Payment";
      if (!isPayment || !r.document_name || !ctx.getDocumentTotal) return figure;
      const total = ctx.getDocumentTotal(r.document_name, r.document_type);
      const paid = ctx.getAmountPaid?.(r.document_name) ?? 0;
      const delivered = ctx.getPoAmountDelivered?.(r.document_name, r.document_type) ?? 0;
      const isPO = r.document_type === "Procurement Orders";
      return (
        <HoverCard>
          <HoverCardTrigger asChild><div className="cursor-help">{figure}</div></HoverCardTrigger>
          <HoverCardContent className="w-auto p-2 text-xs">
            <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 tabular-nums">
              <span className="text-muted-foreground">{isPO ? "PO Value" : "WO Value"}</span>
              <span className="text-right">{formatToRoundedIndianRupee(total)}</span>
              <span className="text-muted-foreground">Total Paid</span>
              <span className="text-right">{formatToRoundedIndianRupee(paid)}</span>
              {/* Delivery only means something for a PO — an SR has no delivered value. */}
              <span className="text-muted-foreground">Payable Against Delivery</span>
              <span className="text-right">{isPO ? formatToRoundedIndianRupee(delivered) : "N/A"}</span>
            </div>
          </HoverCardContent>
        </HoverCard>
      );
    },
    meta: { exportHeaderName: "Req. Amount", exportValue: (r: ApprovalQueueRow) => r.amount },
  }),

  // What your click DOES: finish the approval, or forward it to the CEO. Without
  // it an approver cannot tell a 40,000 row (theirs) from a 60,000 one (the CEO's).
  tier: () => ({
    id: "tier",
    accessorKey: "tier",
    // NOT sortable: tier is derived per row in Python from the cast amount, so
    // there is no column in the union to ORDER BY. Offering the control would
    // give a header that appears to work and silently does nothing — sort by
    // Amount instead, which is the same ordering.
    enableSorting: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Tier" />,
    size: 68,
    cell: ({ row }) => <TierChip tier={row.original.tier} />,
    meta: { exportHeaderName: "Tier", exportValue: (r: ApprovalQueueRow) => TIER_LABEL[r.tier] },
  }),

  raised_by: (ctx) => ({
    id: "raised_by",
    accessorKey: "raised_by",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Raised by" />,
    size: 140,
    cell: ({ row }) => {
      const who = row.original.raised_by;
      // Falls back to the email when the user has no Nirmaan Users row — an email
      // is still an answer; a blank would not be.
      return <span className="block max-w-[125px] truncate" title={who}>{ctx.userLabels?.get(who) || who}</span>;
    },
    meta: {
      exportHeaderName: "Raised By",
      exportValue: (r: ApprovalQueueRow) => ctx.userLabels?.get(r.raised_by) || r.raised_by,
    },
  }),

  approved_on: () => dateCol("approved_on", "approved_on", "Approved on"),
  paid_on: () => dateCol("paid_on", "paid_on", "Paid on"),

  // A blank `reconciled_on` is what marks the 10,840 pre-change rows as
  // grandfathered, forever distinguishable from something genuinely reconciled —
  // at no migration cost.
  reconciled_on: () => ({
    id: "reconciled_on",
    accessorKey: "reconciled_on",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Reconciled on" />,
    size: 130,
    enableSorting: false,
    cell: ({ row }) => {
      const r = row.original;
      if (r.reconciled_on) return <span className="whitespace-nowrap">{formatDate(r.reconciled_on)}</span>;
      // An internal transfer never appears on a bank statement, so it could never
      // be reconciled — it is Paid by construction, not grandfathered.
      const internal = r.utr_ref?.startsWith("PO/");
      return (
        <span className="text-[10px] italic text-muted-foreground">
          {internal ? "internal transfer" : "grandfathered"}
        </span>
      );
    },
    meta: { exportHeaderName: "Reconciled On", exportValue: (r: ApprovalQueueRow) => r.reconciled_on || "" },
  }),

  utr_ref: () => ({
    id: "utr_ref",
    accessorKey: "utr_ref",
    header: ({ column }) => <DataTableColumnHeader column={column} title="UTR / Ref" />,
    size: 150,
    cell: ({ row }) =>
      row.original.utr_ref
        ? <TruncatedText text={row.original.utr_ref} className="max-w-[9rem] font-mono text-[11px]" />
        : <Blank />,
    meta: { exportHeaderName: "UTR / Ref", exportValue: (r: ApprovalQueueRow) => r.utr_ref },
  }),

  proof: () => ({
    id: "proof",
    accessorKey: "proof",
    header: "Proof",
    size: 70,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.has_proof ? (
        <a href={`${SITEURL}${row.original.proof}`} target="_blank" rel="noreferrer"
          aria-label="Open payment proof" className="text-primary">
          <Paperclip className="h-3.5 w-3.5" />
        </a>
      ) : <Blank />,
    meta: { exportHeaderName: "Proof", exportValue: (r: ApprovalQueueRow) => (r.has_proof ? "yes" : "") },
  }),

  // Project Expenses only — 99.5% filled, and that ledger's stand-in for Vendor.
  payment_by: () => ({
    id: "payment_by",
    accessorKey: "payment_by",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Payment by" />,
    size: 140,
    cell: ({ row }) => (row.original.payment_by ? <span className="block max-w-[130px] truncate" title={row.original.payment_by}>{row.original.payment_by}</span> : <Blank />),
    meta: { exportHeaderName: "Payment By", exportValue: (r: ApprovalQueueRow) => r.payment_by },
  }),

  // All tab only — the only tab where status varies. On a single-status tab it is
  // one word repeated down the page.
  status: () => ({
    id: "status",
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    size: 170,
    cell: ({ row }) => (
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] whitespace-nowrap">
        {row.original.status}
      </span>
    ),
    meta: { exportHeaderName: "Status", exportValue: (r: ApprovalQueueRow) => r.status },
  }),

  // CEO tab only: the two figures that decide a large payment, in the slots `tier`
  // would have wasted. Wired to the row's project once the rollup hook lands.
  // ⚠️ THESE TWO READ IN LAKHS, UNLIKE EVERY OTHER MONEY COLUMN ON THE SCREEN.
  // They are PROJECT-scale figures sitting beside a PAYMENT-scale one: a project value
  // runs to eight digits where the Amount beside it runs to five or six, so in full
  // rupees the eye cannot tell 1,00,92,552 from 10,09,255 at a glance — and on the CEO
  // tab those two columns exist precisely to be compared against Amount.
  //
  // `formatToApproxLakhs` is the EXISTING app convention for exactly this, not a new
  // one: the Projects list already renders its own project value and cashflow gap
  // through it. Matching it means the same project reads the same on both screens.
  //
  // The EXPORT is deliberately NOT changed — `approvalExportColumns.ts` writes these
  // as raw rupees, so one CSV never mixes two money units and the column still sums.
  project_value: (ctx) => ({
    id: "project_value",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project Value" className="justify-end" />,
    size: 130,
    enableSorting: false,
    cell: ({ row }) => {
      // A non-project expense has no project, so the blank is the true value.
      if (!row.original.project || !ctx.getProjectValue) return <div className="pr-2 text-right"><Blank /></div>;
      return (
        <div className="pr-2 text-right tabular-nums">
          {formatToApproxLakhs(ctx.getProjectValue(row.original.project))}
        </div>
      );
    },
  }),

  cashflow_gap: (ctx) => ({
    id: "cashflow_gap",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Cashflow Gap" className="justify-end" />,
    size: 130,
    enableSorting: false,
    cell: ({ row }) => {
      if (!row.original.project || !ctx.getProjectCashflowGap) return <div className="pr-2 text-right"><Blank /></div>;
      return (
        <div className="pr-2 text-right tabular-nums">
          {formatToApproxLakhs(ctx.getProjectCashflowGap(row.original.project))}
        </div>
      );
    },
  }),
};

/** The tab's id array, mapped over the registry. The array is the order. */
export const buildApprovalColumns = (
  ids: ApprovalColumnId[],
  ctx: ApprovalColumnCtx,
): ColumnDef<ApprovalQueueRow>[] => ids.map((id) => REGISTRY[id](ctx));

export const APPROVAL_COLUMN_IDS = Object.keys(REGISTRY) as ApprovalColumnId[];

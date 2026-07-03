import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { VendorInvoice, VendorInvoiceLine } from "@/types/NirmaanStack/VendorInvoice";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { useFrappeGetDocList, useFrappeGetDoc } from "frappe-react-sdk";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

/** PO-side totals for a single PO line, used for the PO / Invoiced comparison. */
interface POItemTotals {
  item_name?: string;
  unit?: string;
  quantity?: number;
  amount?: number;
}

interface InvoiceDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorInvoices?: VendorInvoice[];
  project?: string;
  poNumber?: string;
  vendor?: string;
  /**
   * Parent doctype of the invoices — controls the number label (PO vs WO) and
   * whether the PO-items comparison is fetched. Defaults to Procurement Orders.
   */
  documentType?: "Procurement Orders" | "Service Requests";
  /**
   * Which invoice statuses to list. Defaults to Approved only (the original
   * behavior for the All-POs / vendor dialogs). Pass e.g. ["Pending","Approved"]
   * to also surface pending invoices (and their item-mapping expand).
   */
  visibleStatuses?: Array<VendorInvoice["status"]>;
}

export const InvoiceDataDialog = ({
  open,
  onOpenChange,
  vendorInvoices,
  project,
  poNumber,
  vendor,
  documentType = "Procurement Orders",
  visibleStatuses = ["Approved"],
}: InvoiceDataDialogProps) => {
  const isPO = documentType === "Procurement Orders";
  const docNumberLabel = isPO ? "PO Number:" : "WO Number:";
  const visibleInvoices = vendorInvoices?.filter(inv => visibleStatuses.includes(inv.status)) ?? [];

  // `invoice_attachment` on a Vendor Invoice is a Link to a `Nirmaan Attachments`
  // doc (an ID, not a file URL). Resolve IDs → file URLs in one batch when the
  // dialog is open.
  const attachmentIds = useMemo(
    () => visibleInvoices.map(inv => inv.invoice_attachment).filter((id): id is string => !!id),
    [visibleInvoices]
  );

  const { data: attachmentDocs } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment"],
      filters: [["name", "in", attachmentIds]],
      limit: attachmentIds.length || 1,
    },
    open && attachmentIds.length > 0
      ? `InvoiceDataDialog-Attachments-${attachmentIds.join(",")}`
      : null
  );

  const attachmentUrlById = useMemo(() => {
    const map = new Map<string, string>();
    attachmentDocs?.forEach(doc => {
      if (doc.attachment) map.set(doc.name, doc.attachment);
    });
    return map;
  }, [attachmentDocs]);

  // PO line totals for the "PO / Invoiced" comparison. Fetched once per open
  // dialog; child rows resolve by their `name` (what line_mappings.po_item_row
  // stores) with item_id as a fallback for legacy / post-revision rows.
  const { data: poDoc } = useFrappeGetDoc<{ items?: any[] }>(
    "Procurement Orders",
    poNumber,
    open && poNumber && isPO ? `InvoiceDataDialog-PO-${poNumber}` : null
  );

  const { poItemsByRow, poItemsById } = useMemo(() => {
    const byRow = new Map<string, POItemTotals>();
    const byId = new Map<string, POItemTotals>();
    (poDoc?.items || []).forEach((it: any) => {
      const totals: POItemTotals = {
        item_name: it.item_name,
        unit: it.unit,
        quantity: it.quantity,
        amount: it.amount,
      };
      if (it.name) byRow.set(it.name, totals);
      if (it.item_id) byId.set(it.item_id, totals);
    });
    return { poItemsByRow: byRow, poItemsById: byId };
  }, [poDoc]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-start max-h-[85vh] overflow-y-auto sm:max-w-3xl md:max-w-4xl">
        <DialogHeader className="text-start">
          <DialogTitle className="sr-only">Invoice Details</DialogTitle>
          <div className="flex flex-wrap gap-4 mb-2">
            {project && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Project:</Label>
                <span className="text-sm font-medium">{project}</span>
              </div>
            )}
            {poNumber && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[100px]">{docNumberLabel}</Label>
                <span className="text-sm font-medium">{poNumber}</span>
              </div>
            )}
            {vendor && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Vendor:</Label>
                <span className="text-sm font-medium">{vendor}</span>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-100">
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Invoice Date</TableHead>
                <TableHead>Invoice No.</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attachment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleInvoices.length > 0 ? (
                visibleInvoices.map((inv) => (
                  <InvoiceRow
                    key={inv.name}
                    inv={inv}
                    open={open}
                    fileUrl={inv.invoice_attachment ? attachmentUrlById.get(inv.invoice_attachment) : undefined}
                    poItemsByRow={poItemsByRow}
                    poItemsById={poItemsById}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    No valid invoice data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface InvoiceRowProps {
  inv: VendorInvoice;
  /** Dialog open — gates the per-invoice fetch so closed dialogs fetch nothing. */
  open: boolean;
  fileUrl?: string;
  poItemsByRow: Map<string, POItemTotals>;
  poItemsById: Map<string, POItemTotals>;
}

/**
 * One invoice row. Fetches its own `line_mappings` (same pattern the approval
 * screen uses) so we know upfront whether it has matched items: the expand
 * chevron is shown ONLY when there is a mapping to reveal.
 */
const InvoiceRow = ({ inv, open, fileUrl, poItemsByRow, poItemsById }: InvoiceRowProps) => {
  const [expanded, setExpanded] = useState(false);

  const { data: fullInvoice } = useFrappeGetDoc<VendorInvoice>(
    "Vendor Invoices",
    inv.name,
    open ? `InvoiceDataDialog-Mapping-${inv.name}` : null
  );

  const lines: VendorInvoiceLine[] = fullInvoice?.line_mappings ?? [];
  const matched = lines.filter((l) => l.match_status === "Matched");
  const hasMapping = matched.length > 0;

  // Pending invoices are tinted red so reviewers can tell them apart from the
  // already-approved ones (the list can now be mixed-status).
  const isPending = inv.status === "Pending";
  const rowClass = [
    isPending ? "bg-red-50" : "",
    hasMapping ? `cursor-pointer ${isPending ? "hover:bg-red-100" : "hover:bg-gray-50"}` : "",
  ].filter(Boolean).join(" ");

  return (
    <Fragment>
      <TableRow
        className={rowClass}
        onClick={() => hasMapping && setExpanded((o) => !o)}
      >
        <TableCell className="w-8 text-gray-500">
          {hasMapping ? (
            expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : null}
        </TableCell>
        <TableCell className="font-medium whitespace-nowrap">
          {inv.invoice_date ? formatDate(inv.invoice_date) : 'N/A'}
        </TableCell>
        <TableCell>{inv.invoice_no || '--'}</TableCell>
        <TableCell className="text-right">
          {formatToRoundedIndianRupee(inv.invoice_amount)}
        </TableCell>
        <TableCell>
          <Badge variant={inv.status === "Approved" ? "green" : inv.status === "Rejected" ? "destructive" : "red"}>
            {inv.status}
          </Badge>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {fileUrl ? (
            <a
              href={`${SITEURL}${fileUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              View Attach <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            'N/A'
          )}
        </TableCell>
      </TableRow>

      {expanded && hasMapping && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="bg-gray-50 p-0">
            <InvoiceMappingTable lines={lines} poItemsByRow={poItemsByRow} poItemsById={poItemsById} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
};

interface InvoiceMappingTableProps {
  lines: VendorInvoiceLine[];
  poItemsByRow: Map<string, POItemTotals>;
  poItemsById: Map<string, POItemTotals>;
}

/** Matched items of one invoice, with a PO / Invoiced comparison of qty + amount. */
const InvoiceMappingTable = ({ lines, poItemsByRow, poItemsById }: InvoiceMappingTableProps) => {
  const matched = lines.filter((l) => l.match_status === "Matched");
  const unmatched = lines.filter((l) => l.match_status === "Unmatched").length;
  const nonItem = lines.filter((l) => l.match_status === "Non-Item").length;

  const poFor = (l: VendorInvoiceLine): POItemTotals | undefined =>
    (l.po_item_row ? poItemsByRow.get(l.po_item_row) : undefined) ??
    (l.po_item_id ? poItemsById.get(l.po_item_id) : undefined);

  return (
    <div className="p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
        <span className="font-medium text-gray-700">
          {matched.length}/{lines.length} lines matched to PO items
        </span>
        {unmatched > 0 && <Badge variant="orange">{unmatched} unmatched</Badge>}
        {nonItem > 0 && <Badge variant="gray">{nonItem} charge{nonItem === 1 ? "" : "s"}</Badge>}
      </div>

      <div className="border rounded-md overflow-x-auto bg-white">
        <table className="w-full min-w-[420px] text-xs">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              <th className="text-left px-2 py-1.5 font-medium">Matched PO Item</th>
              <th className="text-right px-2 py-1.5 font-medium w-40">Qty (PO / Inv)</th>
              <th className="text-right px-2 py-1.5 font-medium w-48">Amount (PO / Inv)</th>
            </tr>
          </thead>
          <tbody>
            {matched.map((l, i) => {
              const po = poFor(l);
              return (
                <tr key={l.name || i} className={`border-t align-top ${l.is_over_billed ? "bg-red-50" : ""}`}>
                  <td className="px-2 py-1.5 text-gray-900">
                    <div className="break-words">
                      {l.po_item_name || po?.item_name || l.po_item_id || "—"}
                      {po?.unit ? <span className="text-gray-400"> · {po.unit}</span> : null}
                    </div>
                    {l.is_over_billed ? (
                      <Badge
                        variant="red"
                        className="mt-0.5 text-[10px] px-1.5 py-0 inline-flex items-center gap-0.5"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" /> over PO
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                    <span className="text-gray-500">{po?.quantity ?? "—"}</span>
                    {" / "}
                    <span className={l.is_over_billed ? "text-red-700 font-semibold" : "text-gray-900"}>
                      {l.quantity ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                    <span className="text-gray-500">
                      {po?.amount != null ? formatToRoundedIndianRupee(po.amount) : "—"}
                    </span>
                    {" / "}
                    <span className={l.is_over_billed ? "text-red-700 font-semibold" : "text-gray-900"}>
                      {l.amount != null ? formatToRoundedIndianRupee(l.amount) : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

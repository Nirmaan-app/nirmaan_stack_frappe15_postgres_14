/**
 * Shared per-invoice line → PO-item mapping view.
 *
 * Renders an invoice's MATCHED line items with a PO / Invoiced comparison of
 * quantity and amount. Two entry points:
 *   - `InvoiceMappingTable` — pure render given already-fetched `lines`.
 *   - `InvoiceMappingExpand` — lazily fetches one invoice's `line_mappings`
 *     (mounts only when a row is expanded) then renders the table.
 * `usePoItemTotals` builds the PO-side totals used for the comparison.
 */
import { useMemo } from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { VendorInvoice, VendorInvoiceLine } from "@/types/NirmaanStack/VendorInvoice";

/** PO-side totals for a single PO line, used for the PO / Invoiced comparison. */
export interface POItemTotals {
  item_name?: string;
  unit?: string;
  quantity?: number;
  amount?: number;
}

/**
 * Build PO-line totals for a PO, keyed by child-row `name` (what
 * line_mappings.po_item_row stores) with item_id as a fallback for legacy /
 * post-revision rows. Fetches the PO doc once; disabled when `enabled` is false.
 */
export const usePoItemTotals = (poName?: string, enabled: boolean = true) => {
  const { data: poDoc } = useFrappeGetDoc<{ items?: any[] }>(
    "Procurement Orders",
    poName,
    enabled && poName ? `InvoiceMapping-PO-${poName}` : null
  );

  return useMemo(() => {
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
};

interface InvoiceMappingTableProps {
  lines: VendorInvoiceLine[];
  poItemsByRow: Map<string, POItemTotals>;
  poItemsById: Map<string, POItemTotals>;
}

/** Matched items of one invoice, with a PO / Invoiced comparison of qty + amount. */
export const InvoiceMappingTable = ({ lines, poItemsByRow, poItemsById }: InvoiceMappingTableProps) => {
  const matched = lines.filter((l) => l.match_status === "Matched");
  const unmatched = lines.filter((l) => l.match_status === "Unmatched").length;
  const nonItem = lines.filter((l) => l.match_status === "Non-Item").length;

  const poFor = (l: VendorInvoiceLine): POItemTotals | undefined =>
    (l.po_item_row ? poItemsByRow.get(l.po_item_row) : undefined) ??
    (l.po_item_id ? poItemsById.get(l.po_item_id) : undefined);

  if (matched.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-500">
        No matched items on this invoice
        {unmatched + nonItem > 0
          ? ` (${unmatched} unmatched, ${nonItem} charge${nonItem === 1 ? "" : "s"}).`
          : "."}
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs mb-2 px-2">
        <span className="font-medium text-gray-700">
          {matched.length}/{lines.length} lines matched to PO items
        </span>
        {unmatched > 0 && <Badge variant="orange">{unmatched} unmatched</Badge>}
        {nonItem > 0 && <Badge variant="gray">{nonItem} charge{nonItem === 1 ? "" : "s"}</Badge>}
      </div>

      <div className="border-y overflow-hidden bg-white">
        <table className="w-full text-xs">
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

/**
 * Fetch one invoice's `line_mappings` and report whether it has MATCHED items.
 * `enabled` gates the fetch (pass false for non-autofilled invoices, which can
 * never have mappings) so we only hit the network for real candidates. Used to
 * decide upfront whether an expand chevron should be shown at all.
 */
export const useInvoiceMatchedLines = (invoiceName: string, enabled: boolean) => {
  const { data, isLoading } = useFrappeGetDoc<VendorInvoice>(
    "Vendor Invoices",
    invoiceName,
    enabled ? `InvoiceMapping-Lines-${invoiceName}` : null
  );
  const lines: VendorInvoiceLine[] = data?.line_mappings ?? [];
  const matched = lines.filter((l) => l.match_status === "Matched");
  return { lines, matched, hasMapping: matched.length > 0, isLoading };
};

/**
 * Read-only render of a saved invoice-line → PO-item mapping (the
 * `line_mappings` child rows on a Vendor Invoice).
 *
 * This is the RESURFACE half of the mapping feature: the upload-time Review step
 * (LineItemMappingReview) captures + corrects the mapping; this shows it back to
 * whoever later views/approves the invoice. Display-only — no editing here.
 */
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { VendorInvoiceLine } from "@/types/NirmaanStack/VendorInvoice";

const SOURCE_BADGE: Record<string, { label: string; variant: any }> = {
  Fuzzy: { label: "auto", variant: "green" },
  AI: { label: "AI", variant: "blue" },
  Manual: { label: "you", variant: "purple" },
};

interface Props {
  lines: VendorInvoiceLine[];
  /** Optional heading; omit to render bare (e.g. inside an existing section). */
  title?: string;
  className?: string;
}

export const MappingTableView = ({ lines, title, className }: Props) => {
  if (!lines || lines.length === 0) return null;

  const matched = lines.filter((l) => l.match_status === "Matched").length;
  const unmatched = lines.filter((l) => l.match_status === "Unmatched").length;
  const nonItem = lines.filter((l) => l.match_status === "Non-Item").length;
  const overBilled = lines.filter((l) => l.is_over_billed).length;

  return (
    <div className={className}>
      {title && <div className="text-xs font-semibold text-gray-700 mb-1.5">{title}</div>}

      <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
        <span className="font-medium text-gray-700">
          {matched}/{lines.length} lines mapped to PO items
        </span>
        {unmatched > 0 && <Badge variant="orange">{unmatched} unmatched</Badge>}
        {nonItem > 0 && <Badge variant="gray">{nonItem} charges</Badge>}
        {overBilled > 0 && (
          <Badge variant="red" className="inline-flex items-center gap-0.5">
            <AlertTriangle className="h-2.5 w-2.5" /> {overBilled} over PO
          </Badge>
        )}
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-2 py-1.5 font-medium">Invoice line</th>
              <th className="text-right px-2 py-1.5 font-medium w-20">Qty</th>
              <th className="text-right px-2 py-1.5 font-medium w-24">Amount</th>
              <th className="text-left px-2 py-1.5 font-medium w-[38%]">Mapped to PO item</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const src = l.match_source && SOURCE_BADGE[l.match_source];
              return (
                <tr key={l.name || i} className="border-t align-top">
                  <td className="px-2 py-1.5 text-gray-900">
                    <div className="break-words">
                      {l.description || <span className="text-gray-400 italic">—</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      {src && (
                        <Badge variant={src.variant} className="text-[10px] px-1.5 py-0">
                          {src.label}
                          {l.match_score != null && l.match_source === "Fuzzy"
                            ? ` ${Math.round(l.match_score * 100)}%`
                            : ""}
                        </Badge>
                      )}
                      {l.is_over_billed ? (
                        <Badge
                          variant="red"
                          className="text-[10px] px-1.5 py-0 inline-flex items-center gap-0.5"
                        >
                          <AlertTriangle className="h-2.5 w-2.5" /> over PO
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 tabular-nums">
                    {l.quantity ?? "—"}
                    {l.uom ? <span className="text-gray-400"> {l.uom}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 tabular-nums">
                    {l.amount != null ? formatToRoundedIndianRupee(l.amount) : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {l.match_status === "Matched" ? (
                      <span className="text-gray-900">{l.po_item_name || l.po_item_id || "—"}</span>
                    ) : l.match_status === "Non-Item" ? (
                      <span className="text-gray-500 italic">Not a PO item (charge)</span>
                    ) : (
                      <span className="text-orange-600">No PO item assigned</span>
                    )}
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

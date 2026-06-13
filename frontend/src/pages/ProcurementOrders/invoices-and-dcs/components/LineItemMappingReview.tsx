/**
 * Review surface shown between Upload and the final form when an invoice is
 * attached to a PO and the extractor returned line items.
 *
 * It (1) REPRESENTS the AI extraction (which had no UI before) and (2) lets the
 * reviewer VERIFY/correct the invoice-line → PO-item mapping the backend
 * proposed (fuzzy-first, Gemini-resolved residue). The corrected mapping is what
 * gets persisted on submit. Editing is mapping-only — extracted values are
 * read-only (the user verifies the read, they don't rewrite the invoice).
 */
import { useMemo } from "react";
import Select from "react-select";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AlertTriangle } from "lucide-react";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import {
  humanizeEntityType,
  formatEntityValue,
  confColorClass,
} from "@/pages/tasks/invoices/utils/autofillEntityDisplay";

export interface POItem {
  item_id?: string | null;
  item_name?: string | null;
  unit?: string | null;
  quantity?: number | null;
  received_quantity?: number | null;
  quote?: number | null;
  amount?: number | null;
}

export interface MappingRow {
  invoice_line_index: number;
  description?: string | null;
  unit?: string | null;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
  po_item_id?: string | null;
  po_item_name?: string | null;
  po_row?: number | null;
  score?: number | null;
  source?: string | null;
  status: "matched" | "unmatched" | "non_item";
  over_billing?: {
    would_exceed: boolean;
    amount_exceeded: boolean;
    qty_exceeded: boolean;
    po_amount: number | null;
    invoice_amount: number | null;
    po_qty: number | null;
    invoice_qty: number | null;
  } | null;
}

export interface LineMatch {
  mappings: MappingRow[];
  unmatched_po_items: POItem[];
  summary: Record<string, number>;
}

interface Props {
  extracted: any; // full extraction response (raw JSON + entities + scalars)
  poItems: POItem[];
  lineMatch: LineMatch;
  onChange: (next: LineMatch) => void;
}

type Opt = { value: string; label: string; row: number; nonItem: boolean };

const NON_ITEM_VALUE = "__non_item__";

const num = (v: any): number | null =>
  v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v);

function recomputeOverbill(m: MappingRow, po: POItem) {
  const ia = num(m.amount), pa = num(po.amount), iq = num(m.quantity), pq = num(po.quantity);
  const amount_exceeded = ia !== null && pa !== null && ia > pa + 10;
  const qty_exceeded = iq !== null && pq !== null && iq > pq + 0.001;
  return {
    would_exceed: amount_exceeded || qty_exceeded,
    amount_exceeded, qty_exceeded,
    po_amount: pa, invoice_amount: ia, po_qty: pq, invoice_qty: iq,
  };
}

const SOURCE_BADGE: Record<string, { label: string; variant: any }> = {
  fuzzy: { label: "auto", variant: "green" },
  gemini: { label: "AI", variant: "blue" },
  manual: { label: "you", variant: "purple" },
};

export const LineItemMappingReview = ({ extracted, poItems, lineMatch, onChange }: Props) => {
  const poOptions = useMemo<Opt[]>(
    () => [
      { value: NON_ITEM_VALUE, label: "⊘  Not a PO item (freight / charge)", row: -1, nonItem: true },
      ...poItems.map((p, i) => ({
        value: String(i),
        label: `${p.item_name ?? "—"}  ·  ${p.unit ?? ""}  ·  ${
          p.quote != null ? formatToRoundedIndianRupee(p.quote) : ""
        }`,
        row: i,
        nonItem: false,
      })),
    ],
    [poItems]
  );

  const currentOption = (m: MappingRow): Opt | null => {
    if (m.status === "non_item") return poOptions[0];
    if (m.status === "matched" && m.po_row != null)
      return poOptions.find((o) => o.row === m.po_row) ?? null;
    return null;
  };

  const handleRowChange = (lineIndex: number, opt: Opt | null) => {
    const mappings = lineMatch.mappings.map((m) => {
      if (m.invoice_line_index !== lineIndex) return m;
      if (!opt) {
        return { ...m, status: "unmatched" as const, source: "manual", po_item_id: null, po_item_name: null, po_row: null, score: null, over_billing: null };
      }
      if (opt.nonItem) {
        return { ...m, status: "non_item" as const, source: "manual", po_item_id: null, po_item_name: null, po_row: null, score: null, over_billing: null };
      }
      const po = poItems[opt.row];
      return {
        ...m, status: "matched" as const, source: "manual",
        po_item_id: po.item_id ?? null, po_item_name: po.item_name ?? null, po_row: opt.row,
        score: null, over_billing: recomputeOverbill(m, po),
      };
    });
    onChange({ ...lineMatch, mappings });
  };

  const entities: Array<{ type: string; value: string; confidence: number }> = Array.isArray(extracted?.entities)
    ? extracted.entities
    : [];
  const s = lineMatch.summary || {};

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-gray-700">AI mapped {s.matched ?? 0}/{lineMatch.mappings.length} lines to PO items.</span>
        {(s.unmatched ?? 0) > 0 && <Badge variant="orange">{s.unmatched} unmatched</Badge>}
        {(s.non_item ?? 0) > 0 && <Badge variant="gray">{s.non_item} charges</Badge>}
        {(s.over_billed ?? 0) > 0 && <Badge variant="red">{s.over_billed} over-billed</Badge>}
        <span className="text-muted-foreground">Verify each row before continuing.</span>
      </div>

      {/* Mapping table */}
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-2 py-1.5 font-medium">Invoice line</th>
              <th className="text-right px-2 py-1.5 font-medium w-20">Qty</th>
              <th className="text-right px-2 py-1.5 font-medium w-24">Amount</th>
              <th className="text-left px-2 py-1.5 font-medium w-[40%]">Maps to PO item</th>
            </tr>
          </thead>
          <tbody>
            {lineMatch.mappings.map((m) => {
              const ob = m.over_billing?.would_exceed;
              return (
                <tr key={m.invoice_line_index} className="border-t align-top">
                  <td className="px-2 py-1.5 text-gray-900">
                    <div className="break-words">{m.description || <span className="text-gray-400 italic">—</span>}</div>
                    <div className="mt-0.5 flex items-center gap-1">
                      {m.source && SOURCE_BADGE[m.source] && (
                        <Badge variant={SOURCE_BADGE[m.source].variant} className="text-[10px] px-1.5 py-0">
                          {SOURCE_BADGE[m.source].label}
                          {m.score != null ? ` ${Math.round(m.score * 100)}%` : ""}
                        </Badge>
                      )}
                      {ob && (
                        <Badge variant="red" className="text-[10px] px-1.5 py-0 inline-flex items-center gap-0.5">
                          <AlertTriangle className="h-2.5 w-2.5" /> over PO
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 tabular-nums">
                    {m.quantity ?? "—"}{m.unit ? <span className="text-gray-400"> {m.unit}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 tabular-nums">
                    {m.amount != null ? formatToRoundedIndianRupee(m.amount) : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <Select<Opt>
                      classNamePrefix="react-select"
                      options={poOptions}
                      value={currentOption(m)}
                      onChange={(opt) => handleRowChange(m.invoice_line_index, opt as Opt | null)}
                      isClearable
                      placeholder="Select PO item…"
                      menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                      menuPosition="fixed"
                      styles={{
                        menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                        control: (base) => ({ ...base, minHeight: 30, fontSize: 12 }),
                        menu: (base) => ({ ...base, fontSize: 12 }),
                      }}
                    />
                    {m.status === "unmatched" && (
                      <span className="text-[10px] text-orange-600">No PO item assigned</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Collapsible: full extraction + raw JSON */}
      <Accordion type="multiple" className="border rounded-md">
        <AccordionItem value="entities" className="border-b">
          <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
            All extracted fields ({entities.length})
          </AccordionTrigger>
          <AccordionContent className="px-0 pb-0">
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Field</th>
                    <th className="text-left px-3 py-1.5 font-medium text-gray-600">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map((e, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-1 text-[11px] text-gray-700 align-top">{humanizeEntityType(e.type)}</td>
                      <td className={`px-3 py-1 break-words ${confColorClass(e.confidence)}`}>
                        {formatEntityValue(e.type, e.value) || <span className="text-gray-400 italic">empty</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="json" className="border-b-0">
          <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">Raw JSON</AccordionTrigger>
          <AccordionContent>
            <pre className="font-mono text-[10px] leading-relaxed bg-gray-50 p-3 rounded max-h-72 overflow-auto">
              {JSON.stringify({ line_items: extracted?.line_items, line_match: lineMatch }, null, 2)}
            </pre>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

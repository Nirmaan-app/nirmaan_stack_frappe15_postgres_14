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
import { useMemo, useRef, useState } from "react";
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
  /**
   * Opt-in: make the per-line QUANTITY editable (default false = read-only).
   * The normal Add-Invoice flow keeps qty read-only ("verify the read, don't
   * rewrite the invoice"); the temporary Resolve-Invoices tool turns this on so
   * an admin can correct a mis-read quantity while fixing the PO-item mapping.
   */
  editableQty?: boolean;
}

type Opt = { value: string; label: string; row: number; nonItem: boolean };

const NON_ITEM_VALUE = "__non_item__";

const num = (v: any): number | null =>
  v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v);

// True only when a qty genuinely differs from the original (a no-op re-type of the
// same value is NOT a change). null/blank vs a number counts as a change.
const qtyChanged = (a: number | null, b: number | null): boolean => {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) > 1e-9;
};

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

// Row badge: any system match (fuzzy OR gemini) shows "Auto" (green); the
// gemini/fuzzy distinction isn't surfaced. "Manual" (purple) once the user edits.
function sourceBadge(m: MappingRow): { label: string; variant: any } | null {
  if (m.source === "manual") return { label: "Manual", variant: "purple" };
  if (m.source === "fuzzy" || m.source === "gemini") return { label: "Auto", variant: "green" };
  return null;
}

// Human reason a matched row is flagged "over PO" (qty and/or amount exceeded).
function overReason(ob: MappingRow["over_billing"]): string {
  if (!ob) return "";
  const parts: string[] = [];
  if (ob.qty_exceeded && ob.invoice_qty != null && ob.po_qty != null)
    parts.push(`qty ${ob.invoice_qty} > ordered ${ob.po_qty}`);
  if (ob.amount_exceeded && ob.invoice_amount != null && ob.po_amount != null)
    parts.push(`${formatToRoundedIndianRupee(ob.invoice_amount)} > PO ${formatToRoundedIndianRupee(ob.po_amount)}`);
  return parts.join(" · ");
}

export const LineItemMappingReview = ({ extracted, poItems, lineMatch, onChange, editableQty = false }: Props) => {
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

  // Editable-qty (opt-in). Keep the raw keystroke string per row so partial
  // decimals ("1.") don't get clobbered by Number(); push the parsed number to
  // the mapping and re-derive the over-billing flag for a matched row.
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});

  // Remember each row's ORIGINAL AI qty + source (captured before any edit), so
  // re-typing the SAME value keeps it "Auto AI" and only a real change → "Manual".
  const originalRef = useRef<Record<number, { quantity: number | null; source: string | null }>>({});
  lineMatch.mappings.forEach((m) => {
    if (!(m.invoice_line_index in originalRef.current)) {
      originalRef.current[m.invoice_line_index] = { quantity: m.quantity ?? null, source: m.source ?? null };
    }
  });

  const handleQtyChange = (lineIndex: number, raw: string) => {
    setQtyDraft((d) => ({ ...d, [lineIndex]: raw }));
    const n = raw.trim() === "" ? null : Number(raw);
    const q = n === null || isNaN(n) ? null : n;
    const mappings = lineMatch.mappings.map((m) => {
      if (m.invoice_line_index !== lineIndex) return m;
      // "Manual" only if the qty actually differs from the original AI value; a no-op
      // re-type of the same number stays on its original AI source (badge = "Auto AI").
      const orig = originalRef.current[lineIndex];
      const changed = qtyChanged(q, orig?.quantity ?? null);
      const next: MappingRow = { ...m, quantity: q, source: changed ? "manual" : (orig?.source ?? m.source) };
      if (next.status === "matched" && next.po_row != null && poItems[next.po_row]) {
        next.over_billing = recomputeOverbill(next, poItems[next.po_row]);
      }
      return next;
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
              <th className="text-right px-2 py-1.5 font-medium w-24">Qty</th>
              <th className="text-right px-2 py-1.5 font-medium w-28">Rate</th>
              <th className="text-left px-2 py-1.5 font-medium w-[38%]">Maps to PO item</th>
            </tr>
          </thead>
          <tbody>
            {lineMatch.mappings.map((m) => {
              const ob = m.over_billing?.would_exceed;
              const reason = ob ? overReason(m.over_billing) : "";
              const badge = sourceBadge(m);
              // Matched PO item (for the inv/PO comparison columns).
              const po = m.status === "matched" && m.po_row != null ? poItems[m.po_row] : null;
              const poQty = po ? num(po.quantity) : null;
              const poRate = po ? num(po.quote) : null;
              const iq = num(m.quantity);
              const ia = num(m.amount);
              // Invoice rate: prefer the extracted rate, else derive amount ÷ qty.
              const invRate = num(m.rate) ?? (ia != null && iq != null && iq !== 0 ? ia / iq : null);
              return (
                <tr key={m.invoice_line_index} className="border-t align-top">
                  <td className="px-2 py-1.5 text-gray-900">
                    <div className="break-words">{m.description || <span className="text-gray-400 italic">—</span>}</div>
                    <div className="mt-0.5 flex items-center gap-1">
                      {badge && (
                        <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0">
                          {badge.label}
                        </Badge>
                      )}
                      {ob && (
                        <Badge variant="red" title={reason ? `Over PO — ${reason}` : undefined} className="text-[10px] px-1.5 py-0 inline-flex items-center gap-0.5">
                          <AlertTriangle className="h-2.5 w-2.5" /> over PO
                        </Badge>
                      )}
                    </div>
                    {ob && reason && (
                      <div className="mt-0.5 text-[10px] text-red-600 leading-snug">Over PO — {reason}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 tabular-nums">
                    <div className="flex flex-col items-end gap-0.5">
                      {editableQty ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            inputMode="decimal"
                            className="w-16 h-7 rounded border px-1.5 text-right text-xs"
                            value={qtyDraft[m.invoice_line_index] ?? (m.quantity ?? "")}
                            onChange={(e) => handleQtyChange(m.invoice_line_index, e.target.value)}
                          />
                          {m.unit ? <span className="text-[11px] text-gray-500">{m.unit}</span> : null}
                        </div>
                      ) : (
                        <span>{m.quantity ?? "—"}{m.unit ? <span className="text-gray-400"> {m.unit}</span> : null}</span>
                      )}
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">PO: {poQty ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 tabular-nums">
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{invRate != null ? formatToRoundedIndianRupee(invRate) : "—"}</span>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">PO: {poRate != null ? formatToRoundedIndianRupee(poRate) : "—"}</span>
                    </div>
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
                        // pointerEvents:auto re-enables clicks on the portalled menu inside a
                        // modal Radix dialog (which sets pointer-events:none on everything outside
                        // the dialog) — without it options are only selectable by keyboard.
                        menuPortal: (base) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
                        // Let the control grow and the selected value WRAP so the full PO-item name
                        // is readable after selection (default react-select truncates to one line).
                        control: (base) => ({ ...base, minHeight: 30, height: "auto", fontSize: 12 }),
                        valueContainer: (base) => ({ ...base, overflow: "visible" }),
                        singleValue: (base) => ({ ...base, whiteSpace: "normal", overflow: "visible", textOverflow: "clip" }),
                        menu: (base) => ({ ...base, fontSize: 12 }),
                        option: (base) => ({ ...base, whiteSpace: "normal" }),
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
          <AccordionTrigger className="px-3 py-2 text-xs font-medium text-green-900 bg-green-50 hover:bg-green-100/70 hover:no-underline">
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
          <AccordionTrigger className="px-3 py-2 text-xs font-medium text-blue-800 bg-blue-50 hover:bg-blue-100/70 hover:no-underline">Raw JSON</AccordionTrigger>
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

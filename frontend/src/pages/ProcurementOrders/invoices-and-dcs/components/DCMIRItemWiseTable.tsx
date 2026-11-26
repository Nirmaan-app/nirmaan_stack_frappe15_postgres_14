import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Info } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";
import type { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";
import {
  buildItemWiseRows,
  buildItmItemWiseRows,
  countByStatus,
  docLabel,
  ITEM_WISE_STATUS_LABEL,
  type ItemWiseDocRef,
  type ItemWiseRow,
  type ItemWiseStatus,
} from "@/utils/dcMirItemWise";
import { formatDate } from "@/utils/FormatDate";

import { useFittingLayout } from "../hooks/useFittingLayout";

/**
 * Which parent the card belongs to. PO: "Ordered" column, PO status rule, Non-Billable
 * items. ITM: "Transfer Qty" column, ITM status rule, "–" for nothing received and no DC.
 */
type DCMIRItemWiseSource =
  | { kind: "po"; items: PurchaseOrderItem[] }
  | { kind: "itm"; items: InternalTransferMemoItem[] };

type DCMIRItemWiseTableProps = DCMIRItemWiseSource & {
  /** The parent's DCs and MIRs, as `usePODeliveryDocuments` returns them. */
  documents: PODeliveryDocuments[];
  /**
   * Called with a document's `name` when its DC/MIR number is clicked, so the caller can
   * show it in the DC-wise view. Without it the numbers render as plain text.
   */
  onDocClick?: (docName: string) => void;
};

const STATUS_CLASSES: Record<Exclude<ItemWiseStatus, "no_activity">, string> = {
  matched: "bg-green-100 text-green-700 border-green-300",
  mismatch: "bg-amber-100 text-amber-700 border-amber-300",
  no_dc_update: "bg-red-100 text-red-700 border-red-300",
  pending_dn: "bg-blue-100 text-blue-700 border-blue-300",
  partially_delivered: "bg-orange-100 text-orange-700 border-orange-300",
  not_billable: "bg-gray-100 text-gray-600 border-gray-300",
};

/** The order the Status filter lists its options in. */
const STATUS_ORDER = Object.keys(ITEM_WISE_STATUS_LABEL) as ItemWiseStatus[];

/** The Status filter's option text: "–" alone would say nothing in a list. */
const filterLabel = (status: ItemWiseStatus) =>
  status === "no_activity" ? "– Nothing received yet" : ITEM_WISE_STATUS_LABEL[status];

/** A quantity without float noise: 0.1 + 0.2 shows as 0.3, whole numbers stay whole. */
const formatQty = (n: number) => String(Number(n.toFixed(2)));

const StatusBadge: React.FC<{ status: ItemWiseStatus }> = ({ status }) =>
  status === "no_activity" ? (
    <span className="text-muted-foreground" title="Nothing received and no DC yet">
      –
    </span>
  ) : (
    <Badge variant="outline" className={cn("whitespace-nowrap text-xs", STATUS_CLASSES[status])}>
      {ITEM_WISE_STATUS_LABEL[status]}
    </Badge>
  );

const DocTypeBadge: React.FC<{ type: ItemWiseDocRef["type"] }> = ({ type }) => (
  <Badge
    variant="outline"
    className={cn(
      "text-xs",
      type === "Delivery Challan"
        ? "bg-blue-50 text-blue-700 border-blue-200"
        : "bg-orange-50 text-orange-700 border-orange-200"
    )}
  >
    {type === "Delivery Challan" ? "DC" : "MIR"}
  </Badge>
);

/** Received − DC Qty; red when DCs are short, "+N extra" in red when they cover more than was received. */
const DCPending: React.FC<{ row: ItemWiseRow }> = ({ row }) => {
  if (!row.billable || row.receivedQty === 0) return <span className="text-muted-foreground">–</span>;
  if (row.dcPending < 0) {
    return (
      <span
        className="font-semibold text-red-600"
        title={`DCs cover ${formatQty(-row.dcPending)} more than received`}
      >
        +{formatQty(-row.dcPending)} extra
      </span>
    );
  }
  if (row.dcPending > 0) return <span className="font-semibold text-red-600">{formatQty(row.dcPending)}</span>;
  return <span>0</span>;
};

/** "2 DCs · 1 MIR" */
const docSummary = (row: ItemWiseRow) => {
  const dcs = row.docs.filter((d) => d.type === "Delivery Challan").length;
  const mirs = row.docs.length - dcs;
  return [dcs ? `${dcs} DC${dcs === 1 ? "" : "s"}` : "", mirs ? `${mirs} MIR${mirs === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(" · ");
};

const DocChips: React.FC<{ row: ItemWiseRow; onDocClick?: (docName: string) => void }> = ({ row, onDocClick }) => (
  <div className="flex flex-wrap gap-1">
    {row.docs.map((d) => {
      const chipClass = cn(
        "rounded border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap",
        d.type === "Material Inspection Report" && "border-dashed"
      );
      return onDocClick ? (
        <button
          key={d.name}
          type="button"
          className={cn(chipClass, "hover:bg-muted")}
          title={`Show ${d.referenceNumber} in the DC-wise view`}
          onClick={(e) => {
            e.stopPropagation();
            onDocClick(d.name);
          }}
        >
          {d.referenceNumber}
        </button>
      ) : (
        <span key={d.name} className={chipClass}>
          {d.referenceNumber}
        </span>
      );
    })}
  </div>
);

const ViewLink: React.FC<{ doc: ItemWiseDocRef }> = ({ doc }) =>
  doc.attachmentUrl ? (
    <a
      href={`${SITEURL}${doc.attachmentUrl}`}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
      aria-label={`View ${doc.referenceNumber} file`}
      onClick={(e) => e.stopPropagation()}
    >
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      View
    </a>
  ) : null;

/**
 * Item-wise view of a PO's or ITM's Delivery Challans & MIRs: one row per item with its
 * Ordered (ITM: Transfer Qty), Received (DN), DC Qty, MIR Qty, DC Pending and Status, and
 * the DC/MIR numbers that cover it. Click a row to see each DC/MIR and its quantity.
 *
 * Layouts, the widest that fits the card (`useFittingLayout`): the full table; a compact
 * table without the Unit and DC/MIR-numbers columns, with "2 DCs · 1 MIR" under the item
 * name; or one card per item with a "Status" filter button above the cards.
 */
export const DCMIRItemWiseTable: React.FC<DCMIRItemWiseTableProps> = ({ kind, items, documents, onDocClick }) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set());
  const { rootRef, tableBoxRef, layout } = useFittingLayout();
  const compact = layout === "compact";
  const columnCount = compact ? 8 : 10;

  const { rows, uncountedDocs } = useMemo(
    () =>
      kind === "itm"
        ? buildItmItemWiseRows(items as InternalTransferMemoItem[], documents)
        : buildItemWiseRows(items as PurchaseOrderItem[], documents),
    [kind, items, documents]
  );
  const orderedLabel = kind === "itm" ? "Transfer Qty" : "Ordered";
  const orderedShortLabel = kind === "itm" ? "Transfer" : "Ordered";
  const parentLabel = kind === "itm" ? "ITM" : "PO";

  const statusOptions = useMemo(() => {
    const counts = countByStatus(rows);
    return STATUS_ORDER.filter((s) => counts[s]).map((s) => ({
      label: `${filterLabel(s)} (${counts[s]})`,
      value: s,
    }));
  }, [rows]);

  const shownRows = useMemo(
    () => (statusFilter.size ? rows.filter((r) => statusFilter.has(r.status)) : rows),
    [rows, statusFilter]
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const emptyText = rows.length === 0 ? `No items on this ${parentLabel}` : "No items with this status";

  return (
    <div ref={rootRef}>
      {/* ---------- Cards: Status filter button + one card per item ---------- */}
      {layout === "cards" && (
      <div>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <SimpleFacetedFilter
            title="Status"
            triggerLabel="Status"
            options={statusOptions}
            selectedValues={statusFilter}
            onSelectedValuesChange={setStatusFilter}
          />
          <span className="text-xs text-muted-foreground">
            {shownRows.length} of {rows.length} items
          </span>
        </div>
        {shownRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">{emptyText}</p>
        ) : (
          shownRows.map((row) => {
            const isOpen = expanded.has(row.key);
            const hasDocs = row.billable && row.docs.length > 0;
            return (
              <div key={row.key} className="space-y-2 border-b p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{row.itemName}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.category} · {row.unit}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                <div className="grid grid-cols-4 gap-1 rounded-md bg-muted/50 px-2 py-1.5 text-center">
                  {[
                    [orderedShortLabel, formatQty(row.orderedQty)],
                    ["Received", formatQty(row.receivedQty)],
                    ["DC", row.billable ? formatQty(row.dcQty) : "–"],
                    ["MIR", row.billable ? formatQty(row.mirQty) : "–"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="text-sm font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
                {row.billable && row.receivedQty > 0 && (
                  <p className="text-xs text-muted-foreground">
                    DC Pending: <DCPending row={row} />
                  </p>
                )}
                {hasDocs && <DocChips row={row} onDocClick={onDocClick} />}
                {hasDocs && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600"
                    aria-expanded={isOpen}
                    onClick={() => toggle(row.key)}
                  >
                    {isOpen ? "Hide" : "Show"} DCs &amp; MIRs
                    <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
                  </button>
                )}
                {hasDocs && isOpen && (
                  <div className="space-y-1.5 border-l-2 pl-2.5">
                    {row.docs.map((d) => (
                      <div key={d.name} className="flex flex-wrap items-center gap-2 text-xs">
                        <DocTypeBadge type={d.type} />
                        <span className="font-mono">{d.referenceNumber}</span>
                        <span className="text-muted-foreground">{formatDate(d.date)}</span>
                        <span className="ml-auto font-semibold tabular-nums">
                          {formatQty(d.quantity)} {row.unit}
                        </span>
                        <ViewLink doc={d} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      )}

      {/* ---------- Full or compact table ---------- */}
      {layout !== "cards" && (
      <div ref={tableBoxRef} className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-red-100">
            <TableRow>
              <TableHead className="w-[36px]" />
              <TableHead className="text-black font-bold">Item</TableHead>
              {!compact && <TableHead className="text-black font-bold">Unit</TableHead>}
              <TableHead className="text-right text-black font-bold whitespace-nowrap">{orderedLabel}</TableHead>
              <TableHead className="text-right text-black font-bold whitespace-nowrap">Received (DN)</TableHead>
              <TableHead className="text-right text-black font-bold whitespace-nowrap">DC Qty</TableHead>
              <TableHead className="text-right text-black font-bold whitespace-nowrap">MIR Qty</TableHead>
              <TableHead className="text-right text-black font-bold whitespace-nowrap">DC Pending</TableHead>
              <TableHead className="text-center text-black font-bold">
                <div className="flex items-center justify-center gap-1">
                  <SimpleFacetedFilter
                    title="Status"
                    options={statusOptions}
                    selectedValues={statusFilter}
                    onSelectedValuesChange={setStatusFilter}
                  />
                  <span>Status</span>
                </div>
              </TableHead>
              {!compact && <TableHead className="text-black font-bold">DCs / MIRs</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shownRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-4 text-center text-gray-500">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              shownRows.map((row) => {
                const isOpen = expanded.has(row.key);
                const hasDocs = row.billable && row.docs.length > 0;
                return (
                  <React.Fragment key={row.key}>
                    <TableRow
                      className={cn(hasDocs && "cursor-pointer")}
                      onClick={hasDocs ? () => toggle(row.key) : undefined}
                    >
                      <TableCell className="align-top">
                        {hasDocs && (
                          <button
                            type="button"
                            className="text-muted-foreground"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} DCs and MIRs for ${row.itemName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(row.key);
                            }}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <p className="font-medium">{row.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.category}
                          {compact && (
                            <span>
                              {" · "}
                              {row.unit}
                              {hasDocs && <span className="text-blue-600">{` · ${docSummary(row)}`}</span>}
                            </span>
                          )}
                        </p>
                      </TableCell>
                      {!compact && <TableCell className="align-top">{row.unit}</TableCell>}
                      <TableCell className="text-right align-top tabular-nums">{formatQty(row.orderedQty)}</TableCell>
                      <TableCell className="text-right align-top tabular-nums">{formatQty(row.receivedQty)}</TableCell>
                      <TableCell className="text-right align-top tabular-nums">
                        {row.billable ? formatQty(row.dcQty) : "–"}
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">
                        {row.billable ? formatQty(row.mirQty) : "–"}
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums whitespace-nowrap">
                        <DCPending row={row} />
                      </TableCell>
                      <TableCell className="text-center align-top">
                        <StatusBadge status={row.status} />
                      </TableCell>
                      {!compact && (
                        <TableCell className="align-top">
                          {!row.billable ? (
                            <span className="text-muted-foreground">–</span>
                          ) : hasDocs ? (
                            <DocChips row={row} onDocClick={onDocClick} />
                          ) : (
                            <span className="text-muted-foreground">None yet</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    {hasDocs && isOpen && (
                      <TableRow>
                        <TableCell colSpan={columnCount} className="p-0">
                          <div className="bg-muted/30 p-3 pl-12">
                            <table className="text-xs">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="p-2 text-left font-medium">Type</th>
                                  <th className="p-2 text-left font-medium">Ref No.</th>
                                  <th className="p-2 text-left font-medium">Date</th>
                                  <th className="p-2 text-right font-medium">Qty ({row.unit})</th>
                                  <th className="p-2" />
                                </tr>
                              </thead>
                              <tbody>
                                {row.docs.map((d) => (
                                  <tr key={d.name} className="border-t">
                                    <td className="p-2">
                                      <DocTypeBadge type={d.type} />
                                    </td>
                                    <td className="p-2 font-mono">{d.referenceNumber}</td>
                                    <td className="p-2 whitespace-nowrap">{formatDate(d.date)}</td>
                                    <td className="p-2 text-right font-medium tabular-nums">{formatQty(d.quantity)}</td>
                                    <td className="p-2">
                                      <ViewLink doc={d} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      )}

      {uncountedDocs.length > 0 && (
        <p className="flex items-start gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">
              {uncountedDocs.map((d) => docLabel(d, documents)).join(", ")}
            </span>{" "}
            {uncountedDocs.length === 1
              ? "has no items (old record or saved without items), so it is"
              : "have no items (old records or saved without items), so they are"}{" "}
            not counted above. Update {uncountedDocs.length === 1 ? "it" : "them"} from the DC-wise view.
          </span>
        </p>
      )}
    </div>
  );
};

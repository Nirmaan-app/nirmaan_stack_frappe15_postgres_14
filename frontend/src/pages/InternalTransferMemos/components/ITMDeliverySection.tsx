import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { FileText, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/FormatDate";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";

interface ITMDeliverySectionProps {
  itmName: string;
  itmStatus: string;
  targetProject: string;
  items: InternalTransferMemoItem[];
}

interface DNItem {
  item_id: string;
  item_name?: string;
  unit?: string;
  received_quantity: number;
}

interface DNRecord {
  name: string;
  creation: string;
  owner: string;
  items: DNItem[];
}

/**
 * Delivery Notes section shown inside the ITM detail accordion.
 *
 * Fetches DNs linked to this ITM and renders them in a table.
 * Supports expanding rows to see per-item received quantities.
 */
export const ITMDeliverySection: React.FC<ITMDeliverySectionProps> = ({
  itmName,
  itmStatus,
}) => {
  const navigate = useNavigate();
  const [expandedDN, setExpandedDN] = useState<Set<string>>(new Set());

  const { data: dnData, isLoading: dnLoading } = useFrappeGetCall<{
    message: DNRecord[];
  }>(
    "nirmaan_stack.api.delivery_notes.get_delivery_notes.get_delivery_notes_for_itm",
    { itm_name: itmName },
    itmName ? undefined : null
  );

  const dnList: DNRecord[] = dnData?.message ?? [];

  const canCreateDN =
    itmStatus === "Dispatched" || itmStatus === "Partially Delivered";

  const toggleExpand = (name: string) => {
    setExpandedDN((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (dnLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <TailSpin visible height="28" width="28" color="#D03B45" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {dnList.length > 0
            ? `${dnList.length} delivery note${dnList.length !== 1 ? "s" : ""} recorded.`
            : "No delivery notes have been created yet."}
        </p>
        {canCreateDN && (
          <Button
            size="sm"
            onClick={() =>
              navigate(
                `/prs&milestones/delivery-notes/itm/${itmName}?mode=create`
              )
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create Delivery Note
          </Button>
        )}
      </div>

      {/* DN list table */}
      {dnList.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-12" />
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold">
                  Note No
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold">
                  Date
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold text-center">
                  Items
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold">
                  Created By
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dnList.map((dn) => {
                const isExpanded = expandedDN.has(dn.name);
                return (
                  <React.Fragment key={dn.name}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/20"
                      onClick={() => toggleExpand(dn.name)}
                    >
                      <TableCell className="text-muted-foreground text-xs">
                        {isExpanded ? "▾" : "▸"}
                      </TableCell>
                      <TableCell className="font-medium font-mono text-sm">
                        {dn.name}
                      </TableCell>
                      <TableCell className="text-sm">
                        {dn.creation ? formatDate(dn.creation) : "--"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {dn.items?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {dn.owner ?? "--"}
                      </TableCell>
                    </TableRow>

                    {/* Expanded sub-table: items with received qty */}
                    {isExpanded && dn.items && dn.items.length > 0 && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={4} className="p-0 pb-3">
                          <div className="ml-2 rounded-md border bg-muted/10">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-[10px] uppercase font-medium">
                                    Item
                                  </TableHead>
                                  <TableHead className="text-[10px] uppercase font-medium w-20">
                                    Unit
                                  </TableHead>
                                  <TableHead className="text-[10px] uppercase font-medium w-32 text-right">
                                    Received Qty
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {dn.items.map((item, i) => (
                                  <TableRow key={`${dn.name}-${item.item_id}-${i}`}>
                                    <TableCell className="text-xs">
                                      {item.item_name ?? item.item_id}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {item.unit ?? "--"}
                                    </TableCell>
                                    <TableCell className="text-xs text-right tabular-nums font-medium">
                                      {item.received_quantity}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Empty state */}
      {dnList.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            No delivery notes yet.
            {canCreateDN && " Create one to start recording received items."}
          </p>
        </div>
      )}
    </div>
  );
};

export default ITMDeliverySection;

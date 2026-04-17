import React, { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";

import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { decodeFrappeId } from "./constants";
import type { ITMDetailPayload } from "@/pages/InternalTransferMemos/hooks/useITM";
import type { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";

// --- Types ---

interface ItemRow {
  item_id: string;
  item_name: string;
  unit: string;
  category?: string;
  transfer_quantity: number;
  total_received: number;
  new_qty: number;
}

// --- Component ---

const ITMDeliveryNote: React.FC = () => {
  const { itmId: encodedId } = useParams<{ itmId: string }>();
  const itmId = decodeFrappeId(encodedId ?? "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewMode = searchParams.get("mode") === "create" ? "create" : "view";

  const [deliveryDate, setDeliveryDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  // --- Data fetching ---
  const { data: itmData, isLoading: itmLoading, error: itmError } =
    useFrappeGetCall<{ message: ITMDetailPayload }>(
      "nirmaan_stack.api.internal_transfers.get_itm.get_itm",
      itmId ? { name: itmId } : undefined,
      itmId ? undefined : null
    );

  const { data: dnsData, isLoading: dnsLoading, mutate: refetchDNs } =
    useFrappeGetCall<{ message: DeliveryNote[] }>(
      "nirmaan_stack.api.delivery_notes.get_delivery_notes.get_delivery_notes_for_itm",
      itmId ? { itm_name: itmId } : undefined,
      itmId ? undefined : null
    );

  const { call: createDN } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.create_itm_delivery_note.create_itm_delivery_note"
  );

  const payload = itmData?.message;
  const itm = payload?.itm;
  const dns = useMemo(() => dnsData?.message || [], [dnsData]);

  // --- Derive item rows with received totals ---
  const itemRows: ItemRow[] = useMemo(() => {
    if (!itm?.items) return [];

    // Aggregate received quantities from existing DNs
    const receivedByItem: Record<string, number> = {};
    for (const dn of dns) {
      if (dn.is_return === 1) continue;
      for (const item of dn.items || []) {
        receivedByItem[item.item_id] =
          (receivedByItem[item.item_id] || 0) + (item.delivered_quantity || 0);
      }
    }

    return itm.items
      .filter((item) => item.status === "Approved")
      .map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name || item.item_id,
        unit: item.unit || "",
        category: item.category,
        transfer_quantity: item.transfer_quantity,
        total_received: receivedByItem[item.item_id] || 0,
        new_qty: quantities[item.item_id] || 0,
      }));
  }, [itm, dns, quantities]);

  const hasValidInput = useMemo(
    () => itemRows.some((r) => r.new_qty > 0) && !!deliveryDate,
    [itemRows, deliveryDate]
  );

  // --- Handlers ---

  const handleQtyChange = (itemId: string, value: string) => {
    const num = parseFloat(value);
    setQuantities((prev) => ({
      ...prev,
      [itemId]: isNaN(num) || num < 0 ? 0 : num,
    }));
  };

  const handleSubmit = async () => {
    if (!hasValidInput || submitting) return;
    setSubmitting(true);

    const items = itemRows
      .filter((r) => r.new_qty > 0)
      .map((r) => ({
        item_id: r.item_id,
        delivered_quantity: r.new_qty,
      }));

    try {
      await createDN({
        itm_id: itmId,
        items: JSON.stringify(items),
        delivery_date: deliveryDate,
      });
      toast({
        title: "Delivery Note created",
        description: `Delivery Note created for ${itm?.name}`,
        variant: "success",
      });
      setQuantities({});
      refetchDNs();
    } catch (e: any) {
      toast({
        title: "Failed to create Delivery Note",
        description: e?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render guards ---

  if (itmLoading || dnsLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <TailSpin height={50} width={50} color="red" />
        <span className="ml-2 text-gray-600">Loading...</span>
      </div>
    );
  }

  if (itmError || !itm) {
    return (
      <div className="p-6 space-y-4">
        <div className="text-center text-red-600 py-4">
          {(itmError as any)?.message || "Transfer Memo not found."}
        </div>
        <Button
          variant="outline"
          onClick={() => navigate("/prs&milestones/delivery-notes?view=create")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to DN Hub
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-4 max-w-5xl space-y-4">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            navigate("/prs&milestones/delivery-notes?view=create")
          }
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <h1 className="text-xl font-bold text-foreground">
          {viewMode === "create"
            ? `New Delivery Note - ${itm.name}`
            : `Delivery History - ${itm.name}`}
        </h1>
      </div>

      {/* ITM metadata card */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Source Project</span>
              <p className="font-medium">
                {payload?.source_project_name || itm.source_project}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Target Project</span>
              <p className="font-medium">
                {payload?.target_project_name || itm.target_project}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <div className="mt-0.5">
                <Badge
                  variant={
                    itm.status === "Delivered"
                      ? "green"
                      : itm.status === "Dispatched"
                      ? "orange"
                      : "secondary"
                  }
                >
                  {itm.status}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Est. Value</span>
              <p className="font-medium">
                {formatToRoundedIndianRupee(itm.estimated_value ?? 0)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create mode: item input table */}
      {viewMode === "create" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Record Delivery</CardTitle>
            <div className="flex items-center gap-3 pt-2">
              <label className="text-sm text-muted-foreground">
                Delivery Date
              </label>
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-44"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-center">Unit</TableHead>
                    <TableHead className="text-center">Transfer Qty</TableHead>
                    <TableHead className="text-center">Received</TableHead>
                    <TableHead className="text-center">Remaining</TableHead>
                    <TableHead className="text-center w-[120px]">
                      New Qty
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemRows.map((row) => {
                    const remaining = row.transfer_quantity - row.total_received;
                    return (
                      <TableRow key={row.item_id}>
                        <TableCell className="max-w-[250px]">
                          <span className="font-medium">{row.item_name}</span>
                          {row.category && (
                            <span className="block text-xs text-muted-foreground">
                              {row.category}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{row.unit}</TableCell>
                        <TableCell className="text-center">
                          {row.transfer_quantity}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.total_received}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={
                              remaining <= 0
                                ? "text-green-600"
                                : "text-orange-600"
                            }
                          >
                            {remaining}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={0}
                            max={remaining > 0 ? remaining : 0}
                            step="any"
                            value={row.new_qty || ""}
                            onChange={(e) =>
                              handleQtyChange(row.item_id, e.target.value)
                            }
                            className="w-[100px] mx-auto text-center"
                            disabled={remaining <= 0}
                            placeholder="0"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end mt-4">
              <Button
                onClick={handleSubmit}
                disabled={!hasValidInput || submitting}
                className="bg-red-600 hover:bg-red-700"
              >
                {submitting ? "Submitting..." : "Submit Delivery Note"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing DNs section */}
      {dns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              Existing Delivery Notes ({dns.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dns.map((dn) => (
                <DNCard key={dn.name} dn={dn} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {dns.length === 0 && viewMode !== "create" && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No delivery notes recorded yet for this Transfer Memo.
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// --- DN Card sub-component ---

function DNCard({ dn }: { dn: DeliveryNote }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium text-primary">{dn.name}</span>
          <span className="text-muted-foreground">
            {formatDate(dn.delivery_date)}
          </span>
          <Badge variant="secondary">{dn.items?.length || 0} items</Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {dn.updated_by_user || ""}
        </span>
      </button>
      {expanded && dn.items && dn.items.length > 0 && (
        <div className="border-t px-4 pb-3">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs">Item</TableHead>
                <TableHead className="text-xs text-center">Unit</TableHead>
                <TableHead className="text-xs text-center">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dn.items.map((item, idx) => (
                <TableRow key={item.name || idx}>
                  <TableCell className="text-sm">{item.item_name}</TableCell>
                  <TableCell className="text-sm text-center">
                    {item.unit}
                  </TableCell>
                  <TableCell className="text-sm text-center">
                    {item.delivered_quantity}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default ITMDeliveryNote;

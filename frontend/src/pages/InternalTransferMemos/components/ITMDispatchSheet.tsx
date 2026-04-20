import { useCallback, useState } from "react";
import { CalendarClock, Phone } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/use-toast";
import { useFrappePostCall } from "frappe-react-sdk";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";
import { ITMDispatchItemSelector } from "./ITMDispatchItemSelector";

interface ITMDispatchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itmName: string;
  itmItems: InternalTransferMemoItem[];
  onSuccess: () => void;
}

/**
 * Side-panel Sheet for dispatching an approved ITM.
 * Replicates the PO "Mark Dispatched Items" pattern with:
 * - Item selector (approved items only)
 * - Expected Delivery Date (required)
 * - Delivery Contact (optional)
 */
export function ITMDispatchSheet({
  open,
  onOpenChange,
  itmName,
  itmItems,
  onSuccess,
}: ITMDispatchSheetProps) {
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [contactPerson, setContactPerson] = useState({ name: "", number: "" });

  const hasItems = itmItems.length > 0;

  const { call: dispatchCall, loading: isDispatching } = useFrappePostCall(
    "nirmaan_stack.api.internal_transfers.lifecycle.dispatch_itm"
  );

  const today = new Date().toISOString().split("T")[0];

  const canConfirm = hasItems && expectedDeliveryDate && !isDispatching;

  const resetState = useCallback(() => {
    setExpectedDeliveryDate("");
    setContactPerson({ name: "", number: "" });
  }, []);

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v) resetState();
      onOpenChange(v);
    },
    [onOpenChange, resetState]
  );

  const handleConfirmDispatch = useCallback(async () => {
    if (!canConfirm) return;
    try {
      await dispatchCall({ name: itmName });
      toast({
        title: "Transfer dispatched",
        description: `${itmName} has been marked as dispatched.`,
        variant: "success",
      });
      resetState();
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast({
        title: "Dispatch failed",
        description: e?.message ?? "Something went wrong.",
        variant: "destructive",
      });
    }
  }, [canConfirm, dispatchCall, itmName, resetState, onOpenChange, onSuccess]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-[480px] flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b bg-white">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold">
              Mark Dispatched Items
            </SheetTitle>
            <Badge variant="outline" className="text-xs font-mono">
              {itmName}
            </Badge>
          </div>
        </SheetHeader>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 bg-slate-50">
          {/* 1. Item List (read-only) */}
          <ITMDispatchItemSelector items={itmItems} />

          {/* 2. Expected Delivery Date */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                  <CalendarClock className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm font-semibold text-slate-700">
                  Expected Delivery Date
                </span>
              </div>
              <span className="text-xs text-red-500 font-medium">Required</span>
            </div>
            <Input
              type="date"
              min={today}
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              disabled={isDispatching}
              className="w-full"
            />
          </div>

          {/* 3. Delivery Contact */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                  <Phone className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm font-semibold text-slate-700">
                  Delivery Contact
                </span>
              </div>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>

            <div className="space-y-2">
              <div>
                <Label className="text-xs text-slate-600">Person Name</Label>
                <Input
                  placeholder="Enter person name"
                  value={contactPerson.name}
                  onChange={(e) =>
                    setContactPerson((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  disabled={isDispatching}
                />
              </div>
              <div>
                <Label className="text-xs text-slate-600">Contact Number</Label>
                <Input
                  placeholder="10-digit number"
                  value={contactPerson.number}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setContactPerson((prev) => ({ ...prev, number: val }));
                  }}
                  disabled={isDispatching}
                />
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Footer */}
        <div className="px-5 py-4 space-y-3 bg-white">
          {!expectedDeliveryDate && (
            <p className="text-xs text-amber-600 font-medium">
              Please select an expected delivery date to proceed.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isDispatching}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmDispatch}
              disabled={!canConfirm}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDispatching ? "Dispatching..." : "Confirm Dispatch"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useCallback, useMemo, useState } from "react";
import ReactSelect, { SingleValue } from "react-select";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  FuzzySearchSelect,
  type FuzzyOptionType,
} from "@/components/ui/fuzzy-search-select";
import {
  ITEM_TOKEN_SEARCH_CONFIG,
  useItemCatalog,
  type ItemCatalogOption,
} from "@/hooks/useItemCatalog";
import { cn } from "@/lib/utils";
import formatToIndianRupee from "@/utils/FormatPrice";

// Intersection, not `extends` — FuzzyOptionType's `value: any` + index
// signature and ItemCatalogOption's `value: string` cannot be merged by an
// interface declaration.
type ItemOption = ItemCatalogOption & FuzzyOptionType;

interface MakeOption {
  label: string;
  value: string;
}

interface EstimatedRateResponse {
  message: {
    item_id: string;
    make: string | null;
    po_rate: number;
    po_name: string | null;
    warehouse_rate: number;
    suggested_rate: number;
    source: "po" | "warehouse" | "none";
  };
}

// A modal Radix dialog sets `pointer-events: none` outside itself, so a
// portalled react-select menu is keyboard-only without this. Same fix as
// LineItemMappingReview.
const PORTAL_STYLES = {
  menuPortal: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 9999,
    pointerEvents: "auto" as const,
  }),
};

interface AddWarehouseStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful add so the caller can refresh its table. */
  onSuccess?: () => void;
}

export function AddWarehouseStockDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddWarehouseStockDialogProps) {
  const { toast } = useToast();

  const [item, setItem] = useState<SingleValue<ItemOption>>(null);
  const [make, setMake] = useState<SingleValue<MakeOption>>(null);
  const [quantity, setQuantity] = useState<string>("");

  const { itemOptions, isLoading: catalogLoading } = useItemCatalog();

  const { call: addStock, loading: submitting } = useFrappePostCall(
    "nirmaan_stack.api.warehouse.add_warehouse_stock.add_warehouse_stock"
  );

  // Makes come from the chosen item's category (Category Makelist), already
  // batched by useItemCatalog — no second fetch.
  const makeOptions = useMemo<MakeOption[]>(
    () =>
      (item?.available_makes ?? [])
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .map((m) => ({ label: m, value: m })),
    [item]
  );

  // Rate lookup needs BOTH item and make — the whole point is that the
  // suggestion is make-scoped.
  const rateArgs = item && make ? { item_id: item.value, make: make.value } : null;
  const { data: rateData, isLoading: rateLoading } =
    useFrappeGetCall<EstimatedRateResponse>(
      "nirmaan_stack.api.warehouse.get_item_estimated_rate.get_item_estimated_rate",
      rateArgs ?? {},
      rateArgs ? `warehouse_rate_${rateArgs.item_id}_${rateArgs.make}` : null
    );

  const rateInfo = rateData?.message;

  const resetForm = useCallback(() => {
    setItem(null);
    setMake(null);
    setQuantity("");
  }, []);

  const handleItemChange = useCallback((opt: SingleValue<ItemOption>) => {
    setItem(opt);
    setMake(null);
  }, []);

  const handleMakeChange = useCallback((opt: SingleValue<MakeOption>) => {
    setMake(opt);
  }, []);

  const qtyNumber = parseFloat(quantity);
  const qtyInvalid = quantity !== "" && !(qtyNumber > 0);
  const canSubmit =
    !!item && !!make && qtyNumber > 0 && !submitting && !rateLoading;

  const handleSubmit = async () => {
    if (!item || !make) return;
    try {
      const result = await addStock({
        item_id: item.value,
        make: make.value,
        quantity: qtyNumber,
      });
      const msg = (result as any)?.message;
      toast({
        title: "Stock added",
        description: `${item.label} (${make.value}) — new warehouse quantity ${msg?.new_quantity ?? ""}.`,
        variant: "success",
      });
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "Failed to add warehouse stock.",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const rateCaption = (() => {
    if (!item || !make)
      return "Rate is derived from PO history — select an item and make.";
    if (rateLoading) return "Looking up rate...";
    if (!rateInfo) return null;
    if (rateInfo.source === "po") {
      return `Highest live PO rate for this item + make${rateInfo.po_name ? ` (${rateInfo.po_name})` : ""}.`;
    }
    if (rateInfo.source === "warehouse") {
      return `No higher PO rate found — using the current warehouse rate (${formatToIndianRupee(rateInfo.warehouse_rate)}).`;
    }
    return "No PO history for this item + make — it will be added with no rate.";
  })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-primary">Add Item to Warehouse</DialogTitle>
          <DialogDescription>
            Manual stock entry. This does not create a Transfer Memo — it adds
            straight to warehouse stock and is logged in the ledger as a manual
            entry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="warehouse-item-select" className="text-sm font-medium">
              Item <sup className="text-primary">*</sup>
            </Label>
            <FuzzySearchSelect<ItemOption>
              inputId="warehouse-item-select"
              placeholder="Search and select an item..."
              value={item}
              allOptions={itemOptions as ItemOption[]}
              tokenSearchConfig={ITEM_TOKEN_SEARCH_CONFIG}
              onChange={handleItemChange as any}
              isLoading={catalogLoading}
              isClearable
              menuPortalTarget={document.body}
              styles={PORTAL_STYLES as any}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="warehouse-make-select" className="text-sm font-medium">
                Make <sup className="text-primary">*</sup>
              </Label>
              <ReactSelect<MakeOption>
                inputId="warehouse-make-select"
                placeholder={item ? "Select make..." : "Select an item first"}
                value={make}
                options={makeOptions}
                onChange={handleMakeChange}
                isDisabled={!item}
                isClearable
                menuPortalTarget={document.body}
                styles={PORTAL_STYLES as any}
              />
            </div>
            <div className="w-28">
              <Label className="text-sm font-medium">Unit</Label>
              <Input
                disabled
                value={item?.unit || "--"}
                className="bg-gray-100 cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Category</Label>
            <Input
              disabled
              value={item?.category || "--"}
              className="bg-gray-100 cursor-not-allowed"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="warehouse-qty" className="text-sm font-medium">
                Quantity <sup className="text-primary">*</sup>
              </Label>
              <Input
                id="warehouse-qty"
                type="number"
                min={0}
                step="any"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={cn(
                  qtyInvalid && "border-destructive focus-visible:ring-destructive"
                )}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="warehouse-rate" className="text-sm font-medium">
                Estimated Rate
              </Label>
              <Input
                id="warehouse-rate"
                disabled
                value={
                  rateLoading
                    ? "..."
                    : rateInfo && rateInfo.suggested_rate > 0
                      ? formatToIndianRupee(rateInfo.suggested_rate)
                      : "--"
                }
                className="bg-gray-100 cursor-not-allowed"
              />
            </div>
          </div>

          {qtyInvalid && (
            <p className="text-xs text-destructive">
              Quantity must be greater than 0.
            </p>
          )}
          {rateCaption && (
            <p className="text-xs text-muted-foreground">{rateCaption}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <TailSpin color="#fff" height={16} width={16} />
            ) : (
              "Add to Warehouse"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

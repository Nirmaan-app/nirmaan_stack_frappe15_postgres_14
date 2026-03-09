import { useCallback, useMemo, useState } from "react";
import { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PackageCheck, Info } from "lucide-react";

interface DispatchItemSelectorProps {
  items: PurchaseOrderItem[];
  onSelectionChange: (selectedItemNames: string[]) => void;
  disabled?: boolean;
}

export function DispatchItemSelector({ items, onSelectionChange, disabled }: DispatchItemSelectorProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const alreadyDispatched = useMemo(
    () => items.filter((item) => item.is_dispatched === 1),
    [items]
  );

  const dispatchableItems = useMemo(
    () => items.filter((item) => item.is_dispatched !== 1 && item.category !== "Additional Charges"),
    [items]
  );

  const hasAdditionalCharges = useMemo(
    () => items.some((item) => item.category === "Additional Charges"),
    [items]
  );

  const handleToggle = useCallback(
    (itemName: string, checked: boolean) => {
      setCheckedItems((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(itemName);
        } else {
          next.delete(itemName);
        }
        onSelectionChange(Array.from(next));
        return next;
      });
    },
    [onSelectionChange]
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        const allNames = new Set(dispatchableItems.map((item) => item.name));
        setCheckedItems(allNames);
        onSelectionChange(Array.from(allNames));
      } else {
        setCheckedItems(new Set());
        onSelectionChange([]);
      }
    },
    [dispatchableItems, onSelectionChange]
  );

  const allSelected = dispatchableItems.length > 0 && checkedItems.size === dispatchableItems.length;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
            <PackageCheck className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-semibold text-slate-700">Select Items to Dispatch</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {alreadyDispatched.length}/{items.filter(i => i.category !== "Additional Charges").length} dispatched
        </Badge>
      </div>

      {/* Select All */}
      {dispatchableItems.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-2 bg-slate-50">
          <Checkbox
            id="select-all-dispatch"
            checked={allSelected}
            onCheckedChange={handleSelectAll}
            disabled={disabled}
          />
          <label htmlFor="select-all-dispatch" className="text-xs font-medium text-slate-600 cursor-pointer">
            Select all undispatched items
          </label>
        </div>
      )}

      {/* Item List */}
      <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
        {/* Already dispatched items */}
        {alreadyDispatched.map((item) => (
          <div key={item.name} className="px-4 py-2.5 flex items-center gap-3 bg-slate-50/50">
            <Checkbox checked disabled className="opacity-50" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-400 truncate">{item.item_name}</p>
              <p className="text-xs text-slate-400">{item.quantity} {item.unit}</p>
            </div>
            <Badge variant="green" className="text-[10px] shrink-0">Done</Badge>
          </div>
        ))}

        {/* Dispatchable items */}
        {dispatchableItems.map((item) => (
          <div key={item.name} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors">
            <Checkbox
              id={`dispatch-${item.name}`}
              checked={checkedItems.has(item.name)}
              onCheckedChange={(checked) => handleToggle(item.name, !!checked)}
              disabled={disabled}
            />
            <label htmlFor={`dispatch-${item.name}`} className="flex-1 min-w-0 cursor-pointer">
              <p className="text-sm text-slate-800 truncate">{item.item_name}</p>
              <p className="text-xs text-slate-500">{item.quantity} {item.unit}</p>
            </label>
          </div>
        ))}
      </div>

      {/* Additional Charges Note */}
      {hasAdditionalCharges && (
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-1.5 bg-blue-50">
          <Info className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="text-[11px] text-blue-600">Additional Charges are auto-dispatched</span>
        </div>
      )}

      {/* No items message */}
      {dispatchableItems.length === 0 && alreadyDispatched.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 text-center">
          <p className="text-sm text-green-600 font-medium">All items have been dispatched</p>
        </div>
      )}
    </div>
  );
}

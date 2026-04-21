import { Badge } from "@/components/ui/badge";
import { PackageCheck } from "lucide-react";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";

interface ITMDispatchItemSelectorProps {
  items: InternalTransferMemoItem[];
}

/**
 * Read-only list of items being dispatched.
 * All ITM items are approved by definition — no selection needed.
 */
export function ITMDispatchItemSelector({ items }: ITMDispatchItemSelectorProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
            <PackageCheck className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-semibold text-slate-700">
            Items to Dispatch
          </span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {items.length}/{items.length} Dispatched
        </Badge>
      </div>

      <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
        {items.map((item) => (
          <div key={item.item_id} className="px-4 py-2.5">
            <p className="text-sm text-slate-800 truncate">
              {item.item_name ?? item.item_id}
            </p>
            <p className="text-xs text-slate-500">
              {item.transfer_quantity} {item.unit}
            </p>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <div className="px-4 py-3 border-t border-slate-100 text-center">
          <p className="text-sm text-muted-foreground">No items to dispatch</p>
        </div>
      )}
    </div>
  );
}

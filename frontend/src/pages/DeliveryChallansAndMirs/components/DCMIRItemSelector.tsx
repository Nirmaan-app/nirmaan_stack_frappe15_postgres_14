import { UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UploadDCMIRFormValues } from "../schema";

interface DCMIRItemSelectorProps {
  form: UseFormReturn<UploadDCMIRFormValues>;
  showQuantity?: boolean;
}

export const DCMIRItemSelector = ({ form, showQuantity = true }: DCMIRItemSelectorProps) => {
  const items = form.watch("items");

  const allSelected = items.length > 0 && items.every((item) => item.selected);
  const someSelected = items.some((item) => item.selected) && !allSelected;

  const handleSelectAll = (checked: boolean) => {
    items.forEach((_, index) => {
      form.setValue(`items.${index}.selected`, checked);
    });
  };

  const handleToggleItem = (index: number, checked: boolean) => {
    form.setValue(`items.${index}.selected`, checked);
    if (!checked && showQuantity) {
      form.setValue(`items.${index}.quantity`, 0);
    }
  };

  return (
    <div className="border rounded-md overflow-x-auto max-h-[300px] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead className="w-[50px]">
              <Checkbox
                checked={allSelected}
                ref={someSelected ? (el) => { if (el) (el as any).indeterminate = true; } : undefined}
                onCheckedChange={(checked) => handleSelectAll(!!checked)}
                aria-label="Select all items"
              />
            </TableHead>
            <TableHead>Item Name</TableHead>
            <TableHead className="w-[80px]">Unit</TableHead>
            <TableHead className="w-[120px]">Category</TableHead>
            {showQuantity && <TableHead className="w-[120px]">Quantity</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showQuantity ? 5 : 4} className="text-center text-muted-foreground py-4">
                No items available
              </TableCell>
            </TableRow>
          ) : (
            items.map((item, index) => (
              <TableRow key={item.item_id}>
                <TableCell>
                  <Checkbox
                    checked={item.selected}
                    onCheckedChange={(checked) =>
                      handleToggleItem(index, !!checked)
                    }
                    aria-label={`Select ${item.item_name}`}
                  />
                </TableCell>
                <TableCell className="text-sm">{item.item_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {item.unit}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {item.category || "-"}
                </TableCell>
                {showQuantity && (
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    disabled={!item.selected}
                    value={item.selected ? item.quantity || "" : ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const num = raw === "" ? 0 : Number(raw);
                      form.setValue(
                        `items.${index}.quantity`,
                        isNaN(num) || num < 0 ? 0 : num
                      );
                    }}
                    onBlur={() => {
                      const current = form.getValues(`items.${index}.quantity`);
                      form.setValue(`items.${index}.quantity`, Math.max(0, Number(current) || 0));
                    }}
                    className="h-8 w-full"
                    aria-label={`Quantity for ${item.item_name}`}
                  />
                </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

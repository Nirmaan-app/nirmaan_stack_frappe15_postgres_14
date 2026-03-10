import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ReactSelect from "react-select";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { useToast } from "@/components/ui/use-toast";

interface ChargeOption {
  label: string;
  value: string;
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  tax: number;
}

interface AmendAddChargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: PurchaseOrderItem) => void;
  itemOptions: ChargeOption[];
  orderData: PurchaseOrderItem[];
}

export const AmendAddChargeDialog: React.FC<AmendAddChargeDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
  itemOptions,
  orderData,
}) => {
  const { toast } = useToast();
  const [item_name, setItemName] = useState("");
  const [item_id, setItemId] = useState("");
  const [unit, setUnit] = useState("Nos");
  const [quote, setQuote] = useState<number | "">("");
  const [tax, setTax] = useState<number | "">(0);
  const [category, setCategory] = useState("");

  const resetForm = () => {
    setItemName("");
    setItemId("");
    setUnit("Nos");
    setQuote("");
    setTax(0);
    setCategory("");
  };

  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      resetForm();
    }
    onOpenChange(isOpen);
  };

  const handleSubmit = () => {
    if (!item_name.trim()) {
      toast({ title: "Validation Error", description: "Charge Name is required.", variant: "destructive" });
      return;
    }

    if (orderData.some(i =>
      (i.item_name?.toLowerCase() === item_name.trim().toLowerCase()) ||
      (i.item_id && i.item_id === item_id)
    )) {
      toast({ title: "Validation Error", description: "This charge is already in the PO.", variant: "destructive" });
      return;
    }

    if (!quote || quote <= 0) {
      toast({ title: "Validation Error", description: "Rate must be greater than 0.", variant: "destructive" });
      return;
    }
    if (tax === "") {
      toast({ title: "Validation Error", description: "Tax is required.", variant: "destructive" });
      return;
    }

    const newItem: PurchaseOrderItem = {
      name: `NEW-CHARGE-${Date.now()}`,
      item_name,
      item_id: item_id || undefined,
      make: "",
      unit,
      quantity: 1,
      quote: Number(quote),
      tax: Number(tax),
      category,
    } as PurchaseOrderItem;

    onAdd(newItem);
    resetForm();
    handleOpenChange(false);
  };

  // Filter to only show "Additional Charges" category items not already in orderData
  const availableOptions = itemOptions.filter(opt =>
    !orderData.some(i => i.item_id === opt.item_id || i.item_name === opt.item_name)
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Charge</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs">Charge Name <span className="text-red-500">*</span></Label>
            <ReactSelect
              options={availableOptions}
              value={item_id ? itemOptions.find(opt => opt.item_id === item_id) : null}
              onChange={(selected: any) => {
                if (selected) {
                  setItemId(selected.item_id);
                  setItemName(selected.item_name);
                  setUnit(selected.unit || "Nos");
                  setTax(selected.tax || 0);
                  setCategory(selected.category || "");
                } else {
                  setItemId("");
                  setItemName("");
                  setUnit("Nos");
                  setTax(0);
                  setCategory("");
                }
              }}
              placeholder="Select Charge..."
              isClearable
              styles={{
                control: (base) => ({ ...base, minHeight: '36px', height: '36px', fontSize: '12px' }),
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Unit <span className="text-red-500">*</span></Label>
              <SelectUnit value={unit} onChange={setUnit} className="h-9 text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Quantity <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min={1}
                max={1}
                value={1}
                disabled={true}
                className="text-xs h-9 bg-gray-50 font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Rate <span className="text-red-500">*</span></Label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-[10px]">₹</span>
                <Input
                  type="number"
                  min={0}
                  value={quote}
                  onChange={(e) => setQuote(e.target.value ? parseFloat(e.target.value) : "")}
                  className="text-xs pl-5 h-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Tax <span className="text-red-500">*</span></Label>
              <Select value={String(tax)} onValueChange={(v) => setTax(parseFloat(v))}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Select Tax" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0" className="text-xs">0%</SelectItem>
                  <SelectItem value="5" className="text-xs">5%</SelectItem>
                  <SelectItem value="12" className="text-xs">12%</SelectItem>
                  <SelectItem value="18" className="text-xs">18%</SelectItem>
                  <SelectItem value="28" className="text-xs">28%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} size="sm" className="bg-red-600 hover:bg-red-700 text-white">Add Charge</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

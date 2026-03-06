import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ReactSelect from "react-select";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RevisionItem } from "../../types";
import { useToast } from "@/components/ui/use-toast";
import { useProcurementPackages, useCategories } from "../../data/usePORevisionQueries";

interface AddNewItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: RevisionItem) => void;
  isCustom: boolean;
  itemOptions: any[];
  revisionItems: RevisionItem[];
}

export const AddNewItemDialog: React.FC<AddNewItemDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
  isCustom,
  itemOptions,
  revisionItems,
}) => {
  const { toast } = useToast();
  const [item_name, setItemName] = useState("");
  const [item_id, setItemId] = useState("");
  const [make, setMake] = useState("");
  const [unit, setUnit] = useState("NOS");
  const [quantity, setQuantity] = useState<number | "">("");
  const [quote, setQuote] = useState<number | "">("");
  const [tax, setTax] = useState<number | "">("");
  const [procurement_package, setProcurementPackage] = useState("");
  const [category, setCategory] = useState("");

  const { data: procurement_packages } = useProcurementPackages();
  const { data: category_data } = useCategories();

  const resetForm = () => {
    setItemName("");
    setItemId("");
    setMake("");
    setUnit("Nos");
    setQuantity("");
    setQuote("");
    setTax("");
    setProcurementPackage("");
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
      toast({ title: "Validation Error", description: "Item Name is required.", variant: "destructive" });
      return;
    }

    if (isCustom && (!procurement_package || !category)) {
      toast({ title: "Validation Error", description: "Procurement Package and Category are required for custom items.", variant: "destructive" });
      return;
    }

    if (revisionItems.some(ri => 
      (((ri.item_name || "").toLowerCase() === item_name.trim().toLowerCase()) || (ri.item_id && ri.item_id === item_id)) 
      && ri.item_type !== "Deleted"
    )) {
      toast({ title: "Validation Error", description: "This item is already in the PO.", variant: "destructive" });
      return;
    }

    if (!quantity || quantity <= 0) {
      toast({ title: "Validation Error", description: "Quantity must be greater than 0.", variant: "destructive" });
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

    const newItem: RevisionItem = {
      item_name,
      item_id: item_id || undefined,
      make: isCustom ? "" : make,
      unit,
      quantity: Number(quantity),
      quote: Number(quote),
      tax: Number(tax),
      item_type: "New",
      category: category || undefined,
      procurement_package: procurement_package || undefined,
    };

    onAdd(newItem);
    resetForm();
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Item</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs">Item Name <span className="text-red-500">*</span></Label>
            {isCustom ? (
              <Input
                value={item_name}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Enter item name..."
                className="text-xs h-9"
              />
            ) : (
              <ReactSelect
                options={itemOptions.filter(opt => !revisionItems.some(ri => (ri.item_id === opt.item_id || ri.item_name === opt.item_name) && ri.item_type !== 'Deleted'))}
                value={item_id ? itemOptions.find(opt => opt.item_id === item_id) : null}
                onChange={(selected: any) => {
                  if (selected) {
                    setItemId(selected.item_id);
                    setItemName(selected.item_name);
                    setMake(selected.make || "");
                    setUnit(selected.unit || "Nos");
                    setTax(selected.tax || 0);
                    setCategory(selected.category || "");
                    setProcurementPackage(selected.procurement_package || "");
                  } else {
                    setItemId("");
                    setItemName("");
                    setMake("");
                    setUnit("Nos");
                    setTax(0);
                    setCategory("");
                    setProcurementPackage("");
                  }
                }}
                placeholder="Select Item..."
                isClearable
                styles={{
                  control: (base) => ({ ...base, minHeight: '36px', height: '36px', fontSize: '12px' }),
                }}
              />
            )}
          </div>
          
          {isCustom && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Procurement Package <span className="text-red-500">*</span></Label>
                <Select value={procurement_package} onValueChange={(v) => {
                  setProcurementPackage(v);
                  setCategory(""); // Reset category when package changes
                }}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Select Package" />
                  </SelectTrigger>
                  <SelectContent>
                    {procurement_packages?.map((pp: any) => (
                      <SelectItem key={pp?.name} value={pp?.name} className="text-xs">{pp?.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Category <span className="text-red-500">*</span></Label>
                <Select value={category} onValueChange={setCategory} disabled={!procurement_package}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {category_data?.filter((i: any) => i?.work_package === procurement_package)?.map((cat: any) => (
                      <SelectItem key={cat?.name} value={cat?.name} className="text-xs">{cat?.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {!isCustom && (
            <div className="space-y-2">
              <Label className="text-xs">Make</Label>
              <ReactSelect
                options={(() => {
                  const optionItem = itemOptions.find(opt => opt.item_id === item_id);
                  const makes = optionItem?.available_makes || (make ? [make] : []);
                  return makes.map((m: string) => ({ label: m, value: m }));
                })()}
                value={make ? { label: make, value: make } : null}
                onChange={(selected: any) => setMake(selected?.value || "")}
                isDisabled={!item_id}
                placeholder="Select Make..."
                isClearable
                styles={{
                  control: (base) => ({ ...base, minHeight: '36px', height: '36px', fontSize: '12px' }),
                }}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Unit <span className="text-red-500">*</span></Label>
              <SelectUnit value={unit} onChange={setUnit} className="h-9 text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Quantity <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value ? parseFloat(e.target.value) : "")}
                className="text-xs h-9"
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
          <Button onClick={handleSubmit} size="sm" className="bg-red-600 hover:bg-red-700 text-white">Add Item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

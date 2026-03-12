import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";

interface VendorDCDialogProps {
  dn: DeliveryNote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (modifiedItems: any[]) => void;
}

export function VendorDCDialog({ dn, open, onOpenChange, onGenerate }: VendorDCDialogProps) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (dn) {
      setItems(dn.items.map(item => ({ ...item })));
    }
    console.log("items",items)

  }, [open]);

  if (!dn) return null;

  const handleQtyChange = (idx: number, newQty: string) => {
    const updatedItems = [...items];
    updatedItems[idx].delivered_quantity = parseFloat(newQty) || 0;
    setItems(updatedItems);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Create Vendor Challan For {dn.is_return === 1 ? `RN-${dn.note_no}` : `DN-${dn.note_no}`}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted-foreground/20">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
              <TableRow>
                <TableHead className="bg-background">Item Name</TableHead>
                <TableHead className="text-center w-[60px] bg-background">Unit</TableHead>
                <TableHead className="text-right w-[120px] bg-background">Received Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={item.name || idx}>
                  <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                  <TableCell className="text-center text-xs">{item.unit}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      value={item.delivered_quantity}
                      onChange={(e) => handleQtyChange(idx, e.target.value)}
                      className="h-8 text-right w-24 ml-auto"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onGenerate(items)}>
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

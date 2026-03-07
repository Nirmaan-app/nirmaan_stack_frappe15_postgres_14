import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/utils/FormatDate";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";

interface DNDetailDialogProps {
  dn: DeliveryNote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DNDetailDialog({ dn, open, onOpenChange }: DNDetailDialogProps) {
  if (!dn) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{dn.name}</DialogTitle>
          <div className="flex items-center gap-3 text-sm text-muted-foreground pt-1">
            <span>{formatDate(dn.delivery_date)}</span>
            {dn.updated_by_user && <span>by {dn.updated_by_user}</span>}
          </div>
        </DialogHeader>
        <div className="max-h-[400px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead className="text-center w-[60px]">Unit</TableHead>
                <TableHead className="text-right w-[80px]">Delivered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dn.items.map((item, idx) => (
                <TableRow key={item.name || idx}>
                  <TableCell className="text-sm">{item.item_name}</TableCell>
                  <TableCell className="text-center text-xs">{item.unit}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {item.delivered_quantity}
                  </TableCell>
                </TableRow>
              ))}
              {dn.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center text-muted-foreground py-6"
                  >
                    No items
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

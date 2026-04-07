import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";

interface SameDayDNWarningDialogProps {
  sameDayDNs: DeliveryNote[];
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}

export function SameDayDNWarningDialog({
  sameDayDNs,
  open,
  onCancel,
  onContinue,
}: SameDayDNWarningDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Delivery Note Already Created Today
          </AlertDialogTitle>
          <AlertDialogDescription>
            The following delivery note(s) were already created today for this
            PO. Do you still want to continue?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {sameDayDNs.map((dn) => (
            <div key={dn.name}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm font-medium">{dn.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(dn.delivery_date)}
                  {dn.updated_by_user && ` by ${dn.updated_by_user}`}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-center w-[60px]">Unit</TableHead>
                    <TableHead className="text-right w-[80px]">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dn.items.map((item, idx) => (
                    <TableRow key={item.name || idx}>
                      <TableCell className="text-sm">
                        {item.item_name}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {item.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {item.delivered_quantity}
                      </TableCell>
                    </TableRow>
                  ))}
                  {dn.items.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-center text-muted-foreground py-4"
                      >
                        No items
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={onContinue}>Continue Anyway</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

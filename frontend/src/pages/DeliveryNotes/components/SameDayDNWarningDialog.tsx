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

export type WarningDN = {
  dn: DeliveryNote;
  reason: "same-day" | "duplicate" | "both";
};

interface SameDayDNWarningDialogProps {
  warningDNs: WarningDN[];
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}

const REASON_BADGE: Record<WarningDN["reason"], { label: string; cls: string }> = {
  "same-day": {
    label: "Created today",
    cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  },
  duplicate: {
    label: "Same items & quantities",
    cls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
  },
  both: {
    label: "Created today • Same items & quantities",
    cls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
  },
};

function getCopy(warningDNs: WarningDN[]) {
  const hasSameDay = warningDNs.some(
    (w) => w.reason === "same-day" || w.reason === "both"
  );
  const hasDuplicate = warningDNs.some(
    (w) => w.reason === "duplicate" || w.reason === "both"
  );

  if (hasSameDay && hasDuplicate) {
    return {
      title: "Possible Duplicate Delivery Note",
      description:
        "The following delivery note(s) were created today and/or contain the same items and quantities you are about to submit. Do you still want to continue?",
    };
  }
  if (hasDuplicate) {
    return {
      title: "Duplicate Delivery Note Detected",
      description:
        "The following delivery note(s) already contain the same items and quantities you are about to submit. Do you still want to continue?",
    };
  }
  return {
    title: "Delivery Note Already Created Today",
    description:
      "The following delivery note(s) were already created today for this PO. Do you still want to continue?",
  };
}

export function SameDayDNWarningDialog({
  warningDNs,
  open,
  onCancel,
  onContinue,
}: SameDayDNWarningDialogProps) {
  const { title, description } = getCopy(warningDNs);

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {warningDNs.map(({ dn, reason }) => {
            const badge = REASON_BADGE[reason];
            return (
              <div key={dn.name}>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-sm font-medium">{dn.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(dn.delivery_date)}
                    {dn.updated_by_user && ` by ${dn.updated_by_user}`}
                  </span>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badge.cls}`}
                  >
                    {badge.label}
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
            );
          })}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={onContinue}>Continue Anyway</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

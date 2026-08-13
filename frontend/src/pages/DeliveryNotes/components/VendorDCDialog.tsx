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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Pencil, RotateCcw } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { formatDate } from "@/utils/FormatDate";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";

/** Per-challan vendor overrides. Blank name/address mean "use the vendor master". */
export interface VendorDCOverrides {
  vendorName: string;
  vendorAddress: string;
  hideVendor: boolean;
}

interface VendorDCDialogProps {
  dn: DeliveryNote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (modifiedItems: any[], vendorOverrides: VendorDCOverrides) => void;
}

/**
 * Mirrors the `format_address` macro in the "Vendor Delivery Challan" print format:
 * line1 / line2 / "city state pincode" / country, one per line. Keeping the two in
 * step is what makes the dialog WYSIWYG — what is typed here is what prints.
 */
function composeAddress(addr?: Record<string, any>): string {
  if (!addr) return "";
  const parts: string[] = [];
  if (addr.address_line1) parts.push(addr.address_line1);
  if (addr.address_line2) parts.push(addr.address_line2);
  const cityStatePin = [addr.city, addr.state, addr.pincode].filter(Boolean);
  if (cityStatePin.length) parts.push(cityStatePin.join(" "));
  if (addr.country) parts.push(addr.country);
  return parts.join("\n");
}

export function VendorDCDialog({ dn, open, onOpenChange, onGenerate }: VendorDCDialogProps) {
  const [items, setItems] = useState<any[]>([]);
  const [vendorName, setVendorName] = useState("");
  const [vendorAddress, setVendorAddress] = useState("");
  const [hideVendor, setHideVendor] = useState(false);
  const [editingVendor, setEditingVendor] = useState(false);
  // Once the user types, stop re-seeding from the master (the docs resolve async).
  const [vendorTouched, setVendorTouched] = useState(false);

  const { data: vendorDoc } = useFrappeGetDoc<any>(
    "Vendors",
    dn?.vendor,
    dn?.vendor && open ? undefined : null
  );

  const addressId = vendorDoc?.vendor_address;
  const { data: addressDoc } = useFrappeGetDoc<any>(
    "Address",
    addressId,
    addressId && open ? undefined : null
  );

  const defaultVendorName = vendorDoc?.vendor_name ?? "";
  const defaultVendorAddress = useMemo(
    () => composeAddress(addressDoc),
    [
      addressDoc?.address_line1,
      addressDoc?.address_line2,
      addressDoc?.city,
      addressDoc?.state,
      addressDoc?.pincode,
      addressDoc?.country,
    ]
  );

  // Reset everything whenever the dialog opens for a (possibly different) DN.
  useEffect(() => {
    if (!open) return;
    setItems(dn ? dn.items.map((item) => ({ ...item })) : []);
    setVendorName("");
    setVendorAddress("");
    setHideVendor(false);
    setEditingVendor(false);
    setVendorTouched(false);
  }, [open, dn?.name]);

  // Seed the vendor fields as the linked docs arrive, until the user edits them.
  useEffect(() => {
    if (!open || vendorTouched) return;
    setVendorName(defaultVendorName);
    setVendorAddress(defaultVendorAddress);
  }, [open, vendorTouched, defaultVendorName, defaultVendorAddress]);

  const totalQty = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.delivered_quantity) || 0), 0),
    [items]
  );

  // One-line form of the address for the collapsed summary row.
  const addressPreview = useMemo(
    () => vendorAddress.split("\n").map((l) => l.trim()).filter(Boolean).join(", "),
    [vendorAddress]
  );

  const vendorIsEdited =
    vendorName !== defaultVendorName || vendorAddress !== defaultVendorAddress;

  if (!dn) return null;

  const noteLabel = dn.is_return === 1 ? `RN-${dn.note_no}` : `DN-${dn.note_no}`;

  const handleQtyChange = (idx: number, newQty: string) => {
    const updatedItems = [...items];
    updatedItems[idx].delivered_quantity = parseFloat(newQty) || 0;
    setItems(updatedItems);
  };

  const handleResetVendor = () => {
    setVendorName(defaultVendorName);
    setVendorAddress(defaultVendorAddress);
    setVendorTouched(false);
  };

  const handlePrintToggle = (printIt: boolean) => {
    setHideVendor(!printIt);
    if (!printIt) setEditingVendor(false);
  };

  const handleGenerate = () => {
    onGenerate(items, {
      vendorName: hideVendor ? "" : vendorName,
      vendorAddress: hideVendor ? "" : vendorAddress,
      hideVendor,
    });
  };

  const printToggle = (
    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer shrink-0">
      Show vendor ?
      <Switch checked={!hideVendor} onCheckedChange={handlePrintToggle} />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `max-h` + flex column is load-bearing: DialogContent is `fixed` and
          centred with NO height cap of its own, so in edit mode the box grew
          past the viewport and pushed the title and the Cancel / Download
          buttons off-screen on short phones. `dvh` is applied only where
          supported (it accounts for mobile browser chrome); `vh` is the
          universal fallback. */}
      <DialogContent className="max-w-2xl p-4 sm:p-6 flex flex-col overflow-hidden max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh]">
        <DialogHeader className="space-y-0.5 shrink-0">
          <DialogTitle className="text-base">
            Vendor Delivery Challan · {noteLabel}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {dn.procurement_order || "—"} · {formatDate(dn.delivery_date)}
          </p>
        </DialogHeader>

        {/* Everything between header and footer scrolls as ONE region — a single
            scrollbar rather than nested ones, which chain badly on touch. */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">

        {/* `min-w-0` is load-bearing: a flex/grid child defaults to
            `min-width: auto`, so a long unbroken address line would widen the
            column past max-w-2xl and push every sibling out with it. */}
        <div className="space-y-1.5 min-w-0">
          {/* Heading sits OUTSIDE the card, mirroring the ITEMS heading below,
              so the card holds only vendor data + its controls. */}
          <div className="flex items-center justify-between min-w-0">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Vendor
            </span>
            {printToggle}
          </div>

          <div className="rounded-md border px-3 py-2 min-w-0">
          {hideVendor ? (
            <p className="text-xs text-muted-foreground">
              Not printed — Buyer (Bill to) moves up into this space.
            </p>
          ) : editingVendor ? (
            <div className="space-y-2">
              <div className="flex items-center justify-end gap-1">
                {/* Always rendered so it is discoverable; disabled when the
                    fields already match the vendor master and there is nothing
                    to undo. Restores BOTH name and address. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground disabled:opacity-40"
                  onClick={handleResetVendor}
                  disabled={!vendorIsEdited}
                  title={
                    vendorIsEdited
                      ? "Restore the vendor name and address from the vendor master"
                      : "Already matching the vendor master"
                  }
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs border-green-500 text-green-600 hover:bg-green-50 hover:text-green-700 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950/30"
                  onClick={() => setEditingVendor(false)}
                >
                  Done
                </Button>
              </div>
              <div className="space-y-1">
                <Label htmlFor="vendor-dc-name" className="text-xs text-muted-foreground">
                  Vendor Name
                </Label>
                <Input
                  id="vendor-dc-name"
                  value={vendorName}
                  onChange={(e) => {
                    setVendorTouched(true);
                    setVendorName(e.target.value);
                  }}
                  className="h-8"
                  placeholder="Vendor name as it should print"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vendor-dc-address" className="text-xs text-muted-foreground">
                  Vendor Address
                </Label>
                <Textarea
                  id="vendor-dc-address"
                  value={vendorAddress}
                  onChange={(e) => {
                    setVendorTouched(true);
                    setVendorAddress(e.target.value);
                  }}
                  rows={4}
                  placeholder="One line per address line"
                  className="text-sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                This challan only. Vendor master unchanged.
              </p>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {vendorName || <span className="text-muted-foreground">Not set</span>}
                </p>
                <p
                  className="text-xs text-muted-foreground truncate"
                  title={vendorAddress || undefined}
                >
                  {addressPreview || "No address on file"}
                </p>
              </div>
              <div className="shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs border-red-500 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                  onClick={() => setEditingVendor(true)}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              </div>
            </div>
          )}
          </div>
        </div>

        <div className="flex items-center justify-between min-w-0">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Items
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* No overflow of its own — that would make it a scroll container, and
            the sticky <thead> below would then stick to a box that never
            scrolls. It sticks to the outer scroll region instead. */}
        <div className="min-w-0">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
              <TableRow>
                <TableHead className="h-8 py-1 text-xs bg-background">Item Name</TableHead>
                <TableHead className="h-8 py-1 text-xs text-center w-[60px] bg-background">Unit</TableHead>
                <TableHead className="h-8 py-1 text-xs text-right w-[110px] bg-background">Received Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={item.name || idx}>
                  <TableCell className="py-1 text-sm font-medium break-words">{item.item_name}</TableCell>
                  <TableCell className="py-1 text-center text-xs">{item.unit}</TableCell>
                  <TableCell className="py-1 text-right">
                    <Input
                      type="number"
                      value={item.delivered_quantity}
                      onChange={(e) => handleQtyChange(idx, e.target.value)}
                      className="h-7 text-right w-20 ml-auto"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mirrors the Total Quantity row the print format renders. */}
        <div className="flex items-center justify-between border-t pt-2 text-sm">
          <span className="font-medium">Total Quantity</span>
          <span className="font-semibold tabular-nums">
            {Math.round(totalQty * 1000) / 1000}
          </span>
        </div>

        </div>

        <DialogFooter className="gap-2 sm:justify-end shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate}>
            Generate PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

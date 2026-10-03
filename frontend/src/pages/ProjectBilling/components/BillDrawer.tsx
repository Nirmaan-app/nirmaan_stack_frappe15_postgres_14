import { useEffect, useState } from "react";
import { ExternalLink, Lock, Pencil } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import { BILL_STATUSES, BILL_TYPES } from "../billing.constants";
import { useBillingMutations } from "../data/useBillingQueries";
import type { BillDoc, BillDraft, BillingTracker } from "../types";
import { inr, managerNames } from "../utils/billingFormat";
import { PersonChips } from "./BillingBits";

interface BillDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bill being edited; omit to add a new one. */
  bill?: BillDoc | null;
  /** The project's package trackers. A new bill can only use one of these. */
  trackers: BillingTracker[];
  projectLabel: string;
  /** Pre-pick a package when adding from a filtered view. */
  defaultTracker?: string;
  onSetupPackages?: () => void;
  /** Called after a successful save (e.g. to refetch a DataTable). */
  onSaved?: () => void;
}

function draftFrom(bill: BillDoc | null | undefined, defaultTracker?: string): BillDraft {
  return {
    name: bill?.name,
    billing_tracker: bill?.billing_tracker || defaultTracker || "",
    bill_type: bill?.bill_type || "",
    status: bill?.status || "Not Started",
    bill_value: bill?.bill_value === null || bill?.bill_value === undefined ? "" : String(bill.bill_value),
    payment_received:
      bill?.payment_received === null || bill?.payment_received === undefined ? "" : String(bill.payment_received),
    invoice_requested: !!bill?.invoice_requested,
    eta_date: bill?.eta_date || "",
    approval_date: bill?.approval_date || "",
    bill_document_link: bill?.bill_document_link || "",
  };
}

function ReadOnlyRow({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2.5", !last && "border-b border-gray-100")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-semibold text-gray-900">{children}</span>
    </div>
  );
}

export function BillDrawer({
  open,
  onOpenChange,
  bill,
  trackers,
  projectLabel,
  defaultTracker,
  onSetupPackages,
  onSaved,
}: BillDrawerProps) {
  const isNew = !bill;
  const [draft, setDraft] = useState<BillDraft>(() => draftFrom(bill, defaultTracker));
  const { saveBill, loading } = useBillingMutations();

  useEffect(() => {
    if (open) setDraft(draftFrom(bill, defaultTracker));
  }, [open, bill, defaultTracker]);

  const tracker = trackers.find((t) => t.name === draft.billing_tracker);
  const set = <K extends keyof BillDraft>(key: K, value: BillDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const canSave = !!draft.billing_tracker && !!draft.bill_type && !loading;

  const handleSave = async () => {
    try {
      await saveBill({
        name: draft.name,
        billing_tracker: draft.billing_tracker,
        bill_type: draft.bill_type,
        status: draft.status,
        bill_value: draft.bill_value === "" ? null : Number(draft.bill_value),
        payment_received: draft.payment_received === "" ? null : Number(draft.payment_received),
        invoice_requested: draft.invoice_requested,
        eta_date: draft.eta_date || null,
        approval_date: draft.approval_date || null,
        bill_document_link: draft.bill_document_link.trim() || null,
      });
      toast({ title: isNew ? "Bill added" : "Bill updated", variant: "success" });
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast({
        title: "Could not save the bill",
        description: getFrappeError(e),
        variant: "destructive",
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[460px]">
        <SheetHeader>
          <SheetTitle>{isNew ? "Add a bill" : "Update bill"}</SheetTitle>
          <SheetDescription>
            {isNew ? "Pick the package, then fill in what you know so far." : `${bill?.package} · ${bill?.bill_type}`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section>
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-muted-foreground">
              <Lock className="h-3 w-3" /> {isNew ? "BILL REFERENCE" : "PACKAGE LEVEL"}
            </div>
            <div className="rounded-lg border bg-gray-50 px-3.5 py-1">
              <ReadOnlyRow label="Project">{projectLabel}</ReadOnlyRow>
              {isNew ? (
                <div className="py-2.5">
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Package</Label>
                  {trackers.length ? (
                    <Select value={draft.billing_tracker} onValueChange={(v) => set("billing_tracker", v)}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select a package" />
                      </SelectTrigger>
                      <SelectContent>
                        {trackers.map((t) => (
                          <SelectItem key={t.name} value={t.name}>
                            {t.package}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Set up billing packages for this project first.
                      {onSetupPackages && (
                        <Button size="sm" variant="outline" onClick={onSetupPackages}>
                          Set up
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <ReadOnlyRow label="Package">{bill?.package}</ReadOnlyRow>
              )}
              <ReadOnlyRow label="Billing managers">
                <PersonChips names={managerNames(tracker?.billing_managers)} className="justify-end" />
              </ReadOnlyRow>
              <ReadOnlyRow label="PO value">{tracker ? inr(tracker.po_value) : "—"}</ReadOnlyRow>
              <ReadOnlyRow label="Supply DC till date">{tracker ? inr(tracker.supply_dc) : "—"}</ReadOnlyRow>
              <ReadOnlyRow label="First submission date" last>
                {bill?.first_submission_date ? formatDate(bill.first_submission_date) : "Set when submitted"}
              </ReadOnlyRow>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-primary">
              <Pencil className="h-3 w-3" /> YOUR UPDATE
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-xs">Bill type</Label>
                <Select value={draft.bill_type} onValueChange={(v) => set("bill_type", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {BILL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Bill status</Label>
                <Select value={draft.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bill-value" className="mb-1.5 block text-xs">
                  Bill value (₹)
                </Label>
                <Input
                  id="bill-value"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.bill_value}
                  onChange={(e) => set("bill_value", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="bill-eta" className="mb-1.5 block text-xs">
                  ETA date
                </Label>
                <Input id="bill-eta" type="date" value={draft.eta_date} onChange={(e) => set("eta_date", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bill-approval" className="mb-1.5 block text-xs">
                  Approval date
                </Label>
                <Input
                  id="bill-approval"
                  type="date"
                  value={draft.approval_date}
                  onChange={(e) => set("approval_date", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="bill-payment" className="mb-1.5 block text-xs">
                  Payment received (₹)
                </Label>
                <Input
                  id="bill-payment"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.payment_received}
                  onChange={(e) => set("payment_received", e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="bill-link" className="mb-1.5 block text-xs">
                Bill document link
              </Label>
              <Input
                id="bill-link"
                type="url"
                placeholder="Paste the link to the bill document"
                value={draft.bill_document_link}
                onChange={(e) => set("bill_document_link", e.target.value)}
              />
              {draft.bill_document_link.trim() && (
                <a
                  href={draft.bill_document_link.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open document
                </a>
              )}
            </div>

            <div>
              <Label className="mb-2 block text-xs">Invoice requested?</Label>
              <div className="inline-flex overflow-hidden rounded-md border">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => set("invoice_requested", v)}
                    className={cn(
                      "px-6 py-2 text-sm font-semibold",
                      !v && "border-l",
                      draft.invoice_requested === v ? "bg-primary text-white" : "bg-white text-gray-700 hover:bg-gray-50",
                    )}
                  >
                    {v ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="flex gap-2.5 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-[2]" disabled={!canSave} onClick={handleSave}>
              {loading ? "Saving…" : isNew ? "Add bill" : "Save changes"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

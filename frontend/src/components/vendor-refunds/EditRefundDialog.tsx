import { useState } from "react";
import { useFrappeFileUpload } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { useVendorAdjustmentCredit } from "@/pages/POAdjustment/data/usePOAdjustmentQueries";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { RefundAttachmentLink } from "./RefundAttachmentLink";
import type { VendorRefundRow } from "./useVendorRefunds";
import {
    refundEditChanges,
    type RefundEdit,
    type refundEditAccess,
    type RefundEditForm,
} from "./waitingRefundExits";

interface EditRefundDialogProps {
    refund: VendorRefundRow;
    poId: string;
    access: ReturnType<typeof refundEditAccess>;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (changes: RefundEdit) => Promise<unknown>;
}

const formOf = (refund: VendorRefundRow, poId: string): RefundEditForm => ({
    amount: String(refund.amount ?? ""),
    poId: refund.document_name || poId,
    utr: refund.utr ?? "",
    description: refund.description ?? "",
});

/**
 * Edit a Vendor Refund from its PO's Transaction Details (#1396 stories 8 and 10). Its amount and PO while
 * it waits (its creator or an Accountant; another PO must have overpaid credit, which the server re-checks
 * against the unheld balance); its proof, UTR and description at any status (whoever works the PO's
 * payments). The UTR is fixed while a bank line is matched to it: Unreconcile reads it. This is also how
 * accounts attach proof to a refund marked "No proof attached" (#1404).
 */
export const EditRefundDialog = ({ refund, poId, access, open, onOpenChange, onSave }: EditRefundDialogProps) => {
    const [form, setForm] = useState<RefundEditForm>(() => formOf(refund, poId));
    const [proof, setProof] = useState<File | null>(null);
    const { upload, loading: uploading } = useFrappeFileUpload();
    const [saving, setSaving] = useState(false);
    // Another PO of the vendor it may move to: one with overpaid credit to refund.
    const { vendorCredit } = useVendorAdjustmentCredit(refund.vendor, poId, open && access.money);

    const changes = refundEditChanges(refund, form, access);
    const amount = Number(form.amount);
    const amountValid = !access.money || (Number.isFinite(amount) && amount > 0);
    const dirty = Object.keys(changes).length > 0 || proof !== null;

    const set = (field: keyof RefundEditForm) => (value: string) => setForm((f) => ({ ...f, [field]: value }));

    const reset = (next: boolean) => {
        if (next) {
            setForm(formOf(refund, poId));
            setProof(null);
        }
        onOpenChange(next);
    };

    const submit = async () => {
        setSaving(true);
        try {
            const attachment = proof ? (await upload(proof, { isPrivate: true })).file_url : undefined;
            await onSave(attachment ? { ...changes, refund_attachment: attachment } : changes);
            toast({ title: "Refund updated", description: `${refund.name} is saved.`, variant: "success" });
            onOpenChange(false);
        } catch (error) {
            toast({
                title: "Could not update the refund",
                description: error instanceof Error ? error.message : "Something went wrong.",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const id = (field: string) => `refund-edit-${field}-${refund.name}`;

    return (
        <Dialog open={open} onOpenChange={reset}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit {refund.name}</DialogTitle>
                    <DialogDescription>
                        {access.money
                            ? "It is still waiting for its bank line, so its amount and PO can be corrected."
                            : `${refund.status}: its amount (${formatToRoundedIndianRupee(refund.amount)}) and PO are fixed. Its paperwork can still be completed.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    {access.money && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label htmlFor={id("amount")}>Amount</Label>
                                <Input
                                    id={id("amount")}
                                    inputMode="decimal"
                                    value={form.amount}
                                    onChange={(e) => set("amount")(e.target.value)}
                                />
                                {!amountValid && <p className="text-xs text-destructive">Enter an amount above 0.</p>}
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor={id("po")}>PO</Label>
                                <Select value={form.poId} onValueChange={set("poId")}>
                                    <SelectTrigger id={id("po")}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={poId}>{poId}</SelectItem>
                                        {(vendorCredit?.sources ?? []).map((source) => (
                                            <SelectItem key={source.po_id} value={source.po_id}>
                                                {source.po_id} ({formatToRoundedIndianRupee(source.available)} overpaid)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label htmlFor={id("utr")}>UTR</Label>
                        <Input
                            id={id("utr")}
                            value={form.utr}
                            disabled={access.utrLocked}
                            onChange={(e) => set("utr")(e.target.value)}
                        />
                        {access.utrLocked && (
                            <p className="text-xs text-muted-foreground">
                                This is the reference of the bank line matched to it. Unreconcile that line in Bulk
                                Import first if it is wrong.
                            </p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <Label>Proof</Label>
                        {refund.refund_attachment && !proof && (
                            <p className="text-xs">
                                Attached: <RefundAttachmentLink refund={{ ...refund, utr: null }} className="max-w-60" />
                            </p>
                        )}
                        <CustomAttachment
                            selectedFile={proof}
                            onFileSelect={setProof}
                            label={refund.refund_attachment ? "Replace proof" : "Attach proof"}
                            acceptedTypes={["application/pdf", "image/*"]}
                        />
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor={id("description")}>Description</Label>
                        <Textarea
                            id={id("description")}
                            rows={2}
                            value={form.description}
                            onChange={(e) => set("description")(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => reset(false)} disabled={saving}>
                        Back
                    </Button>
                    <Button onClick={submit} disabled={saving || uploading || !dirty || !amountValid}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

/**
 * Generated invoices on a GST-off Work Order's invoices card (#1546, #1547, spec #1528): the Generate
 * dialog, and the list with Print, Void and Upload signed.
 *
 * The server assigns the RA number, holds the amount limit, decides FINAL and books the signed upload
 * (`useGeneratedInvoices`); this screen only shows what it says.
 */
import { useState } from "react";
import { formatDate } from "date-fns";
import { Eye, Ban, Upload } from "lucide-react";
import { useFrappeFileUpload } from "frappe-react-sdk";

import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeErrorText } from "@/utils/frappeErrors";
import {
  GeneratedInvoice,
  GeneratedInvoicesState,
  GeneratedInvoiceType,
  generatedInvoiceLabel,
  useGeneratedInvoiceActions,
} from "../../hooks/useGeneratedInvoices";

/** n rounded to 2 decimals, without trailing zeros: 420000 -> "420000", 33.3333 -> "33.33". */
const toTwoDecimals = (n: number): string => String(Math.round(n * 100) / 100);

/** Percentage and Amount after one of them is typed: the other follows through the WO amount. */
const syncPercentAmount = (field: "percent" | "amount", value: string, woAmount: number) => {
  const n = Number(value);
  const canSync = value !== "" && Number.isFinite(n) && woAmount > 0;
  return field === "percent"
    ? { percent: value, amount: canSync ? toTwoDecimals((woAmount * n) / 100) : "" }
    : { amount: value, percent: canSync ? toTwoDecimals((n / woAmount) * 100) : "" };
};

interface GenerateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder: string;
  /** The Work Order's amount, which the percentage is of. */
  woAmount: number;
  state: GeneratedInvoicesState | undefined;
  onGenerated: (row: GeneratedInvoice) => void;
}

export const GenerateInvoiceDialog = ({
  open,
  onOpenChange,
  workOrder,
  woAmount,
  state,
  onGenerated,
}: GenerateInvoiceDialogProps) => {
  const { toast } = useToast();
  const { generate, generating } = useGeneratedInvoiceActions();
  const [invoiceType, setInvoiceType] = useState<GeneratedInvoiceType>("RA");
  const [invoiceDate, setInvoiceDate] = useState(formatDate(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");

  const reset = () => {
    setInvoiceType("RA");
    setInvoiceDate(formatDate(new Date(), "yyyy-MM-dd"));
    setAmount("");
    setPercent("");
  };

  const left = state?.left ?? 0;
  const finalAmount = state?.final_amount ?? null;
  const isFinal = invoiceType === "FINAL";
  const typed = Number(amount);
  const problem: string | null = !invoiceDate
    ? "Invoice Date is required."
    : isFinal
      ? finalAmount === null
        ? "FINAL can be generated only once the Work Order is fully paid."
        : finalAmount <= 0
          ? "Nothing is left to bill on this Work Order."
          : null
      : !amount || !(typed > 0)
        ? "Enter an amount more than ₹0."
        : Math.round(typed * 100) > Math.round(left * 100)
          ? `This invoice can bill at most ${formatToIndianRupee(left)}.`
          : null;

  const onType = (field: "percent" | "amount", value: string) => {
    const next = syncPercentAmount(field, value, woAmount);
    setAmount(next.amount);
    setPercent(next.percent);
  };

  const submit = async () => {
    try {
      const row = await generate({
        work_order: workOrder,
        invoice_type: invoiceType,
        invoice_date: invoiceDate,
        ...(isFinal ? {} : { amount: typed }),
      });
      toast({ title: "Invoice generated", description: row.invoice_no, variant: "success" });
      reset();
      onOpenChange(false);
      onGenerated(row);
    } catch (error) {
      toast({ title: "Could not generate the invoice", description: getFrappeErrorText(error), variant: "destructive" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b pb-4">
          <DialogTitle>Generate Invoice for {workOrder}</DialogTitle>
          <DialogDescription>
            The invoice is saved with the next RA number and can't be edited afterwards; a wrong one is voided.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 pt-2 pb-6">
          <div className="space-y-1.5">
            <Label>
              Invoice Type <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={invoiceType}
              onValueChange={(value) => setInvoiceType(value as GeneratedInvoiceType)}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="RA" id="gi_type_ra" />
                <Label htmlFor="gi_type_ra" className="font-normal">RA (running bill)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="FINAL" id="gi_type_final" disabled={finalAmount === null} />
                <Label htmlFor="gi_type_final" className="font-normal">FINAL</Label>
              </div>
            </RadioGroup>
            {finalAmount === null && (
              <p className="text-xs text-muted-foreground">FINAL opens once the Work Order is fully paid.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gi_invoice_date">
                Invoice Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="gi_invoice_date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gi_ra_no">RA No.</Label>
              <Input id="gi_ra_no" value={isFinal ? "FINAL" : `RA-${state?.next_ra_number ?? "…"}`} disabled />
            </div>
          </div>
          {isFinal ? (
            <p className="text-sm">
              FINAL bills what is left:{" "}
              <span className="font-semibold">{finalAmount === null ? "--" : formatToIndianRupee(finalAmount)}</span>
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="gi_percent">Percentage (%)</Label>
                  <Input
                    id="gi_percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={percent}
                    onChange={(e) => onType("percent", e.target.value)}
                    placeholder="e.g., 20"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gi_amount">
                    Amount (₹) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="gi_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => onType("amount", e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Can bill up to {formatToIndianRupee(left)}: the smaller of the WO amount and its Amount Paid (incl.
                TDS), less what is already billed or waiting.
              </p>
            </div>
          )}
          {problem && (amount || percent || isFinal) && <p className="text-xs text-destructive">{problem}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={generating || !!problem}>
            {generating ? "Generating…" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Generated: "secondary",
  Signed: "outline",
  Approved: "default",
  Voided: "destructive",
};

interface GeneratedInvoicesTableProps {
  /** The Work Order the scans are filed under. */
  workOrder: string;
  invoices: GeneratedInvoice[];
  /** The user may void and upload (the server checks again). */
  canManage: boolean;
  onPrint: (row: GeneratedInvoice) => void;
  /** A void or an upload changed the records (an upload also adds a Vendor Invoice). */
  onChanged: () => void;
}

export const GeneratedInvoicesTable = ({ workOrder, invoices, canManage, onPrint, onChanged }: GeneratedInvoicesTableProps) => {
  const { toast } = useToast();
  const { voidInvoice, voiding } = useGeneratedInvoiceActions();
  // The row's name, not the row: the list refetches after a void (frontend/CODING_STANDARDS.md).
  const [voidingName, setVoidingName] = useState<string | null>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const voidingRow = invoices.find((r) => r.name === voidingName);
  const uploadingRow = invoices.find((r) => r.name === uploadingName);

  const closeVoid = () => {
    setVoidingName(null);
    setReason("");
  };

  const confirmVoid = async () => {
    if (!voidingName) return;
    try {
      await voidInvoice(voidingName, reason);
      toast({ title: "Invoice voided", description: voidingRow?.invoice_no, variant: "success" });
      closeVoid();
      onChanged();
    } catch (error) {
      toast({ title: "Could not void the invoice", description: getFrappeErrorText(error), variant: "destructive" });
    }
  };

  return (
    <>
      <Table>
        <TableHeader className="bg-red-100">
          <TableRow>
            <TableHead className="text-black font-bold">Generated Invoice</TableHead>
            <TableHead className="text-black font-bold">RA</TableHead>
            <TableHead className="text-black font-bold">Date</TableHead>
            <TableHead className="text-black font-bold text-right">Amount</TableHead>
            <TableHead className="text-black font-bold">Status</TableHead>
            <TableHead className="text-black font-bold text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="font-medium">{row.invoice_no}</TableCell>
              <TableCell>{generatedInvoiceLabel(row)}</TableCell>
              <TableCell>{row.invoice_date ? formatDate(new Date(row.invoice_date), "dd-MMM-yyyy") : "--"}</TableCell>
              <TableCell className="text-right">{formatToIndianRupee(row.amount)}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>{row.status}</Badge>
                {row.status === "Voided" && row.void_reason && (
                  <p className="text-xs text-muted-foreground mt-1">{row.void_reason}</p>
                )}
                {row.status !== "Voided" && row.vendor_invoice && (
                  <p className="text-xs text-muted-foreground mt-1">Vendor Invoice {row.vendor_invoice}</p>
                )}
              </TableCell>
              <TableCell className="text-center whitespace-nowrap">
                <Button variant="ghost" size="sm" onClick={() => onPrint(row)} aria-label={`Print ${row.invoice_no}`}>
                  <Eye className="h-4 w-4 mr-1" /> Print
                </Button>
                {canManage && row.status === "Generated" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setUploadingName(row.name)}
                    aria-label={`Upload signed copy of ${row.invoice_no}`}
                  >
                    <Upload className="h-4 w-4 mr-1" /> Upload signed
                  </Button>
                )}
                {canManage && row.status === "Generated" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setVoidingName(row.name)}
                    aria-label={`Void ${row.invoice_no}`}
                  >
                    <Ban className="h-4 w-4 mr-1" /> Void
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!voidingName} onOpenChange={(open) => !open && closeVoid()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void {voidingRow?.invoice_no}?</DialogTitle>
            <DialogDescription>
              A voided invoice keeps its record and its number: {voidingRow ? generatedInvoiceLabel(voidingRow) : ""} is
              never given again, and its amount is freed for the next invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="gi_void_reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea id="gi_void_reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="button" variant="destructive" onClick={confirmVoid} disabled={voiding || !reason.trim()}>
              {voiding ? "Voiding…" : "Void"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UploadSignedCopyDialog
        workOrder={workOrder}
        row={uploadingRow}
        onClose={() => setUploadingName(null)}
        onUploaded={onChanged}
      />
    </>
  );
};

interface UploadSignedCopyDialogProps {
  workOrder: string;
  /** The record being uploaded; the dialog is closed while undefined. */
  row: GeneratedInvoice | undefined;
  onClose: () => void;
  onUploaded: () => void;
}

/** Upload the vendor's signed copy: the record turns Signed and a Pending Vendor Invoice is made (#1547). */
const UploadSignedCopyDialog = ({ workOrder, row, onClose, onUploaded }: UploadSignedCopyDialogProps) => {
  const { toast } = useToast();
  const { uploadSignedCopy, uploading } = useGeneratedInvoiceActions();
  const { upload, loading: sendingFile } = useFrappeFileUpload();
  const [file, setFile] = useState<File | null>(null);
  const busy = uploading || sendingFile;

  const close = () => {
    setFile(null);
    onClose();
  };

  const submit = async () => {
    if (!row || !file) return;
    try {
      const sent = await upload(file, {
        doctype: "Service Requests",
        docname: workOrder,
        fieldname: "attachment",
        isPrivate: true,
      });
      const record = await uploadSignedCopy(row.name, sent.file_url);
      toast({
        title: "Signed copy uploaded",
        description: `${record.invoice_no} is waiting for approval as ${record.vendor_invoice}.`,
        variant: "success",
      });
      close();
      onUploaded();
    } catch (error) {
      toast({ title: "Could not upload the signed copy", description: getFrappeErrorText(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload signed copy of {row?.invoice_no}</DialogTitle>
          <DialogDescription>
            This books the vendor's signed invoice: a Pending Vendor Invoice for {row ? formatToIndianRupee(row.amount) : ""}{" "}
            (no GST) goes to Accountants for approval. It can be uploaded once.
          </DialogDescription>
        </DialogHeader>
        <CustomAttachment
          selectedFile={file}
          onFileSelect={setFile}
          label="Attach signed copy"
          acceptedTypes={["application/pdf", "image/*"]}
          onError={(e) => toast({ title: "File not accepted", description: e.message, variant: "destructive" })}
        />
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Pay a set of TDS deductions against a challan — the dialog behind the "Pay TDS" button.
 *
 * Two arms onto ONE server write (`api/tds_challan/pay_tds`):
 *   • Adjustment By Old Challan — spend the unused balance of a challan already on record.
 *   • Add New Challan          — upload the ITNS 281 receipt, let Gemini read it, correct anything,
 *                                create the challan and pay in the same transaction.
 *
 * ⚠️ EVERY GATE HERE IS CONVENIENCE, NOT ENFORCEMENT. The server re-checks that each deduction is
 * still Pending and that the challan has the balance, inside a row lock — because the numbers this
 * dialog computed were true when it opened, not necessarily when Confirm is pressed.
 *
 * ⚠️ AUTO-FILL NEVER GATES THE FORM. If extraction is disabled, fails, or misreads, the upload has
 * still happened and every field stays typeable — amber tint marks what the model wrote, exactly
 * like InvoiceDialog, so a wrong figure is visible rather than silently trusted.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft, FilePlus2, Loader2, Upload, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { TDSChallanAttachment } from "@/types/NirmaanStack/TDSChallanAttachment";
import { PaymentTDSDeductionRow } from "../config/paymentTdsDeductions.config";

const CHALLAN_DOCTYPE = "TDS Challan Attachment";
const PAY_TDS = "nirmaan_stack.api.tds_challan.pay_tds.pay_tds";
const CREATE_AND_PAY = "nirmaan_stack.api.tds_challan.pay_tds.create_challan_and_pay";
const EXTRACT_CHALLAN = "nirmaan_stack.api.tds_challan_autofill.extract_challan_fields";

/** Matches the doctype's Select options 1:1 — a value outside this list fails Frappe's own check. */
const MODE_OPTIONS = [
    "Net Banking",
    "Debit Card",
    "RTGS/NEFT",
    "Pay at Bank Counter",
    "Payment Gateway",
] as const;

/** Mirrors the server's rupee tolerance so the button and the endpoint agree on "enough balance". */
const TOLERANCE = 0.01;

type Mode = "choose" | "old" | "new";

interface ChallanForm {
    financial_year: string;
    amount: string;
    date_of_deposit: string;
    tender_date: string;
    mode_of_payment: string;
    bank_name: string;
    bank_reference_number: string;
    bsr_code: string;
    challan_no: string;
}

const EMPTY_FORM: ChallanForm = {
    financial_year: "",
    amount: "",
    date_of_deposit: "",
    tender_date: "",
    mode_of_payment: "",
    bank_name: "",
    bank_reference_number: "",
    bsr_code: "",
    challan_no: "",
};

/** Every field the challan doctype marks `reqd` — the submit gate, so the server round-trip is
 *  spent on real failures (a duplicate challan) rather than on a blank box. */
const REQUIRED_FIELDS: (keyof ChallanForm)[] = [
    "financial_year",
    "amount",
    "date_of_deposit",
    "bank_reference_number",
    "bsr_code",
    "challan_no",
];

interface PayTdsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The ticked rows. Only `Pending` ones can be ticked, and the server re-checks that. */
    deductions: PaymentTDSDeductionRow[];
    /** Clear the selection and refetch the ledger. */
    onPaid: () => void;
}

export const PayTdsDialog: React.FC<PayTdsDialogProps> = ({
    open,
    onOpenChange,
    deductions,
    onPaid,
}) => {
    const [mode, setMode] = useState<Mode>("choose");
    const [error, setError] = useState<string | null>(null);

    // --- old-challan arm ---
    const [selectedChallan, setSelectedChallan] = useState<string | null>(null);
    const [challanSearch, setChallanSearch] = useState("");

    // --- new-challan arm ---
    const [form, setForm] = useState<ChallanForm>(EMPTY_FORM);
    const [attachmentUrl, setAttachmentUrl] = useState<string>("");
    const [fileName, setFileName] = useState<string>("");
    const [autofilled, setAutofilled] = useState<Set<string>>(new Set());
    const [readWarnings, setReadWarnings] = useState<string[]>([]);
    const [isReading, setIsReading] = useState(false);
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const totalTds = useMemo(
        () => deductions.reduce((sum, row) => sum + (row.tds_amount || 0), 0),
        [deductions]
    );
    const names = useMemo(() => deductions.map((row) => row.name), [deductions]);

    // Only fetched while the dialog is open. Third arg is the swrKey, never an options object.
    const { data: challans, isLoading: challansLoading } = useFrappeGetDocList<TDSChallanAttachment>(
        CHALLAN_DOCTYPE,
        {
            fields: [
                "name",
                "financial_year",
                "challan_no",
                "date_of_deposit",
                "amount",
                "reconciled_amount",
            ],
            limit: 500,
            orderBy: { field: "date_of_deposit", order: "desc" },
        },
        open ? undefined : null
    );

    const { call: callPayTds, loading: payingOld } = useFrappePostCall(PAY_TDS);
    const { call: callCreateAndPay, loading: payingNew } = useFrappePostCall(CREATE_AND_PAY);
    const { call: callExtract } = useFrappePostCall(EXTRACT_CHALLAN);
    const { upload, loading: uploading } = useFrappeFileUpload();

    const isBusy = payingOld || payingNew || uploading || isReading;

    // A fresh open starts clean: a stale mode or a half-filled form from the last run would be
    // applied to a different selection.
    useEffect(() => {
        if (open) return;
        setMode("choose");
        setError(null);
        setSelectedChallan(null);
        setChallanSearch("");
        setForm(EMPTY_FORM);
        setAttachmentUrl("");
        setFileName("");
        setAutofilled(new Set());
        setReadWarnings([]);
        setDragging(false);
    }, [open]);

    /** Balance is DERIVED here, never read from a stored column — `amount - reconciled_amount`. */
    const payableChallans = useMemo(() => {
        const term = challanSearch.trim().toLowerCase();
        return (challans || [])
            .map((challan) => ({
                ...challan,
                remaining: (challan.amount || 0) - (challan.reconciled_amount || 0),
            }))
            .filter((challan) => challan.remaining > TOLERANCE)
            .filter((challan) =>
                term
                    ? [challan.challan_no, challan.financial_year, challan.name]
                          .filter(Boolean)
                          .some((value) => String(value).toLowerCase().includes(term))
                    : true
            );
    }, [challans, challanSearch]);

    const chosenChallan = useMemo(
        () => payableChallans.find((challan) => challan.name === selectedChallan) || null,
        [payableChallans, selectedChallan]
    );

    const setField = (key: keyof ChallanForm, value: string) => {
        setForm((prev) => ({ ...prev, [key]: value }));
        // Once a human edits a field it is no longer the model's claim, so drop the tint.
        setAutofilled((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next;
        });
    };

    /** Back to the drop zone: the form is hidden again until a file lands. */
    const resetUpload = () => {
        setAttachmentUrl("");
        setFileName("");
        setForm(EMPTY_FORM);
        setAutofilled(new Set());
        setReadWarnings([]);
        setError(null);
    };

    /**
     * ⚠️ THE TWO FAILURES ARE NOT THE SAME AND MUST NOT SHARE A BRANCH.
     * An UPLOAD failure leaves nothing attached, so the form must stay hidden and the drop zone
     * keeps the floor — a challan cannot be created without its receipt. A READ failure means the
     * file IS attached and only the pre-filling was lost, so the form opens blank for manual entry.
     */
    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setError(null);
        setReadWarnings([]);

        let uploadedUrl = "";
        try {
            // No docname yet — the file is linked to the challan when it is created.
            const uploaded = await upload(file, {
                doctype: CHALLAN_DOCTYPE,
                fieldname: "challan_attachment",
                isPrivate: true,
            });
            uploadedUrl = uploaded.file_url;
            setAttachmentUrl(uploadedUrl);
            setFileName(file.name);
        } catch (e: any) {
            setError(`Could not upload the challan (${getFrappeError(e)}). Please try again.`);
            return;
        }

        try {
            setIsReading(true);
            const response = await callExtract({ file_url: uploadedUrl });
            const read = response?.message || {};

            const filled = new Set<string>();
            setForm((prev) => {
                const next = { ...prev };
                (Object.keys(EMPTY_FORM) as (keyof ChallanForm)[]).forEach((key) => {
                    const value = read[key];
                    if (value !== undefined && value !== null && String(value) !== "") {
                        next[key] = String(value);
                        filled.add(key);
                    }
                });
                return next;
            });
            setAutofilled(filled);

            // Deterministic checks, not the model's own confidence.
            const warnings: string[] = [];
            const amountCheck = read?.validation?.amount;
            if (amountCheck?.state === "INVALID") {
                warnings.push(
                    `Amount ${formatToIndianRupee(amountCheck.extracted)} does not match the challan's tax breakup (${formatToIndianRupee(amountCheck.breakup_total)}). Check the amount before paying.`
                );
            }
            const fyCheck = read?.validation?.financial_year;
            if (fyCheck?.state === "INVALID") {
                warnings.push(`Financial Year "${fyCheck.extracted}" doesn't look right — expected a form like 2025-26.`);
            }
            if (!filled.size) {
                warnings.push("Nothing could be read from this file — please type the details in.");
            }
            setReadWarnings(warnings);
        } catch (e: any) {
            // The file IS attached — extraction is the optional half, so the form opens blank and
            // says what happened rather than blocking the challan.
            setReadWarnings([
                `Couldn't read the challan automatically (${getFrappeError(e)}). Enter the details manually.`,
            ]);
        } finally {
            setIsReading(false);
        }
    };

    const announce = (message: any, fallbackChallan: string) => {
        const paid = message?.paid_count ?? deductions.length;
        const remaining = message?.remaining;
        toast({
            title: "TDS paid",
            description:
                `${paid} deduction${paid === 1 ? "" : "s"} marked Paid against ` +
                `${message?.created_challan || fallbackChallan}` +
                (remaining !== undefined ? ` · ${formatToIndianRupee(remaining)} left on the challan` : ""),
            variant: "success",
        });
        onPaid();
        onOpenChange(false);
    };

    const handlePayOld = async () => {
        if (!selectedChallan) return;
        setError(null);
        try {
            const response = await callPayTds({
                deductions: JSON.stringify(names),
                challan: selectedChallan,
            });
            announce(response?.message, selectedChallan);
        } catch (e: any) {
            setError(getFrappeError(e));
        }
    };

    const handleCreateAndPay = async () => {
        setError(null);
        try {
            const response = await callCreateAndPay({
                deductions: JSON.stringify(names),
                challan_data: JSON.stringify({ ...form, challan_attachment: attachmentUrl }),
            });
            announce(response?.message, response?.message?.created_challan || "the new challan");
        } catch (e: any) {
            // A duplicate challan surfaces here, naming the existing one — the cue to switch arms.
            setError(getFrappeError(e));
        }
    };

    const newAmount = Number(form.amount || 0);
    const newFormComplete =
        REQUIRED_FIELDS.every((key) => String(form[key] || "").trim() !== "") && !!attachmentUrl;
    const newAmountCovers = newAmount >= totalTds - TOLERANCE;

    const tint = (key: keyof ChallanForm) =>
        autofilled.has(key) ? "bg-amber-50 border-amber-300 focus-visible:ring-amber-400" : "";

    const field = (key: keyof ChallanForm, label: string, type: "text" | "date" = "text") => (
        <div className="space-y-1">
            <Label htmlFor={`challan-${key}`} className="text-xs">
                {label}
                {REQUIRED_FIELDS.includes(key) && <span className="text-destructive"> *</span>}
            </Label>
            <Input
                id={`challan-${key}`}
                type={type}
                className={cn("h-9", tint(key))}
                value={form[key]}
                onChange={(event) => setField(key, event.target.value)}
                disabled={isBusy}
            />
        </div>
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {mode !== "choose" && (
                            <button
                                type="button"
                                aria-label="Back"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => setMode("choose")}
                                disabled={isBusy}
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </button>
                        )}
                        Pay TDS
                    </DialogTitle>
                    <DialogDescription>
                        {deductions.length} pending deduction{deductions.length === 1 ? "" : "s"} ·{" "}
                        <span className="font-semibold text-red-700 dark:text-red-400">
                            {formatToIndianRupee(totalTds)}
                        </span>{" "}
                        to pay
                    </DialogDescription>
                </DialogHeader>

                {mode === "choose" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setMode("old")}
                            className="rounded-lg border p-4 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/50"
                        >
                            <Wallet className="mb-2 h-5 w-5 text-blue-600" />
                            <div className="font-medium">Adjustment By Old Challan</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Use the unpaid balance of a challan already on record.
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("new")}
                            className="rounded-lg border p-4 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/50"
                        >
                            <FilePlus2 className="mb-2 h-5 w-5 text-blue-600" />
                            <div className="font-medium">Add New Challan</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Upload the challan receipt — we read the details off it.
                            </p>
                        </button>
                    </div>
                )}

                {mode === "old" && (
                    <div className="space-y-3">
                        <Input
                            placeholder="Search challan no, financial year…"
                            className="h-9"
                            value={challanSearch}
                            onChange={(event) => setChallanSearch(event.target.value)}
                        />
                        <div className="max-h-64 overflow-y-auto rounded-md border">
                            {challansLoading ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : payableChallans.length === 0 ? (
                                <p className="p-4 text-center text-xs text-muted-foreground">
                                    No challan has any balance left. Add a new challan instead.
                                </p>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead className="bg-muted/50 text-muted-foreground">
                                        <tr>
                                            {/* One challan per payment — a deduction is never split
                                                across two, so ticking one clears the other. */}
                                            <th className="w-8 p-2" />
                                            <th className="p-2 text-left font-medium">FY</th>
                                            <th className="p-2 text-left font-medium">Challan No</th>
                                            <th className="p-2 text-left font-medium">Deposited</th>
                                            <th className="p-2 text-right font-medium">Amount</th>
                                            <th className="p-2 text-right font-medium">Remaining</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payableChallans.map((challan) => {
                                            const enough = challan.remaining >= totalTds - TOLERANCE;
                                            return (
                                                <tr
                                                    key={challan.name}
                                                    onClick={() => enough && setSelectedChallan(challan.name)}
                                                    className={cn(
                                                        "border-t",
                                                        enough
                                                            ? "cursor-pointer hover:bg-muted/50"
                                                            : "cursor-not-allowed opacity-50",
                                                        selectedChallan === challan.name && "bg-blue-50 dark:bg-blue-950/40"
                                                    )}
                                                    title={enough ? undefined : "Not enough balance for this selection"}
                                                >
                                                    {/* stopPropagation, or the row's own onClick fires
                                                        straight after the tick and re-selects what the
                                                        checkbox just cleared. */}
                                                    <td className="p-2" onClick={(event) => event.stopPropagation()}>
                                                        <Checkbox
                                                            aria-label={`Select challan ${challan.challan_no}`}
                                                            disabled={!enough}
                                                            checked={selectedChallan === challan.name}
                                                            onCheckedChange={(value) =>
                                                                setSelectedChallan(value ? challan.name : null)
                                                            }
                                                        />
                                                    </td>
                                                    <td className="p-2">{challan.financial_year}</td>
                                                    <td className="p-2 font-medium tabular-nums">{challan.challan_no}</td>
                                                    <td className="p-2 whitespace-nowrap">
                                                        {challan.date_of_deposit ? formatDate(challan.date_of_deposit) : "--"}
                                                    </td>
                                                    <td className="p-2 text-right tabular-nums">
                                                        {formatToIndianRupee(challan.amount)}
                                                    </td>
                                                    <td className="p-2 text-right font-semibold tabular-nums">
                                                        {formatToIndianRupee(challan.remaining)}
                                                        {/* Say WHY the row is unpickable. Greying it out
                                                            alone leaves the user guessing at the gap. */}
                                                        {!enough && (
                                                            <span className="block text-[10px] font-normal text-destructive">
                                                                short {formatToIndianRupee(totalTds - challan.remaining)}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {chosenChallan && (
                            <p className="text-xs text-muted-foreground">
                                Challan {formatToIndianRupee(chosenChallan.amount)} · Paying{" "}
                                {formatToIndianRupee(totalTds)} · Left on challan{" "}
                                <span className="font-semibold">
                                    {formatToIndianRupee(chosenChallan.remaining - totalTds)}
                                </span>
                            </p>
                        )}
                    </div>
                )}

                {mode === "new" && !attachmentUrl && (
                    // ── Stage 1: the drop zone alone. No fields yet — there is nothing to fill
                    //    them from, and an empty grid of nine boxes reads as work to do. ──
                    <div className="space-y-2">
                        <div
                            role="button"
                            tabIndex={0}
                            className={cn(
                                "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors",
                                dragging
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:border-primary/50 hover:bg-muted/30",
                                isBusy && "pointer-events-none opacity-60"
                            )}
                            onClick={() => inputRef.current?.click()}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(event) => {
                                event.preventDefault();
                                setDragging(false);
                                handleFile(event.dataTransfer.files?.[0]);
                            }}
                        >
                            {isBusy ? (
                                <>
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        {uploading ? "Uploading…" : "Reading challan…"}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Upload className="h-8 w-8 text-muted-foreground" />
                                    <div className="text-center">
                                        <p className="font-medium text-foreground">Drop your challan here</p>
                                        <p className="mt-1 text-sm text-muted-foreground">or click to browse</p>
                                        <p className="mt-2 text-xs text-muted-foreground">
                                            PDF, PNG or JPG · the details are read off it
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            className="hidden"
                            onChange={(event) => handleFile(event.target.files?.[0])}
                        />
                    </div>
                )}

                {mode === "new" && !!attachmentUrl && (
                    // ── Stage 2: the receipt is attached, so the fields appear — pre-filled when
                    //    the read worked, blank (with the reason) when it did not. ──
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                            <span className="truncate text-xs text-muted-foreground">
                                {fileName || "Challan attached"}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isBusy}
                                onClick={resetUpload}
                            >
                                Replace
                            </Button>
                        </div>

                        {isReading && (
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Reading challan…
                            </p>
                        )}

                        {readWarnings.map((warning) => (
                            <p
                                key={warning}
                                className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
                            >
                                {warning}
                            </p>
                        ))}

                        <div className="grid gap-3 sm:grid-cols-3">
                            {field("financial_year", "Financial Year")}
                            {field("amount", "Amount")}
                            {field("date_of_deposit", "Date of Deposit", "date")}
                            {field("tender_date", "Tender Date", "date")}
                            <div className="space-y-1">
                                <Label className="text-xs">Mode of Payment</Label>
                                <Select
                                    value={form.mode_of_payment}
                                    onValueChange={(value) => setField("mode_of_payment", value)}
                                    disabled={isBusy}
                                >
                                    <SelectTrigger className={cn("h-9", tint("mode_of_payment"))}>
                                        <SelectValue placeholder="Select…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {MODE_OPTIONS.map((option) => (
                                            <SelectItem key={option} value={option}>
                                                {option}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {field("bank_name", "Bank Name")}
                            {field("bank_reference_number", "Bank Reference Number")}
                            {field("bsr_code", "BSR Code")}
                            {field("challan_no", "Challan No")}
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Challan {formatToIndianRupee(newAmount)} · Paying {formatToIndianRupee(totalTds)}
                            {newAmountCovers ? (
                                <>
                                    {" "}· Left on challan{" "}
                                    <span className="font-semibold">
                                        {formatToIndianRupee(newAmount - totalTds)}
                                    </span>
                                </>
                            ) : (
                                <span className="font-semibold text-destructive">
                                    {" "}· challan is smaller than the selected TDS
                                </span>
                            )}
                        </p>
                    </div>
                )}

                {error && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                        {error}
                    </p>
                )}

                <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isBusy}>
                        Cancel
                    </Button>
                    {mode === "old" && (
                        <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                            disabled={!selectedChallan || isBusy}
                            onClick={handlePayOld}
                        >
                            {payingOld && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                            Pay TDS
                        </Button>
                    )}
                    {/* Only once a receipt is attached — in stage 1 there is nothing to create, and
                        a disabled primary button under an empty drop zone is noise. */}
                    {mode === "new" && !!attachmentUrl && (
                        <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                            disabled={!newFormComplete || !newAmountCovers || isBusy}
                            onClick={handleCreateAndPay}
                        >
                            {payingNew && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                            Create Challan &amp; Pay
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default PayTdsDialog;

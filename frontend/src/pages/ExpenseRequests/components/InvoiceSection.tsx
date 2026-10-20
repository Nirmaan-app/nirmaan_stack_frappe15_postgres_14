// The invoice of an expense (spec #1494, #1502): asked once, the same way, for every type.
//
// "Do you have the invoice?" Yes: the file is uploaded as soon as it is picked, so Gemini
// (`invoice_autofill.extract_invoice_fields`) can read the invoice date and number off it. A field it
// could not read asks to be typed; an invoice total that differs from the typed amount gets a
// warning and never changes the amount. No warning blocks submit. No: the invoice is added later
// from the request's page (`AddInvoiceDialog`), until its Expense is Paid.
//
// The server stores it under the native keys of `source_data` (`flatten.native_invoice`) and
// approval copies it onto the Expense's invoice columns. Which notes show is
// `utils/newExpenseForm.invoiceNotes`.

import React, { useCallback, useRef } from "react";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { AcceptedFileType, CustomAttachment } from "@/components/helpers/CustomAttachment";
import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getFrappeError } from "@/utils/frappeErrors";
import { InvoiceFieldNote, InvoiceNotes, InvoiceRead } from "@/utils/newExpenseForm";
import { NATIVE_INVOICE_SECTION, NATIVE_INVOICE_SLOT } from "@/utils/expenseFormat";

const INVOICE_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];
// What Document AI reads. Any other accepted file is kept, and its fields are typed.
const READABLE_EXTENSIONS = ["pdf", "png", "jpg", "jpeg"];
const isReadable = (fileName: string) =>
    READABLE_EXTENSIONS.includes(fileName.split(".").pop()?.toLowerCase() || "");

/** The invoice as the dialog holds it. */
export interface InvoiceValue {
    /** The answer to "Do you have the invoice?"; "" until answered, which counts as No. */
    has: "" | "yes" | "no";
    /** The uploaded file; "" before one is picked. */
    file_url: string;
    invoice_date: string;
    invoice_ref: string;
    /** What Gemini read off the file, or null when it was not read. */
    read: InvoiceRead | null;
    /** The file is uploading or being read; submit waits for it. */
    busy: boolean;
}

export const EMPTY_INVOICE: InvoiceValue = {
    has: "", file_url: "", invoice_date: "", invoice_ref: "", read: null, busy: false,
};

/** The invoice as it reaches the server: the native keys of `source_data`, or nothing. */
export const invoiceSourceData = (value: InvoiceValue): {
    responses: Record<string, Record<string, string>>;
    attachments?: Record<string, string[]>;
} => {
    if (value.has !== "yes") return { responses: {} };
    const answers = {
        ...(value.invoice_date ? { invoice_date: value.invoice_date } : {}),
        ...(value.invoice_ref.trim() ? { invoice_ref: value.invoice_ref.trim() } : {}),
    };
    return {
        responses: Object.keys(answers).length ? { [NATIVE_INVOICE_SECTION]: answers } : {},
        ...(value.file_url ? { attachments: { [NATIVE_INVOICE_SLOT]: [value.file_url] } } : {}),
    };
};

const FieldHint: React.FC<{ note: InvoiceFieldNote }> = ({ note }) =>
    note === "read" ? (
        <span className="text-xs font-normal text-green-700">filled from the invoice</span>
    ) : note === "unread" ? (
        <span className="text-xs font-normal text-amber-700">could not be read, please type it</span>
    ) : null;

const fieldTint = (note: InvoiceFieldNote) =>
    note === "read" ? "border-green-300 bg-green-50"
        : note === "unread" ? "border-amber-400 bg-amber-50" : "";

interface FieldsProps {
    value: InvoiceValue;
    onChange: (patch: Partial<InvoiceValue>) => void;
    notes: InvoiceNotes;
    /** Where the uploaded File is filed; a request already raised passes its name. */
    docname?: string;
    onError: (title: string, message: string) => void;
    disabled?: boolean;
}

/** What `invoice_autofill.extract_invoice_fields` returns; a field it could not read is empty. */
interface ExtractedInvoice {
    invoice_no?: string | null;
    invoice_date?: string | null;
    amount?: number | string | null;
}

/** The upload, the date and number, and the notes. Also the body of Add invoice. */
export const InvoiceFields: React.FC<FieldsProps> = ({
    value, onChange, notes, docname, onError, disabled,
}) => {
    const { upload } = useFrappeFileUpload();
    const { call: extractInvoiceFields } = useFrappePostCall<{ message?: ExtractedInvoice }>(
        "nirmaan_stack.api.invoice_autofill.extract_invoice_fields"
    );
    // A newer pick, or Remove, outdates a read still in flight; its answer is then dropped.
    const session = useRef(0);

    const handlePick = useCallback(async (file: File | null) => {
        const mine = ++session.current;
        if (!file) return;
        onChange({ busy: true, read: null, file_url: "" });
        let fileUrl: string;
        try {
            const uploaded = await upload(file, {
                doctype: "Expense Request", docname, fieldname: "source_data", isPrivate: true,
            });
            fileUrl = uploaded.file_url;
        } catch (e) {
            if (mine !== session.current) return;
            onChange({ busy: false });
            onError("Could not upload the invoice", getFrappeError(e));
            return;
        }
        if (mine !== session.current) return;
        onChange({ file_url: fileUrl });
        try {
            if (!isReadable(file.name)) return;
            const res = await extractInvoiceFields({ file_url: fileUrl });
            if (mine !== session.current) return;
            const data = res?.message;
            const read: InvoiceRead = {
                invoice_no: data?.invoice_no || "",
                invoice_date: data?.invoice_date || "",
                amount: data?.amount ? String(data.amount) : "",
            };
            // The amount is NEVER filled: a differing total only warns.
            onChange({
                read,
                ...(read.invoice_date ? { invoice_date: read.invoice_date } : {}),
                ...(read.invoice_no ? { invoice_ref: read.invoice_no } : {}),
            });
        } catch {
            // The server's reason (no Gemini key, an unreadable scan) is not the raiser's to fix:
            // the fields below already ask to be typed.
            if (mine !== session.current) return;
            onError("Could not read the invoice", "Type the invoice date and number.");
        } finally {
            if (mine === session.current) onChange({ busy: false });
        }
    }, [upload, extractInvoiceFields, docname, onChange, onError]);

    const removeFile = () => {
        session.current += 1;
        onChange({ file_url: "", read: null, busy: false });
    };

    return (
        <div className="space-y-3">
            {value.file_url || value.busy ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-400 px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 truncate text-sm">
                        {value.file_url ? value.file_url.split("/").pop() : "Uploading…"}
                    </span>
                    {value.busy && value.file_url && (
                        <span className="text-xs text-muted-foreground">Reading…</span>
                    )}
                    {value.read && !value.busy && (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                            Read by Gemini
                        </span>
                    )}
                    <Button
                        type="button" variant="ghost" size="sm" className="h-7 shrink-0 text-xs"
                        onClick={removeFile} disabled={disabled}
                    >
                        Remove
                    </Button>
                </div>
            ) : (
                <CustomAttachment
                    label="Upload the invoice"
                    selectedFile={null}
                    onFileSelect={handlePick}
                    onError={({ message }) => onError("Attachment", message)}
                    maxFileSize={5 * 1024 * 1024}
                    acceptedTypes={INVOICE_ACCEPTED_TYPES}
                    disabled={disabled}
                />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label className="flex flex-wrap items-baseline gap-x-2">
                        Invoice date <FieldHint note={notes.date} />
                    </Label>
                    <Input
                        type="date"
                        value={value.invoice_date}
                        className={cn(fieldTint(notes.date))}
                        onChange={(e) => onChange({ invoice_date: e.target.value })}
                        disabled={disabled}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label className="flex flex-wrap items-baseline gap-x-2">
                        Invoice number <FieldHint note={notes.number} />
                    </Label>
                    <Input
                        value={value.invoice_ref}
                        placeholder="e.g. GN/24/118"
                        className={cn(fieldTint(notes.number))}
                        onChange={(e) => onChange({ invoice_ref: e.target.value })}
                        disabled={disabled}
                    />
                </div>
            </div>

            {notes.amountMismatch && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    The invoice says {formatToRoundedIndianRupee(notes.amountMismatch.invoice)}. You
                    typed {formatToRoundedIndianRupee(notes.amountMismatch.typed)}. Check the amount.
                    You can still submit.
                </p>
            )}
        </div>
    );
};

interface QuestionProps extends FieldsProps {}

/** "Do you have the invoice? Yes / No, I'll add it later", for the New Expense dialog. */
export const InvoiceQuestion: React.FC<QuestionProps> = (props) => {
    const { value, onChange, disabled } = props;
    return (
        <fieldset className="space-y-3 rounded-md border px-4 pb-4 pt-2">
            <legend className="px-1 text-sm font-semibold">Do you have the invoice?</legend>
            <RadioGroup
                className="flex flex-wrap gap-5"
                value={value.has}
                onValueChange={(v) => onChange({ has: v as InvoiceValue["has"] })}
                disabled={disabled}
            >
                <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="yes" /> Yes
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="no" /> No, I'll add it later
                </label>
            </RadioGroup>
            {value.has === "yes" && <InvoiceFields {...props} />}
            {value.has === "no" && (
                <p className="text-sm text-muted-foreground">
                    You can add it from the expense page until it is paid.
                </p>
            )}
        </fieldset>
    );
};

/** The line under the form when something is worth a second look. */
export const checksLine = (count: number) =>
    count === 0 ? "" : count === 1
        ? "1 thing to check. It does not stop you."
        : `${count} things to check. None of them stops you.`;

export default InvoiceQuestion;

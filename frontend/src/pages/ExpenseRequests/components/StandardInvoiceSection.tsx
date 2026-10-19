// The invoice details a request with no per-type form may carry: an "Add invoice details" tick, then
// the date, the reference and the file. The server applies the same rules (`create.guard_request_form`:
// a date whenever any detail is given, a reference whenever a file is attached), and approval copies
// them onto the Expense's invoice columns.
//
// Its own section so the New Expense dialog reads in the spec's order and the invoice question of
// spec #1494 (#1502) replaces one component.

import React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AcceptedFileType, CustomAttachment } from "@/components/helpers/CustomAttachment";

const INVOICE_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];

/** The invoice fields as the dialog holds them. */
export interface StandardInvoiceValue {
    recordInvoice: boolean;
    invoice_date: string;
    invoice_ref: string;
    /** The file already on a request being edited; kept unless replaced or removed. */
    existingInvoiceUrl: string;
}

interface Props {
    value: StandardInvoiceValue;
    onChange: <K extends keyof StandardInvoiceValue>(key: K, v: StandardInvoiceValue[K]) => void;
    /** A newly picked file, held until submit. */
    file: File | null;
    onFileSelect: (file: File | null) => void;
    onFileError: (message: string) => void;
    disabled?: boolean;
}

export const StandardInvoiceSection: React.FC<Props> = ({
    value, onChange, file, onFileSelect, onFileError, disabled,
}) => {
    const hasFile = !!file || !!value.existingInvoiceUrl;
    return (
        <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                    checked={value.recordInvoice}
                    onCheckedChange={(v) => onChange("recordInvoice", !!v)}
                    disabled={disabled}
                />
                Add invoice details
            </label>
            {value.recordInvoice && (
                <div className="ml-2 space-y-3 border-l-2 border-dashed pl-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Invoice Date <span className="text-destructive">*</span></Label>
                            <Input
                                type="date"
                                value={value.invoice_date}
                                onChange={(e) => onChange("invoice_date", e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>
                                Invoice Ref {hasFile && <span className="text-destructive">*</span>}
                            </Label>
                            <Input
                                value={value.invoice_ref}
                                onChange={(e) => onChange("invoice_ref", e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Invoice Attachment</Label>
                        {value.existingInvoiceUrl && !file ? (
                            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                                <span className="truncate text-sm">
                                    {value.existingInvoiceUrl.split("/").pop()}
                                </span>
                                <Button
                                    type="button" variant="ghost" size="sm"
                                    className="h-7 shrink-0 text-xs"
                                    onClick={() => onChange("existingInvoiceUrl", "")}
                                >
                                    Remove
                                </Button>
                            </div>
                        ) : (
                            <CustomAttachment
                                label="Upload Invoice Document"
                                selectedFile={file}
                                onFileSelect={onFileSelect}
                                onError={({ message }) => onFileError(message)}
                                maxFileSize={5 * 1024 * 1024}
                                acceptedTypes={INVOICE_ACCEPTED_TYPES}
                                disabled={disabled}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StandardInvoiceSection;

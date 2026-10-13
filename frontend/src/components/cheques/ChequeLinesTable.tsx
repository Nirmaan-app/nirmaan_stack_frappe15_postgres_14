import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import type { ChequeFormInput } from "@/utils/cheques/chequeForm";
import {
    conversionHint,
    EMPTY_PO_WO_LINE,
    hiddenPaymentsText,
    lineProjects,
    linesSummary,
    recordsInProject,
    type ChequeLineDraft,
    type VendorRecord,
} from "@/utils/cheques/chequeLines";

import { useEligiblePayments, useVendorRecords } from "./useChequePickers";

/** Radix Select reserves "" for "no value", so "No payment yet" needs its own token. */
const NO_PAYMENT = "__no_payment__";

const recordKind = (doctype: string) => (doctype === "Service Requests" ? "WO" : "PO");

/**
 * The Add Cheque dialog's lines table (spec #1407, #1410): each PO/WO line picks a project, one of
 * the Vendor's POs or Work Orders in it, then optionally one of its payments. Lines may span
 * projects. Lives inside the dialog's react-hook-form (`lines`); the server re-checks every rule.
 */
export const ChequeLinesTable = ({ vendor, disabled }: { vendor?: string; disabled?: boolean }) => {
    const { control } = useFormContext<ChequeFormInput>();
    const { fields, append, remove } = useFieldArray({ control, name: "lines" });
    const lines = (useWatch({ control, name: "lines" }) ?? []) as ChequeLineDraft[];
    const amount = useWatch({ control, name: "amount" });
    const { records, isLoading } = useVendorRecords(vendor);
    const summary = linesSummary(amount as number | string, lines);

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Lines</div>
                {summary.text && <div className="text-sm text-muted-foreground">{summary.text}</div>}
            </div>
            {summary.warning && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {summary.warning} You can still save it.
                </div>
            )}
            {fields.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-[160px]">Project</TableHead>
                                <TableHead className="min-w-[160px]">PO / WO</TableHead>
                                <TableHead className="min-w-[200px]">Payment</TableHead>
                                <TableHead className="min-w-[120px]">Amount (₹)</TableHead>
                                <TableHead className="w-10" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {fields.map((field, index) => (
                                <PoWoLineRow
                                    key={field.id}
                                    index={index}
                                    records={records}
                                    disabled={disabled}
                                    onRemove={() => remove(index)}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            <FormField control={control} name="lines" render={() => <FormItem><FormMessage /></FormItem>} />
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || !vendor || isLoading}
                onClick={() => append({ ...EMPTY_PO_WO_LINE })}
            >
                <Plus className="mr-1 h-4 w-4" />
                Add PO / WO payment line
            </Button>
            {!vendor && <p className="text-xs text-muted-foreground">Pick the Vendor to add its PO and Work Order payments.</p>}
        </div>
    );
};

interface PoWoLineRowProps {
    index: number;
    records: VendorRecord[];
    disabled?: boolean;
    onRemove: () => void;
}

const PoWoLineRow = ({ index, records, disabled, onRemove }: PoWoLineRowProps) => {
    const { control, setValue } = useFormContext<ChequeFormInput>();
    const line = useWatch({ control, name: `lines.${index}` }) as ChequeLineDraft;
    const { eligible, isLoading } = useEligiblePayments(line.record_doctype, line.record_name);
    const picked = eligible?.payments.find((p) => p.name === line.payment_name);
    const hidden = hiddenPaymentsText(eligible?.hidden);
    const inProject = recordsInProject(records, line.project);

    const set = (name: keyof ChequeLineDraft, value: string | number) =>
        setValue(`lines.${index}.${name}`, value, { shouldValidate: true, shouldDirty: true });

    return (
        <TableRow className="align-top">
            <TableCell>
                <FormField
                    control={control}
                    name={`lines.${index}.project`}
                    render={({ field }) => (
                        <FormItem>
                            <Select
                                value={field.value || undefined}
                                disabled={disabled}
                                onValueChange={(value) => {
                                    field.onChange(value);
                                    set("record_doctype", "");
                                    set("record_name", "");
                                    set("payment_name", "");
                                }}
                            >
                                <FormControl>
                                    <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {lineProjects(records).map((p) => (
                                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </TableCell>
            <TableCell>
                <FormField
                    control={control}
                    name={`lines.${index}.record_name`}
                    render={({ field }) => (
                        <FormItem>
                            <Select
                                value={field.value || undefined}
                                disabled={disabled || !line.project}
                                onValueChange={(value) => {
                                    const record = inProject.find((r) => r.name === value);
                                    field.onChange(value);
                                    set("record_doctype", record?.doctype ?? "");
                                    set("payment_name", "");
                                }}
                            >
                                <FormControl>
                                    <SelectTrigger><SelectValue placeholder="PO or WO" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {inProject.map((r) => (
                                        <SelectItem key={`${r.doctype}-${r.name}`} value={r.name}>
                                            {recordKind(r.doctype)} {r.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </TableCell>
            <TableCell>
                <Select
                    value={line.payment_name || NO_PAYMENT}
                    disabled={disabled || !line.record_name || isLoading}
                    onValueChange={(value) => {
                        const payment = eligible?.payments.find((p) => p.name === value);
                        set("payment_name", payment ? payment.name : "");
                        // Copied once, on pick; the user may still change it.
                        if (payment) set("amount", payment.amount);
                    }}
                >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NO_PAYMENT}>No payment yet</SelectItem>
                        {eligible?.payments.map((p) => (
                            <SelectItem key={p.name} value={p.name}>
                                {p.name} · {formatToIndianRupee(p.amount)} · {p.status}
                                {p.on_hold ? " · On hold" : ""}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {hidden && <p className="mt-1 text-xs text-muted-foreground">{hidden}</p>}
                {picked && (
                    <p className="mt-1 rounded bg-blue-50 px-1.5 py-1 text-xs text-blue-700">{conversionHint(picked)}</p>
                )}
            </TableCell>
            <TableCell>
                <FormField
                    control={control}
                    name={`lines.${index}.amount`}
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    disabled={disabled}
                                    {...field}
                                    value={field.value as number | string}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </TableCell>
            <TableCell>
                <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onRemove} aria-label="Remove line">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
};

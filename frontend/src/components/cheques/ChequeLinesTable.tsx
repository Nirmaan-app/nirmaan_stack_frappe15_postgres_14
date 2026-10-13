import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { AlertTriangle, ChevronDown, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import type { ChequeFormInput } from "@/utils/cheques/chequeForm";
import {
    addLineOptions,
    conversionHint,
    emptyLine,
    EXPENSE_NOTE,
    hiddenPaymentsText,
    LINE_LABELS,
    LINE_TYPE,
    lineProjects,
    linesSummary,
    recordsInProject,
    type ChequeLineDraft,
    type VendorRecord,
} from "@/utils/cheques/chequeLines";

import { ExpenseLineRow } from "./ExpenseLineRow";
import { useEligiblePayments, useVendorRecords } from "./useChequePickers";

/** Radix Select reserves "" for "no value", so "No payment yet" needs its own token. */
const NO_PAYMENT = "__no_payment__";

const recordKind = (doctype: string) => (doctype === "Service Requests" ? "WO" : "PO");

interface ChequeLinesTableProps {
    /** True when the cheque is made out to a Vendor; a typed payee takes expense lines only. */
    vendorPayee: boolean;
    vendor?: string;
    disabled?: boolean;
}

/**
 * The Add Cheque dialog's lines table (spec #1407). "Add line" asks for the kind (#1411), and each
 * line asks only for the boxes its kind needs (`LINE_NEEDS`):
 *
 * - a PO/WO line picks a project, one of the Vendor's POs or Work Orders in it, then optionally one
 *   of its payments (#1410);
 * - a Project Expense line picks a project, then one of its Project Expenses;
 * - a Non-project Expense line picks a Non Project Expense only (`ExpenseLineRow`).
 *
 * Lines may span projects. Lives inside the dialog's react-hook-form (`lines`); the server re-checks
 * every rule.
 */
export const ChequeLinesTable = ({ vendorPayee, vendor, disabled }: ChequeLinesTableProps) => {
    const { control } = useFormContext<ChequeFormInput>();
    const { fields, append, remove } = useFieldArray({ control, name: "lines" });
    const lines = (useWatch({ control, name: "lines" }) ?? []) as ChequeLineDraft[];
    const amount = useWatch({ control, name: "amount" });
    const { records } = useVendorRecords(vendorPayee ? vendor : undefined);
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
                                <TableHead className="min-w-[120px]">Type</TableHead>
                                <TableHead className="min-w-[160px]">Project</TableHead>
                                <TableHead className="min-w-[140px]">PO / WO</TableHead>
                                <TableHead className="min-w-[220px]">Payment / Expense</TableHead>
                                <TableHead className="min-w-[120px]">Amount (₹)</TableHead>
                                <TableHead className="w-10" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {fields.map((field, index) =>
                                lines[index]?.line_type === LINE_TYPE.PO_WO ? (
                                    <PoWoLineRow
                                        key={field.id}
                                        index={index}
                                        records={records}
                                        disabled={disabled}
                                        onRemove={() => remove(index)}
                                    />
                                ) : (
                                    <ExpenseLineRow key={field.id} index={index} disabled={disabled} onRemove={() => remove(index)} />
                                )
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
            <FormField control={control} name="lines" render={() => <FormItem><FormMessage /></FormItem>} />
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={disabled}>
                        <Plus className="mr-1 h-4 w-4" />
                        Add line
                        <ChevronDown className="ml-1 h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80">
                    {addLineOptions({ vendorPayee, vendor }).map((option) => (
                        <DropdownMenuItem
                            key={option.type}
                            disabled={Boolean(option.disabledReason)}
                            onSelect={() => append(emptyLine(option.type))}
                            className="flex flex-col items-start gap-0.5"
                        >
                            <span>{option.label}</span>
                            {option.disabledReason && (
                                <span className="text-xs text-muted-foreground">{option.disabledReason}</span>
                            )}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">{EXPENSE_NOTE}</p>
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
            <TableCell className="text-sm">{LINE_LABELS[line.line_type]}</TableCell>
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

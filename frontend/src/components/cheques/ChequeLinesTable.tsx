import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { AlertTriangle, ChevronDown, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import { paymentsSwitchingToOnline, switchBackHint } from "@/utils/cheques/chequeEdit";
import { linesErrorMessage, type ChequeFormInput } from "@/utils/cheques/chequeForm";
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

/** Lets a picked value's text shrink and clip inside its fixed column. */
const TRIGGER = "[&>span]:min-w-0";

const recordKind = (doctype: string) => (doctype === "Service Requests" ? "WO" : "PO");

interface ChequeLinesTableProps {
    /** True when the cheque is made out to a Vendor; a typed payee takes expense lines only. */
    vendorPayee: boolean;
    vendor?: string;
    disabled?: boolean;
    /** The Cheque being edited (#1418): the pickers keep offering its own payments and expenses. */
    cheque?: string;
    /** The payments an Issued Cheque holds as recorded (#1418): each one the lines drop goes back to Online. */
    recordedPayments?: string[];
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
export const ChequeLinesTable = ({ vendorPayee, vendor, disabled, cheque, recordedPayments = [] }: ChequeLinesTableProps) => {
    const { control, formState } = useFormContext<ChequeFormInput>();
    const { fields, append, remove } = useFieldArray({ control, name: "lines" });
    const linesError = linesErrorMessage(formState.errors.lines);
    const lines = (useWatch({ control, name: "lines" }) ?? []) as ChequeLineDraft[];
    const amount = useWatch({ control, name: "amount" });
    const { records } = useVendorRecords(vendorPayee ? vendor : undefined);
    const summary = linesSummary(amount as number | string, lines);
    const switching = paymentsSwitchingToOnline(recordedPayments, lines);

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
                // Fixed columns, so a long payment or expense label truncates in its box instead of
                // widening the table; below the min width the table scrolls here, not the dialog.
                <div className="overflow-x-auto rounded-md border">
                    <Table className="min-w-[760px] table-fixed">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[13%]">Type</TableHead>
                                <TableHead className="w-[20%]">Project</TableHead>
                                <TableHead className="w-[16%]">PO / WO</TableHead>
                                <TableHead className="w-[31%]">Payment / Expense</TableHead>
                                <TableHead className="w-[14%]">Amount (₹)</TableHead>
                                <TableHead className="w-12" />
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
                                        cheque={cheque}
                                        onRemove={() => remove(index)}
                                    />
                                ) : (
                                    <ExpenseLineRow
                                        key={field.id}
                                        index={index}
                                        disabled={disabled}
                                        cheque={cheque}
                                        onRemove={() => remove(index)}
                                    />
                                )
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
            {linesError && <p className="text-[0.8rem] font-medium text-destructive">{linesError}</p>}
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
            {switching.map((payment) => (
                <p key={payment} className="rounded bg-blue-50 px-1.5 py-1 text-xs text-blue-700">{switchBackHint(payment)}</p>
            ))}
        </div>
    );
};

interface PoWoLineRowProps {
    index: number;
    records: VendorRecord[];
    disabled?: boolean;
    cheque?: string;
    onRemove: () => void;
}

const PoWoLineRow = ({ index, records, disabled, cheque, onRemove }: PoWoLineRowProps) => {
    const { control, setValue, formState } = useFormContext<ChequeFormInput>();
    const line = useWatch({ control, name: `lines.${index}` }) as ChequeLineDraft;
    const { eligible, isLoading } = useEligiblePayments(line.record_doctype, line.record_name, cheque);
    const picked = eligible?.payments.find((p) => p.name === line.payment_name);
    const hidden = hiddenPaymentsText(eligible?.hidden);
    // An edited line keeps its project and record in the list, even one the pickers no longer offer.
    const projects = withCurrent(lineProjects(records), line.project);
    const inProject = recordsInProject(records, line.project);
    const recordOptions = withCurrent(
        inProject.map((r) => ({ value: r.name, label: `${recordKind(r.doctype)} ${r.name}` })),
        line.record_name,
        line.record_doctype && `${recordKind(line.record_doctype)} ${line.record_name}`,
    );

    // Validated only once the form was submitted, as the boxes' own changes are: a box cleared before
    // then must not show an error that its later pick (unvalidated until submit) would leave stale.
    const set = (name: keyof ChequeLineDraft, value: string | number) =>
        setValue(`lines.${index}.${name}`, value, { shouldValidate: formState.isSubmitted, shouldDirty: true });

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
                                    <SelectTrigger className={TRIGGER}><SelectValue placeholder="Project" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {projects.map((p) => (
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
                                    <SelectTrigger className={TRIGGER}><SelectValue placeholder="PO or WO" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {recordOptions.map((r) => (
                                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
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
                    <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
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
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={onRemove}
                    aria-label="Remove line"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
};

/** `options` with the current `value` added when it is missing from them. */
const withCurrent = (options: { value: string; label: string }[], value: string, label?: string) =>
    !value || options.some((o) => o.value === value) ? options : [...options, { value, label: label || value }];

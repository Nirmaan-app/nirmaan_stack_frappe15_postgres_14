import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatToIndianRupee from "@/utils/FormatPrice";
import { paymentsSwitchingToOnline, switchBackHint } from "@/utils/cheques/chequeEdit";
import { linesErrorMessage, type ChequeFormInput } from "@/utils/cheques/chequeForm";
import {
    conversionHint,
    emptyLine,
    hiddenPaymentsText,
    isPoLine,
    lineProjects,
    linesSummary,
    otherLinePayments,
    PO_DOCTYPE,
    recordsInProject,
    type ChequeLineDraft,
    type VendorRecord,
} from "@/utils/cheques/chequeLines";

import { RecordedLineRow } from "./RecordedLineRow";
import { useEligiblePayments, useVendorRecords } from "./useChequePickers";
import { useLineSetter } from "./useLineSetter";

/** Radix Select reserves "" for "no value", so "No payment yet" needs its own token. */
const NO_PAYMENT = "__no_payment__";

/** Lets a picked value's text shrink and clip inside its fixed column. */
const TRIGGER_CLIP_CLASS = "[&>span]:min-w-0";

interface ChequeLinesTableProps {
    vendor?: string;
    vendorName?: string;
    disabled?: boolean;
    /** The Cheque being edited (#1418): the picker keeps offering its own payments. */
    cheque?: string;
    /** The payments a Pending Cheque holds as recorded (#1418): each one the lines drop goes back to Online. */
    recordedPayments?: string[];
}

/**
 * The PO payments a Payment cheque pays (#1410; #1482, spec #1477). Each line picks a project, one of the
 * Vendor's POs in it, then one of its payments or "No payment yet" with a typed amount. Lines may span POs
 * and projects. The payment picker offers only payments at the step of the cheque's other payments, and
 * says what it hid. A Work Order or expense line recorded before shows as it is (`RecordedLineRow`).
 *
 * Lives inside the dialog's react-hook-form (`lines`); the server re-checks every rule.
 */
export const ChequeLinesTable = ({ vendor, vendorName, disabled, cheque, recordedPayments = [] }: ChequeLinesTableProps) => {
    const { control, formState } = useFormContext<ChequeFormInput>();
    const { fields, append, remove } = useFieldArray({ control, name: "lines" });
    const linesError = linesErrorMessage(formState.errors.lines);
    const lines = (useWatch({ control, name: "lines" }) ?? []) as ChequeLineDraft[];
    const amount = useWatch({ control, name: "amount" });
    const { records } = useVendorRecords(vendor);
    const summary = linesSummary(amount as number | string, lines);
    const switching = paymentsSwitchingToOnline(recordedPayments, lines);

    return (
        <section aria-label="PO payments this cheque pays" className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">PO payments this cheque pays</h3>
                {summary.text && <div className="text-sm text-muted-foreground">{summary.text}</div>}
            </div>
            {summary.warning && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {summary.warning} You can still save it.
                </div>
            )}
            {fields.length > 0 && (
                // Fixed columns, so a long payment label truncates in its box instead of widening the
                // table; below the min width the table scrolls here, not the dialog.
                <div className="overflow-x-auto">
                    <Table className="min-w-[720px] table-fixed">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[22%]">Project</TableHead>
                                <TableHead className="w-[24%]">PO</TableHead>
                                <TableHead className="w-[34%]">Payment</TableHead>
                                <TableHead className="w-[14%]">Amount (₹)</TableHead>
                                <TableHead className="w-12" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {fields.map((field, index) =>
                                lines[index] && isPoLine(lines[index]) ? (
                                    <PoLineRow
                                        key={field.id}
                                        index={index}
                                        records={records}
                                        disabled={disabled}
                                        cheque={cheque}
                                        otherPayments={otherLinePayments(lines, index)}
                                        onRemove={() => remove(index)}
                                    />
                                ) : (
                                    <RecordedLineRow key={field.id} index={index} disabled={disabled} onRemove={() => remove(index)} />
                                )
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
            {/* Not in a FormField: its error lookup on `lines` reads a `lines.root` error as "undefined". */}
            {linesError && (
                <FormItem>
                    <FormMessage>{linesError}</FormMessage>
                </FormItem>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={disabled || !vendor} onClick={() => append(emptyLine())}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add PO payment
                </Button>
                <span className="text-xs text-muted-foreground">
                    {vendor
                        ? `Only POs of ${vendorName || vendor}. Work Order payments and expenses can't go on a cheque.`
                        : "Pick the Vendor first: its POs are offered."}
                </span>
            </div>
            {switching.map((payment) => (
                <p key={payment} className="rounded bg-blue-50 px-1.5 py-1 text-xs text-blue-700">{switchBackHint(payment)}</p>
            ))}
        </section>
    );
};

interface PoLineRowProps {
    index: number;
    records: VendorRecord[];
    disabled?: boolean;
    cheque?: string;
    otherPayments: string[];
    onRemove: () => void;
}

const PoLineRow = ({ index, records, disabled, cheque, otherPayments, onRemove }: PoLineRowProps) => {
    const { control } = useFormContext<ChequeFormInput>();
    const line = useWatch({ control, name: `lines.${index}` }) as ChequeLineDraft;
    const { eligible, isLoading } = useEligiblePayments(line.record_name, cheque, otherPayments);
    const picked = eligible?.payments.find((p) => p.name === line.payment_name);
    const hidden = hiddenPaymentsText(eligible?.hidden, eligible?.step);
    // An edited line keeps its project, PO and payment in the lists, even ones the pickers no longer offer.
    const projects = withCurrent(lineProjects(records), line.project);
    const inProject = recordsInProject(records, line.project);
    const recordOptions = withCurrent(inProject.map((r) => ({ value: r.name, label: r.name })), line.record_name);
    const paymentOptions = withCurrent(
        (eligible?.payments ?? []).map((p) => ({ value: p.name, label: `${p.name} · ${formatToIndianRupee(p.amount)} · ${p.status}` })),
        line.payment_name,
        line.payment_name && `${line.payment_name}${line.payment_status ? ` · ${line.payment_status}` : ""}`,
    );
    const set = useLineSetter(index);

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
                                    set("payment_status", "");
                                }}
                            >
                                <FormControl>
                                    <SelectTrigger className={TRIGGER_CLIP_CLASS} aria-label={`Line ${index + 1} project`}>
                                        <SelectValue placeholder="Project" />
                                    </SelectTrigger>
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
                                    field.onChange(value);
                                    set("record_doctype", PO_DOCTYPE);
                                    set("payment_name", "");
                                    set("payment_status", "");
                                }}
                            >
                                <FormControl>
                                    <SelectTrigger className={TRIGGER_CLIP_CLASS} aria-label={`Line ${index + 1} PO`}>
                                        <SelectValue placeholder="PO" />
                                    </SelectTrigger>
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
                        set("payment_status", payment ? payment.status : "");
                        // Copied once, on pick; the user may still change it.
                        if (payment) set("amount", payment.amount);
                    }}
                >
                    <SelectTrigger className={TRIGGER_CLIP_CLASS} aria-label={`Line ${index + 1} payment`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NO_PAYMENT}>
                            No payment yet <span className="text-xs text-muted-foreground">: type the amount; pick the payment later</span>
                        </SelectItem>
                        {paymentOptions.map((p) => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
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
                                    aria-label={`Line ${index + 1} amount`}
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
                    aria-label={`Remove line ${index + 1}`}
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

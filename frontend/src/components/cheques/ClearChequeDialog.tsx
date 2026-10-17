import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall, useSWRConfig } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { chequeDateText } from "@/utils/cheques/chequeChip";
import {
    bulkClearText,
    CHEQUE_BANK_LINES_API,
    CLEAR_CHEQUE_API,
    CLEAR_CHEQUES_API,
    clearanceDateOf,
    clearanceDateProblem,
    offersBankLines,
    todayISO,
    type ChequeBankLine,
    type ChequesClearedResult,
} from "@/utils/cheques/chequeStatus";
import { getFrappeError } from "@/utils/frappeErrors";

import { chequeDetailKey } from "./useChequeDetail";

/** What the dialog needs of each cheque it clears. */
export interface ClearTarget {
    name: string;
    cheque_no: string;
    bank: string;
    old_type?: 0 | 1 | null;
    issue_date?: string | null;
}

interface ClearChequeDialogProps {
    /** One cheque (a row or the detail view), or several (the bulk bar). */
    cheques: ClearTarget[];
    onClose: () => void;
    /** Called after a clear was written. */
    onDone: () => void;
}

const NO_LINE = "__none__";

/**
 * Clear by hand (#1484, spec #1477): every payment on the cheque becomes Paid, with the clearance date as its
 * payment date. One cheque may link an imported bank line that carries its number and amount and that nobody has
 * matched yet; picking one sets the date to the day the bank paid it. Several cheques are cleared on one date, and
 * the preview (the same clear, rolled back) says which will be skipped and why.
 *
 * Mount it only while open, keyed on the selection.
 */
export const ClearChequeDialog = ({ cheques, onClose, onDone }: ClearChequeDialogProps) => {
    const single = cheques.length === 1 ? cheques[0] : null;
    const today = todayISO();
    const [date, setDate] = useState(today);
    const [line, setLine] = useState(NO_LINE);
    const [note, setNote] = useState("");
    const { mutate } = useSWRConfig();

    const lookForLines = !!single && offersBankLines(single);
    const { data: linesData, isLoading: linesLoading } = useFrappeGetCall<{ message: ChequeBankLine[] }>(
        CHEQUE_BANK_LINES_API,
        { cheque: single?.name },
        lookForLines ? `cheque-bank-lines-${single?.name}` : null,
        { revalidateOnFocus: false },
    );
    const lines = linesData?.message ?? [];

    const { call: callPreview } = useFrappePostCall<{ message: ChequesClearedResult }>(CLEAR_CHEQUES_API);
    const { call: clearMany, loading: clearingMany } = useFrappePostCall<{ message: ChequesClearedResult }>(CLEAR_CHEQUES_API);
    const { call: clearOne, loading: clearingOne } = useFrappePostCall(CLEAR_CHEQUE_API);

    const names = cheques.map((c) => c.name);
    const problem = clearanceDateProblem(date, single?.issue_date, today);
    const { data: preview, isValidating: previewing } = useSWR(
        !single && !problem ? ["cheque-clear-preview", names.join("|"), date] : null,
        async () => (await callPreview({ cheques: JSON.stringify(names), clearance_date: date, dry_run: true })).message,
        {
            revalidateOnFocus: false,
            onError: (e) => toast({ title: "Could not check the cheques", description: getFrappeError(e), variant: "destructive" }),
        },
    );
    const clearable = single ? 1 : (preview?.changed.length ?? 0);
    const saving = clearingOne || clearingMany;

    const pickLine = (value: string) => {
        setLine(value);
        const picked = lines.find((l) => l.name === value);
        const day = picked && clearanceDateOf(picked);
        if (day) setDate(day);
    };

    const submit = async () => {
        try {
            if (single) {
                await clearOne({
                    cheque: single.name,
                    clearance_date: date,
                    bank_line: line === NO_LINE ? undefined : line,
                    note: note.trim() || undefined,
                });
                toast({ title: `Cheque ${single.cheque_no} cleared`, description: "Its payments are Paid.", variant: "success" });
            } else {
                const r = await clearMany({ cheques: JSON.stringify(names), clearance_date: date });
                toast({
                    title: "Cheques cleared",
                    description: bulkClearText(r.message),
                    variant: r.message.skipped.length ? "default" : "success",
                });
            }
            names.forEach((name) => mutate(chequeDetailKey(name)));
            onDone();
            onClose();
        } catch (e) {
            toast({ title: "Not cleared", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{single ? `Clear cheque ${single.cheque_no}` : `Clear ${cheques.length} cheques`}</DialogTitle>
                    <DialogDescription>
                        Every payment on {single ? "the cheque" : "each cheque"} becomes Paid, with the clearance date as
                        its payment date. This cannot be undone by hand.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {lookForLines && (
                        <div className="space-y-1.5">
                            <Label>Bank statement line</Label>
                            {linesLoading ? (
                                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Looking for imported lines…
                                </p>
                            ) : lines.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No imported, unmatched line carries this cheque's number and amount.
                                </p>
                            ) : (
                                <RadioGroup value={line} onValueChange={pickLine} className="gap-1.5">
                                    <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                                        <RadioGroupItem value={NO_LINE} /> Clear without a bank line
                                    </label>
                                    {lines.map((l) => (
                                        <label key={l.name} className="flex items-start gap-2 rounded border px-3 py-2 text-sm">
                                            <RadioGroupItem value={l.name} className="mt-0.5" />
                                            <span className="min-w-0">
                                                <span className="font-medium">
                                                    {chequeDateText(l.added_on)} · {formatToIndianRupeeOrZero(l.amount)}
                                                </span>
                                                <span className="block truncate text-xs text-muted-foreground">
                                                    Cheque no. {l.reference_id} · {l.remarks || l.name}
                                                </span>
                                            </span>
                                        </label>
                                    ))}
                                </RadioGroup>
                            )}
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label htmlFor="clearance-date">
                            Clearance date <span className="text-destructive">*</span>
                        </Label>
                        <Input id="clearance-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
                        {problem && <p className="text-sm text-destructive">{problem}</p>}
                    </div>

                    {single && (
                        <div className="space-y-1.5">
                            <Label htmlFor="clear-note">
                                Note <span className="text-muted-foreground">(optional)</span>
                            </Label>
                            <Textarea id="clear-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                        </div>
                    )}

                    {!single && previewing && (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                        </p>
                    )}
                    {!single && preview && (
                        <p className="text-sm">
                            {preview.changed.length} will be cleared
                            {preview.skipped.length > 0 && `, ${preview.skipped.length} will be skipped`}.
                        </p>
                    )}
                    {!single && preview && preview.skipped.length > 0 && (
                        <ul className="space-y-1 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {preview.skipped.map((s) => (
                                <li key={s.cheque}>
                                    {s.cheque_no || s.cheque}: {s.reason}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Close
                    </Button>
                    <Button onClick={submit} disabled={saving || !!problem || (!single && (previewing || clearable === 0))}>
                        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                        {single ? "Clear cheque" : `Clear ${clearable}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

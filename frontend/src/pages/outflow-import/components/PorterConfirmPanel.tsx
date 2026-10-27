// src/pages/outflow-import/components/PorterConfirmPanel.tsx

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import formatToIndianRupee from "@/utils/FormatPrice";

import { describeFrappeError } from "../outflowTableModel";
import { usePorterPlacement } from "../hooks/usePorterPlacement";
import {
    automaticLines,
    confirmSummary,
    needsPerson,
    placedOn,
    type PorterReviewLine,
} from "../porterReview";
import { NON_PROJECT, PorterProjectSelect, projectOptions, type ProjectOption } from "./PorterProjectSelect";
import { orders } from "../porterWords";

/**
 * Confirm & create (#1564): a pause before Create writes anything. What Create would write, per project and
 * for Not a project, with the total; the orders placed automatically folded into a closed accordion, where
 * one can still be changed through the same placement call Choose projects uses. Create itself is the
 * dialog's footer button.
 */
export const PorterConfirmPanel = ({
    batch,
    onPlaced,
}: {
    batch: string;
    /** A placement was saved: the dialog re-reads the import's status (the bar, and Create's gate). */
    onPlaced?: () => void;
}) => {
    // ⚠️ THE SAME CACHE AS `PorterReviewPanel` (`usePorterPlacement`): the choices made one screen back are here.
    const { review, error, place, saving, saveError } = usePorterPlacement(batch, onPlaced);

    const lines = useMemo(() => review?.lines ?? [], [review]);
    const options = useMemo(
        () => projectOptions(review?.projects ?? []).filter((option) => option !== NON_PROJECT),
        [review],
    );

    // A changed order is no longer automatic, but it stays in the accordion (and in its count) so it does
    // not vanish from under the reader's cursor: the accordion lists every order automatic since arrival.
    // Kept in state, widened while rendering when a new automatic order arrives (no ref written in a memo).
    const automatic = useMemo(() => automaticLines(lines).map((line) => line.name), [lines]);
    const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
    if (automatic.some((name) => !shown.has(name))) setShown(new Set([...shown, ...automatic]));
    const listed = useMemo(() => lines.filter((line) => shown.has(line.name) && line.editable), [lines, shown]);

    const handlePlace = useCallback(
        async (line: PorterReviewLine, project: string) => {
            await place(line.name, [line.name], project);
        },
        [place],
    );

    if (error) {
        return (
            <p className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
                {describeFrappeError(error, "Could not load the orders.")}
            </p>
        );
    }
    if (!review) {
        return (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the orders…
            </p>
        );
    }

    const { rows, total } = confirmSummary(lines);
    const left = lines.filter(needsPerson).length;
    return (
        <section className="space-y-3" data-testid="porter-confirm">
            <h3 className="text-sm font-semibold">
                Create {total.orders} {total.orders === 1 ? "expense" : "expenses"}?
            </h3>
            <table className="w-full text-sm tabular-nums">
                <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                        <th className="py-1.5 pr-2 text-left font-medium">Where</th>
                        <th className="px-2 py-1.5 text-right font-medium">Orders</th>
                        <th className="py-1.5 pl-2 text-right font-medium">Fare</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.key || "not-a-project"} className="border-b">
                            <td className="py-1.5 pr-2">{row.label}</td>
                            <td className="px-2 py-1.5 text-right">{row.orders}</td>
                            <td className="py-1.5 pl-2 text-right">{formatToIndianRupee(row.fare)}</td>
                        </tr>
                    ))}
                    <tr className="font-semibold">
                        <td className="py-1.5 pr-2">Total</td>
                        <td className="px-2 py-1.5 text-right">{total.orders}</td>
                        <td className="py-1.5 pl-2 text-right">{formatToIndianRupee(total.fare)}</td>
                    </tr>
                </tbody>
            </table>

            {saveError && (
                <p className="flex items-start gap-2 rounded-md bg-destructive/5 p-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {saveError}
                </p>
            )}
            {/* Changing one order of a remark group splits the group, so the server asks a person about the
                rest (`porter_state.placement_kinds`) and refuses Create until then. */}
            {left > 0 && (
                <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {orders(left)} now {left === 1 ? "needs" : "need"} a project. Go Back to choose.
                </p>
            )}

            {listed.length > 0 && (
                <Accordion type="single" collapsible className="rounded-md border px-3">
                    <AccordionItem value="automatic" className="border-b-0">
                        <AccordionTrigger className="py-2.5 text-sm">
                            {orders(listed.length)} placed automatically
                        </AccordionTrigger>
                        <AccordionContent>
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b text-muted-foreground">
                                        <th className="py-1 pr-2 text-left font-medium">Order</th>
                                        <th className="px-2 py-1 text-left font-medium">Remark</th>
                                        <th className="px-2 py-1 text-left font-medium">Placed on</th>
                                        <th className="py-1 pl-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {listed.map((line) => (
                                        <AutomaticRow
                                            key={line.name}
                                            line={line}
                                            options={options}
                                            saving={saving === line.name}
                                            onPlace={handlePlace}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            )}

            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                Each order becomes a <b>Paid</b> expense with its Porter invoice. After this, the import can't be
                discarded. A wrong project can still be fixed with “Move to another project”.
            </p>
        </section>
    );
};

/** One order placed automatically: where it is, and a Change that opens the picker in place. */
const AutomaticRow = ({
    line,
    options,
    saving,
    onPlace,
}: {
    line: PorterReviewLine;
    options: ProjectOption[];
    saving: boolean;
    onPlace: (line: PorterReviewLine, project: string) => Promise<void>;
}) => {
    const [changing, setChanging] = useState(false);
    const choose = async (project: string) => {
        await onPlace(line, project);
        setChanging(false);
    };
    return (
        <>
            <tr className="border-b align-top">
                <td className="py-1.5 pr-2 font-medium">{line.crn}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{line.remarks || "—"}</td>
                <td className="px-2 py-1.5">{placedOn(line)}</td>
                <td className="py-1 pl-2 text-right">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        aria-expanded={changing}
                        disabled={saving}
                        onClick={() => setChanging((open) => !open)}
                    >
                        {changing ? "Cancel" : "Change"}
                    </Button>
                </td>
            </tr>
            {changing && (
                <tr className="border-b">
                    <td colSpan={4} className="py-2">
                        <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <PorterProjectSelect
                                    options={options}
                                    value={null}
                                    onChange={(option) => option && void choose(option.value)}
                                    placeholder="Choose a project…"
                                    isDisabled={saving}
                                />
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={saving}
                                onClick={() => void choose("")}
                            >
                                Not a project
                            </Button>
                            {saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};

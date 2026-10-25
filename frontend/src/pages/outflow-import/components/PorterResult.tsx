// src/pages/outflow-import/components/PorterResult.tsx

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";

import { usePorterPlacement } from "../hooks/usePorterPlacement";
import { canUndoOutflow } from "../outflowImportStatus";
import { describeFrappeError } from "../outflowTableModel";
import type { PorterStatus } from "../porterImport";
import { porterResult, type FailedRow } from "../porterResult";
import { PorterProjectSelect, projectOptions } from "./PorterProjectSelect";

/**
 * The result of Create (#1561): each order it could not create, named with the reason it stored and the fix
 * on the same row -- "Choose project" places that order again (Review's own placement call), "Try again"
 * runs Create for what is left -- or "All N expenses created."; then the links to the created Expenses (in
 * the Expense lists) and to Move. Renders nothing before Create has run, or while its job runs.
 */
export const PorterResult = ({
    status,
    onCreate,
    creating,
    onPlaced,
    onOpenLines,
}: {
    status: PorterStatus;
    /** Run Create again for every order it still owes. */
    onCreate: () => void;
    creating: boolean;
    /** A failed order was placed again: the dialog re-reads the import, so its fix turns to Try again. */
    onPlaced: () => void;
    /** Close the dialog on Bulk Import pinned to this import's created lines (the Settled tab): Move. */
    onOpenLines: () => void;
}) => {
    const { role, user_id } = useUserData();
    const result = porterResult(status, { canMove: canUndoOutflow(role, user_id) });
    /** The failed order whose project picker is open. */
    const [placing, setPlacing] = useState<string | null>(null);

    if (!result) return null;
    const allCreated = result.failed.length === 0;
    return (
        <section className="space-y-3">
            {result.heading && (
                <h3
                    className={`flex items-center gap-2 text-sm font-semibold ${allCreated ? "text-emerald-700" : "text-destructive"}`}
                >
                    {allCreated ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    {result.heading}
                </h3>
            )}
            {result.failed.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-xs text-muted-foreground">
                                <th className="py-1.5 pr-3 font-medium">Order</th>
                                <th className="py-1.5 pr-3 font-medium">Why</th>
                                <th className="py-1.5" />
                            </tr>
                        </thead>
                        <tbody>
                            {result.failed.map((row) => (
                                <FailedOrder
                                    key={row.name}
                                    row={row}
                                    batch={status.batch}
                                    open={placing === row.name}
                                    onOpen={() => setPlacing(placing === row.name ? null : row.name)}
                                    onPlaced={() => {
                                        setPlacing(null);
                                        onPlaced();
                                    }}
                                    onCreate={onCreate}
                                    creating={creating}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {/* The created Expenses open in their own lists, filtered to this import's orders; Move opens the
                import's created lines in Bulk Import, where each line carries Move. */}
            {(result.expenseLinks.length > 0 || result.moveLabel) && (
                <div className="flex flex-wrap gap-2">
                    {result.expenseLinks.map((link) => (
                        <Button key={link.to} variant="outline" size="sm" asChild>
                            <Link to={link.to}>{link.label}</Link>
                        </Button>
                    ))}
                    {result.moveLabel && (
                        <Button variant="outline" size="sm" onClick={onOpenLines}>
                            {result.moveLabel}
                        </Button>
                    )}
                </div>
            )}
        </section>
    );
};

const FailedOrder = ({
    row,
    batch,
    open,
    onOpen,
    onPlaced,
    onCreate,
    creating,
}: {
    row: FailedRow;
    batch: string;
    open: boolean;
    onOpen: () => void;
    onPlaced: () => void;
    onCreate: () => void;
    creating: boolean;
}) => (
    <>
        <tr className={open ? "" : "border-b"}>
            <td className="whitespace-nowrap py-2 pr-3 align-top font-medium">{row.crn}</td>
            <td className="py-2 pr-3 align-top text-muted-foreground">{row.why}</td>
            <td className="whitespace-nowrap py-2 text-right align-top">
                {row.fix === "re-place" ? (
                    <Button size="sm" variant="outline" onClick={onOpen} aria-expanded={open}>
                        {row.action}
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" onClick={onCreate} disabled={creating}>
                        {creating ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {row.action}
                    </Button>
                )}
            </td>
        </tr>
        {open && (
            <tr className="border-b">
                <td colSpan={3} className="pb-3">
                    <PlaceAgain line={row.name} batch={batch} onPlaced={onPlaced} />
                </td>
            </tr>
        )}
    </>
);

/** The project picker for one failed order: saved through Review's placement call, as soon as it is chosen. */
const PlaceAgain = ({ line, batch, onPlaced }: { line: string; batch: string; onPlaced: () => void }) => {
    // Review's own fetch and placement call: the projects come with it, and the review panel sees the placement.
    const { review, error, place, saving, saveError } = usePorterPlacement(batch, onPlaced);
    const options = useMemo(() => projectOptions(review?.projects ?? []), [review]);
    const handleChoose = useCallback((project: string) => void place(line, [line], project), [place, line]);

    if (error) {
        return <p className="text-xs text-destructive">{describeFrappeError(error, "Could not load the projects.")}</p>;
    }
    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <PorterProjectSelect
                        options={options}
                        value={null}
                        onChange={(option) => option && handleChoose(option.value)}
                        placeholder={review ? "Choose a Won project…" : "Loading the projects…"}
                        isDisabled={!review || saving !== null}
                    />
                </div>
                {saving !== null && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground">Only Won projects can take expenses. Then press Try again.</p>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>
    );
};

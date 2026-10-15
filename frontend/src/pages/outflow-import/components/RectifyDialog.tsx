// src/pages/outflow-import/components/RectifyDialog.tsx
//
// Rectify created Porter orders (#1449, ADR-0032): move each one's Expense to a chosen Won project, or to
// Non-Project, with a typed reason. One line (the Outcome cell's button) or several ticked together (the
// toolbar's "Rectify N"); the same dialog either way. Wording and offers: `porterRectify.ts`.

import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import type { StylesConfig } from "react-select";
import { ArrowRightLeft, Ban, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { FuzzySearchSelect, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { describeFrappeError } from "../outflowTableModel";
import {
    RECTIFY_METHOD,
    RECTIFY_PLAN_METHOD,
    linesToMove,
    placementText,
    rectifyOutcome,
    staysNote,
    type RectifyOutcome,
    type RectifyPlan,
    type RectifyResult,
} from "../porterRectify";

interface ProjectOption {
    value: string;
    label: string;
}

/** The choice that moves the orders off every project: they become Non-Project Expenses. */
const NON_PROJECT: ProjectOption = { value: "", label: "No project (Non-Project expense)" };

const SEARCH: TokenSearchConfig = {
    searchFields: ["label", "value"],
    partialMatch: true,
    fieldWeights: { label: 2.0, value: 1.5 },
};

/**
 * ⚠️ THE MENU IS PORTALED OUT OF THE DIALOG, AND A MODAL DIALOG SETS `pointer-events: none` ON THE BODY: without
 * `pointerEvents: "auto"` a click on an option falls through (found on the walk: it picked the wrong project).
 * The `RequestTdsItemDialog` pattern.
 */
const PORTAL_STYLES: StylesConfig<ProjectOption, false> = {
    menuPortal: (base) => ({ ...base, zIndex: 9999, pointerEvents: "auto" }),
};

/** Counts openings; each one keys its own plan fetch, so a re-opened dialog never paints a stale plan. */
let openings = 0;

/**
 * ⚠️ RENDER IT ONLY FOR THE UNDO ROLES (`canUndoOutflow`): both endpoints refuse a plain Accountant.
 *
 * `onDone` runs when the result box closes after a run, so the page can refresh what moved.
 */
export const RectifyDialog = ({
    rows,
    onClose,
    onDone,
}: {
    rows: string[] | null;
    onClose: () => void;
    onDone: () => Promise<void> | void;
}) => {
    const [outcome, setOutcome] = useState<RectifyOutcome | null>(null);
    const close = async () => {
        const ran = Boolean(outcome);
        setOutcome(null);
        if (ran) await onDone();
        else onClose();
    };
    return (
        <Dialog open={Boolean(rows)} onOpenChange={(open) => !open && close()}>
            <DialogContent className="max-h-[85vh] w-[min(92vw,760px)] overflow-y-auto sm:max-w-none">
                {rows && (
                    <>
                        <DialogHeader>
                            <DialogTitle>
                                {rows.length === 1 ? "Rectify this Porter order" : `Rectify ${rows.length} Porter orders`}
                            </DialogTitle>
                            <DialogDescription>
                                Each expense is replaced by one identical in amount, date, reference and invoice,
                                on the project you choose. Its old placement is kept as reversed, with your reason.
                            </DialogDescription>
                        </DialogHeader>
                        {outcome ? (
                            <OutcomeBox outcome={outcome} onClose={close} />
                        ) : (
                            <RectifyForm rows={rows} onCancel={onClose} onRan={setOutcome} />
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

const RectifyForm = ({
    rows,
    onCancel,
    onRan,
}: {
    rows: string[];
    onCancel: () => void;
    onRan: (outcome: RectifyOutcome) => void;
}) => {
    const [opening] = useState(() => ++openings);
    const { data, isLoading, error: planError } = useFrappeGetCall<{ message: RectifyPlan }>(
        RECTIFY_PLAN_METHOD,
        { rows: JSON.stringify(rows) },
        `porter-rectify-plan-${opening}`,
    );
    const { call } = useFrappePostCall<{ message: RectifyResult }>(RECTIFY_METHOD);
    const [target, setTarget] = useState<ProjectOption | null>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const plan = data?.message;

    const options = useMemo<ProjectOption[]>(
        () => [
            NON_PROJECT,
            ...(plan?.projects ?? []).map((project) => ({ value: project.name, label: project.project_name })),
        ],
        [plan],
    );

    if (isLoading) {
        return <p className="rounded-md border px-3 py-2.5 text-sm text-muted-foreground">Loading the orders…</p>;
    }
    if (planError || !plan) {
        return (
            <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                Could not load the orders ({describeFrappeError(planError, "couldn't load")}).
            </p>
        );
    }

    const trimmed = reason.trim();
    const moving = target ? linesToMove(plan.lines, target.value) : [];
    const blocked = !target
        ? "Choose where the orders go."
        : !moving.length
          ? "Nothing here would move."
          : !trimmed
            ? "Type a reason first."
            : null;

    const run = async () => {
        if (!target) return;
        setBusy(true);
        setError(null);
        try {
            const response = await call({
                rows: JSON.stringify(moving.map((line) => line.row)),
                project: target.value,
                reason: trimmed,
            });
            onRan(rectifyOutcome(response.message, target.value ? target.label : null));
        } catch (err) {
            setError(describeFrappeError(err, "Nothing was moved."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <ul className="overflow-hidden rounded-md border">
                {plan.lines.map((line) => {
                    const stays = target ? staysNote(line, target.value) : line.refusal;
                    return (
                        <li key={line.row} className={`space-y-0.5 border-t px-3 py-2 first:border-t-0 ${stays ? "bg-muted/30" : ""}`}>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                                <span className="font-mono text-xs">{line.crn ?? line.row}</span>
                                {line.booked_by && <span>{line.booked_by}</span>}
                                {line.amount !== undefined && (
                                    <span className="tabular-nums">{formatToRoundedIndianRupee(line.amount)}</span>
                                )}
                                {line.ledger && (
                                    <span className="text-xs text-muted-foreground">
                                        Now: {placementText(line)} <span className="font-mono">({line.expense})</span>
                                    </span>
                                )}
                            </div>
                            {line.description_edited && (
                                <p className="text-xs text-muted-foreground">
                                    Its description was edited by hand, so it is kept as it is.
                                </p>
                            )}
                            {stays && (
                                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                    <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    {stays}
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>

            <div className="space-y-1.5">
                <Label className="text-xs">Move to</Label>
                <FuzzySearchSelect<ProjectOption, false>
                    allOptions={options}
                    tokenSearchConfig={SEARCH}
                    value={target}
                    onChange={(option) => setTarget(option ?? null)}
                    placeholder="Choose a Won project, or No project…"
                    isDisabled={busy}
                    menuPortalTarget={document.body}
                    menuPosition="fixed"
                    styles={PORTAL_STYLES}
                />
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="porter-rectify-reason" className="text-xs">
                    Reason (required)
                </Label>
                <Input
                    id="porter-rectify-reason"
                    value={reason}
                    placeholder="Why does it belong there?"
                    disabled={busy}
                    onChange={(e) => {
                        setReason(e.target.value);
                        setError(null);
                    }}
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
                {blocked && <span className="mr-auto text-xs text-muted-foreground">{blocked}</span>}
                <Button variant="outline" disabled={busy} onClick={onCancel}>
                    Cancel
                </Button>
                <Button disabled={Boolean(blocked) || busy} onClick={run}>
                    {busy ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                        <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                    )}
                    {moving.length > 1 ? `Rectify ${moving.length} orders` : "Rectify"}
                </Button>
            </div>
        </div>
    );
};

const OutcomeBox = ({ outcome, onClose }: { outcome: RectifyOutcome; onClose: () => void }) => (
    <div className="space-y-3">
        <div
            className={`rounded-md border px-3 py-2.5 text-sm ${
                outcome.moved ? "border-green-600/30 bg-green-50 text-green-900" : "bg-muted/40 text-foreground"
            }`}
        >
            <p className="font-medium">{outcome.title}</p>
            {outcome.notes.map((note) => (
                <p key={note} className="text-xs">
                    {note}
                </p>
            ))}
        </div>
        {outcome.failed.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <p className="font-medium">Not moved — nothing changed on these</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                    {outcome.failed.map((line) => (
                        <li key={line.row}>
                            <span className="font-mono">{line.row}</span>: {line.reason}
                        </li>
                    ))}
                </ul>
            </div>
        )}
        <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
        </div>
    </div>
);

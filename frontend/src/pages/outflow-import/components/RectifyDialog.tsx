// src/pages/outflow-import/components/RectifyDialog.tsx
//
// Rectify (on screen: Move) created import expenses: each one's Expense goes to a chosen Won project, or to
// Non-Project, with a typed reason. One line (the Outcome cell's button, or an expense's locked-project link) or several
// ticked together (the toolbar); the same dialog either way. The plan names the lines' source:
//   * Porter orders (#1449, ADR-0032; #1558 "Move to another project"): wording in `porterRectify.ts`, unchanged.
//   * Cashbook lines (#1757, spec #1753): the label rule, the wallet line's details with its bill and Bill check, and
//     the expense type the destination takes; wording in `cashbookRectify.ts`.
// A Cashbook line may also move to Internal Transfer (#1762, spec #1753 story 13): From, To and Detail as Mark as
// Internal Transfer asks them; the record keeps the bill as its proof and no expense is left.

import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { ArrowRightLeft, Ban, Loader2, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SITEURL from "@/constants/siteURL";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    CASHBOOK_SOURCE,
    billCheckText,
    cashbookDetailRows,
    cashbookMoveLabel,
    cashbookOutcome,
    defaultMoveType,
    defaultTransferDetail,
    destinationLedger,
    INTERNAL_TRANSFER_TARGET,
    MOVE_TO_INTERNAL_TRANSFER,
    moveTargets,
    transferChosenEnd,
    type CashbookPlanLine,
    type TransferOffer,
} from "../cashbookRectify";
import { describeFrappeError } from "../outflowTableModel";
import {
    RECTIFY_METHOD,
    RECTIFY_PLAN_METHOD,
    linesToMove,
    moveDialogTitle,
    moveOrdersLabel,
    placementText,
    rectifyOutcome,
    staysNote,
    type RectifyOutcome,
    type RectifyPlan,
    type RectifyPlanLine,
    type RectifyResult,
} from "../porterRectify";
import { PlaceSelect } from "./InternalTransferDialog";
import { PorterProjectSelect, projectOptions, type ProjectOption } from "./PorterProjectSelect";

/** A plan line of either source: Porter's fields, and a Cashbook line's beside them. */
type PlanLine = RectifyPlanLine & Partial<CashbookPlanLine>;

/** Counts openings; each one keys its own plan fetch, so a re-opened dialog never paints a stale plan. */
let openings = 0;

/** The title before the plan says the source, and for each source once it has. */
const titleOf = (rows: string[], plan: RectifyPlan | undefined): string => {
    if (!plan) return "Move";
    if (plan.source !== CASHBOOK_SOURCE) return moveDialogTitle(rows.length);
    const ledgers = plan.lines.filter((line) => line.ledger).map((line) => line.ledger);
    return cashbookMoveLabel(ledgers.length ? ledgers : plan.lines.map(() => undefined));
};

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
                    <RectifyBody rows={rows} outcome={outcome} onCancel={onClose} onRan={setOutcome} onClose={close} />
                )}
            </DialogContent>
        </Dialog>
    );
};

const RectifyBody = ({
    rows,
    outcome,
    onCancel,
    onRan,
    onClose,
}: {
    rows: string[];
    outcome: RectifyOutcome | null;
    onCancel: () => void;
    onRan: (outcome: RectifyOutcome) => void;
    onClose: () => void;
}) => {
    const [opening] = useState(() => ++openings);
    const { data, isLoading, error } = useFrappeGetCall<{ message: RectifyPlan }>(
        RECTIFY_PLAN_METHOD,
        { rows: JSON.stringify(rows) },
        `rectify-plan-${opening}`,
    );
    const plan = data?.message;
    const cashbook = plan?.source === CASHBOOK_SOURCE;
    return (
        <>
            <DialogHeader>
                <DialogTitle>{titleOf(rows, plan)}</DialogTitle>
                <DialogDescription>
                    {cashbook
                        ? "Each expense is replaced by one with the same amount, date, Txn Id, bill and Bill check, " +
                          "where you choose. Its old placement is kept as reversed, with your reason."
                        : "Each expense is replaced by one identical in amount, date, reference and invoice, " +
                          "on the project you choose. Its old placement is kept as reversed, with your reason."}
                </DialogDescription>
            </DialogHeader>
            {outcome ? (
                <OutcomeBox outcome={outcome} onClose={onClose} />
            ) : isLoading ? (
                <p className="rounded-md border px-3 py-2.5 text-sm text-muted-foreground">Loading the lines…</p>
            ) : error || !plan ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    Could not load the lines ({describeFrappeError(error, "couldn't load")}).
                </p>
            ) : (
                <RectifyForm rows={rows} plan={plan} onCancel={onCancel} onRan={onRan} />
            )}
        </>
    );
};

const RectifyForm = ({
    rows,
    plan,
    onCancel,
    onRan,
}: {
    rows: string[];
    plan: RectifyPlan;
    onCancel: () => void;
    onRan: (outcome: RectifyOutcome) => void;
}) => {
    const { call } = useFrappePostCall<{ message: RectifyResult }>(RECTIFY_METHOD);
    const [target, setTarget] = useState<ProjectOption | null>(null);
    // `null`: not chosen by hand, so the default for the destination applies.
    const [chosenType, setChosenType] = useState<ProjectOption | null>(null);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cashbook = plan.source === CASHBOOK_SOURCE;
    const lines: PlanLine[] = plan.lines;

    const options = useMemo(() => moveTargets(projectOptions(plan.projects ?? []), plan.transfer), [plan]);
    const trimmed = reason.trim();
    const moving = target ? linesToMove(lines, target.value) : [];
    const toTransfer = target?.value === INTERNAL_TRANSFER_TARGET;
    const [otherEnd, setOtherEnd] = useState("");
    // `null`: not typed by hand, so the lines' own detail applies (as Mark starts it).
    const [typedDetail, setTypedDetail] = useState<string | null>(null);
    const detail = typedDetail ?? defaultTransferDetail(moving);
    const ledger = target && !toTransfer ? destinationLedger(target.value) : null;
    const typeOptions = useMemo(
        () => (ledger ? (plan.types?.[ledger] ?? []).map((name) => ({ value: name, label: name })) : []),
        [plan, ledger],
    );
    const fallbackType = ledger ? defaultMoveType(moving, ledger, plan.types ?? {}) : "";
    const type =
        chosenType && typeOptions.some((option) => option.value === chosenType.value) ? chosenType.value : fallbackType;

    const blocked = !target
        ? "Choose where the expenses go."
        : !moving.length
          ? "Nothing here would move."
          : toTransfer && !otherEnd
            ? "Choose where the money went or came from."
            : cashbook && !toTransfer && !type
              ? "Choose an expense type the destination takes."
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
                reason: trimmed,
                ...(toTransfer
                    ? { destination: INTERNAL_TRANSFER_TARGET, other_end: otherEnd, detail: detail.trim() }
                    : { project: target.value, ...(cashbook ? { expense_type: type } : {}) }),
            });
            const targetName = target.value ? target.label : null;
            onRan(cashbook ? cashbookOutcome(response.message, targetName) : rectifyOutcome(response.message, targetName));
        } catch (err) {
            setError(describeFrappeError(err, "Nothing was moved."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <ul className="overflow-hidden rounded-md border">
                {lines.map((line) => {
                    const stays = target ? staysNote(line, target.value) : line.refusal;
                    return (
                        <li
                            key={line.row}
                            data-testid="move-line"
                            className={`space-y-0.5 border-t px-3 py-2 first:border-t-0 ${stays ? "bg-muted/30" : ""}`}
                        >
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                                <span className="font-mono text-xs">{line.crn ?? line.txn_id ?? line.row}</span>
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
                            {cashbook && line.ledger && <CashbookDetails line={line} />}
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
                <PorterProjectSelect
                    options={options}
                    value={target}
                    onChange={setTarget}
                    placeholder="Choose a Won project, or No project…"
                    isDisabled={busy}
                />
            </div>

            {toTransfer && plan.transfer && (
                <TransferEnds
                    offer={plan.transfer}
                    chosen={transferChosenEnd(moving)}
                    otherEnd={otherEnd}
                    onOtherEnd={setOtherEnd}
                    detail={detail}
                    onDetail={setTypedDetail}
                    disabled={busy}
                />
            )}

            {cashbook && target && !toTransfer && (
                <div className="space-y-1.5">
                    <Label className="text-xs">Expense type</Label>
                    <PorterProjectSelect
                        options={typeOptions}
                        value={typeOptions.find((option) => option.value === type) ?? null}
                        onChange={setChosenType}
                        placeholder="Choose a type the destination takes…"
                        isDisabled={busy}
                    />
                </div>
            )}

            <div className="space-y-1.5">
                <Label htmlFor="rectify-reason" className="text-xs">
                    Reason (required)
                </Label>
                <Input
                    id="rectify-reason"
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
                    {toTransfer
                        ? MOVE_TO_INTERNAL_TRANSFER
                        : cashbook
                          ? cashbookMoveLabel((moving.length ? moving : lines).map((line) => line.ledger))
                          : moveOrdersLabel(moving.length || rows.length)}
                </Button>
            </div>
        </div>
    );
};

/**
 * From, To and Detail for a move to Internal Transfer (#1762, story 13), as Mark as Internal Transfer asks them: the
 * line's own side is fixed, the person chooses the other end. A spend moving with its refund runs each record its own
 * way, so the choice is named "Other end".
 */
const TransferEnds = ({
    offer,
    chosen,
    otherEnd,
    onOtherEnd,
    detail,
    onDetail,
    disabled,
}: {
    offer: TransferOffer;
    chosen: "to" | "from" | "either";
    otherEnd: string;
    onOtherEnd: (value: string) => void;
    detail: string;
    onDetail: (value: string) => void;
    disabled: boolean;
}) => {
    const select = <PlaceSelect id="move-it-other" value={otherEnd} onChange={onOtherEnd} choices={offer.other_ends} />;
    const own = <span id="move-it-own">{offer.own_place}</span>;
    return (
        <fieldset disabled={disabled} className="space-y-1.5" data-testid="move-transfer">
            <p className="text-xs text-muted-foreground">
                Our own money moving between our own places: no expense is left, and the bill is kept on the Internal
                Transfer as its proof.
            </p>
            <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
                {chosen === "either" ? (
                    <>
                        <Label className="text-xs">Own side</Label>
                        {own}
                        <Label htmlFor="move-it-other" className="text-xs">
                            Other end
                        </Label>
                        {select}
                    </>
                ) : (
                    <>
                        <Label htmlFor={chosen === "from" ? "move-it-other" : undefined} className="text-xs">
                            From
                        </Label>
                        {chosen === "from" ? select : own}
                        <Label htmlFor={chosen === "to" ? "move-it-other" : undefined} className="text-xs">
                            To
                        </Label>
                        {chosen === "to" ? select : own}
                    </>
                )}
                <Label htmlFor="move-it-detail" className="text-xs">
                    Detail
                </Label>
                <Input
                    id="move-it-detail"
                    value={detail}
                    placeholder="Optional: the employee, the card's last four"
                    onChange={(event) => onDetail(event.target.value)}
                />
            </div>
        </fieldset>
    );
};

/** The wallet line's details, one compact row (stories 42, 45): the statement's facts, then the bill and its Bill check. */
const CashbookDetails = ({ line }: { line: PlanLine }) => (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" data-testid="move-details">
        {cashbookDetailRows(line)
            .filter((row) => row.label !== "Amount")
            .map((row) => (
                <span key={row.label}>
                    <span className="text-muted-foreground">{row.label}: </span>
                    {row.value}
                </span>
            ))}
        <span>
            <span className="text-muted-foreground">Bill: </span>
            {line.bill?.file && (
                <a
                    href={SITEURL + line.bill.file}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-1 inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                    <Paperclip className="h-3 w-3" /> Open
                </a>
            )}
            <span>{billCheckText(line.bill)}</span>
        </span>
    </div>
);

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

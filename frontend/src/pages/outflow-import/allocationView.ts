// src/pages/outflow-import/allocationView.ts
//
// PURE MODULE -- no React, no fetching. The screen's half of the allocation arithmetic
// (ADR-0020), and the rule for which endpoint a confirm should call.
//
// ⚠️ THE SERVER IS THE AUTHORITY. It re-reads every leg under a row lock and re-asserts the fit.
// This exists so the balance bar can move as the reviewer ticks, without a round trip.
//
// ⚠️ IT MIRRORS `services/outflow_import/allocation.py` AND MUST NOT BE STRICTER THAN IT. The
// same rule the TDS band mirror already carries: erring toward OFFERING is safe, because the
// server re-asserts; erring the other way hides a choice the server would have accepted.

import { ROW_PARTIALLY_ALLOCATED } from "./outflowImportStatus";

/**
 * Mirrors `amounts.AMOUNT_TOLERANCE`.
 *
 * ⚠️ REGISTERED IN `services/outflow_import/amounts.py`'s CALL-SITE LIST, where the rule lives:
 * "if you add an amount comparison anywhere in this feature, add it to this list -- and say WHICH
 * window it uses." This mirror, and the three `allocation.py` comparisons it mirrors, were added to
 * that list at the whole-branch review (F6). Do not add a comparison on this side without going
 * back to it: the file records the production defect an unlisted fifth site already caused.
 *
 * ⚠️ THE ONLY NUMERIC LITERAL `= 5` ON THIS SIDE (review fix 2) -- do not inline it again, and do
 * not add a second `export const ... = 5` anywhere else in this feature. `outflowTableModel.ts`'s
 * `SETTLE_WINDOW` used to be exactly that second copy (both mirror the SAME server constant,
 * `services/outflow_import/amounts.AMOUNT_TOLERANCE` -- there are not two windows here); it now
 * imports this one instead of re-declaring it. This is the pure leaf, so it owns the literal and
 * the 3,000-line table model imports it -- not the other way round, and there is no cycle to check
 * both ways: this file imports nothing from `outflowTableModel.ts`.
 */
export const AMOUNT_TOLERANCE = 5;

export interface AllocationLeg {
    target_amount: number;
    match_kind: string;
}

export interface AllocationBar {
    allocated: number;
    remaining: number;
    over: boolean;
    complete: boolean;
}

/** What is allocated once these ticks are added to what is already banked. */
export function allocationBar(
    rowAmount: number,
    legs: readonly AllocationLeg[],
    tickedAmounts: readonly number[],
): AllocationBar {
    const banked = legs
        .filter((leg) => leg.match_kind === "Settled")
        .reduce((sum, leg) => sum + (leg.target_amount || 0), 0);
    const ticked = tickedAmounts.reduce((sum, amount) => sum + (amount || 0), 0);
    const allocated = banked + ticked;
    const remaining = rowAmount - allocated;
    return {
        allocated,
        remaining,
        over: remaining < -AMOUNT_TOLERANCE,
        // ⚠️ DELIBERATELY TWO-SIDED, UNLIKE THE SERVER'S `is_fully_allocated` (review fix 6,
        // PINNED by `allocationBar.test`'s "two-sided vs the server's one-sided" case). The
        // server's own check is ONE-SIDED (`remaining <= AMOUNT_TOLERANCE`), so an OVER-allocated
        // remaining (a large negative number) still reads `True` there -- it relies on
        // `is_over_allocated` as a SEPARATE guard to catch that case before a write commits. This
        // `complete` folds both into one boolean for the button label, so it must not call an
        // over-tick "complete" -- `Math.abs` is what keeps a large negative `remaining` from
        // reading as finished. Harmless in practice: `over` (above) already disables Confirm
        // before an over-allocated tick-set can be submitted, so the two sides never actually
        // disagree about what gets written -- but nothing else states that this is on purpose,
        // so a later "fix" to either side would have no test to trip.
        complete: Math.abs(remaining) <= AMOUNT_TOLERANCE,
    };
}

/** A part-used bank line's two figures: what is reconciled against records, and what is not yet. */
export interface PartlyAllocatedFigures {
    reconciled: number;
    pending: number;
}

/**
 * The Amount cell's "reconciled / pending" pair for a `Partially Allocated` line, or `null` for any
 * other row. It is `allocationBar` over the row's own live legs with nothing ticked -- the SAME
 * arithmetic the decision dialog's balance bar shows -- so the cell and the bar cannot disagree.
 */
export function partlyAllocatedFigures(row: {
    row_status: string;
    amount: number;
    matches?: readonly AllocationLeg[];
}): PartlyAllocatedFigures | null {
    if (row.row_status !== ROW_PARTIALLY_ALLOCATED) return null;
    const bar = allocationBar(row.amount, row.matches ?? [], []);
    return { reconciled: bar.allocated, pending: bar.remaining };
}

/**
 * What the RECORD PICKER should measure every candidate against (issue #1243).
 *
 * `null` on a transfer with no legs; the BANKED REMAINDER on one that has some.
 *
 * ⚠️ `null` IS NOT THE SAME ANSWER AS `rowAmount`, AND THE DIFFERENCE IS THE WHOLE OF AC4. The two
 * are arithmetically equal on an untouched row, but `null` is what lets the caller send
 * `search_settleable_records` the params and the cache key it has always sent. Returning a number
 * there would mint a new parameter and a new key on every open row in the system, to say something
 * the endpoint already knew.
 *
 * ⚠️ IT TAKES NO TICKS, AND THE ABSENT PARAMETER IS THE ENFORCEMENT (AC5). `allocationBar` folds
 * ticks in because the BAR has to move as the reviewer works; this must not, because a list that
 * re-ranks under the cursor mid-selection is worse than a static answer -- a round trip per click,
 * with records moving as you reach for them. The bar beside it already shows the live figure. There
 * is no third parameter for a caller to pass ticks through by accident.
 *
 * ⚠️ IT SHARES `allocationBar`'S ARITHMETIC RATHER THAN REPEATING IT. The remainder the reviewer
 * READS and the remainder the picker RANKS BY are the same claim about the same row; two
 * implementations would be free to disagree, and the symptom -- a record marked "off by ₹0" sitting
 * below a record that cannot fit -- is invisible to any test that looks at only one of them.
 *
 * ⚠️ A NON-POSITIVE REMAINDER IS `null` TOO, AND THAT MIRRORS THE SERVER RATHER THAN HIDING A STATE
 * (review finding, issue #1243). `review._comparison_amount` refuses any `wanted <= 0` and ranks
 * against the transfer's own amount instead, because NO approved record can be "within ₹5" of a
 * negative target -- honouring one would return a list in which nothing at all is settleable. If
 * this side kept the negative, the two would measure DIFFERENT THINGS on the same screen: the
 * server would flag a record settleable while `AmountMark` printed a large "off by" beside it,
 * which is precisely the contradiction this whole change exists to remove. An over-allocated row is
 * still visible -- the BALANCE BAR reports it, in the words written for it -- so nothing is hidden
 * by declining to rank against an impossible target.
 *
 * ⚠️ THE CONSEQUENCE THAT MAKES IT SAFE AT EVERY CALL SITE: a non-`null` return is ALWAYS POSITIVE.
 * That is what lets the caller write `compareAmount ?? row.amount` without a second guard, and it
 * is why the rule lives HERE rather than beside the one that happens to need it first.
 */
export function pickerComparisonAmount(
    rowAmount: number,
    legs: readonly AllocationLeg[],
): number | null {
    const settled = legs.filter((leg) => leg.match_kind === "Settled");
    if (!settled.length) return null;
    const { remaining } = allocationBar(rowAmount, settled, []);
    return remaining > 0 ? remaining : null;
}

/**
 * Whether the match run's "candidate" marks may be shown on this row's records (issue #1243).
 *
 * ⚠️ THE LIVE RE-MATCH HAS NO FROZEN-STATUS GUARD, AND THAT IS WHY THIS EXISTS.
 * `get_row_candidates` re-runs the matcher on every dialog open, against the FULL transfer -- so on
 * a partly-allocated row it cheerfully marks records that can no longer fit in what is left, and
 * marks records ALREADY SETTLED AS LEGS OF THAT VERY ROW as though they were still on offer.
 *
 * ⚠️ SUPPRESSED HERE, NEVER MADE REMAINDER-AWARE (owner ruling, issue #1243). Teaching the matcher
 * about the remainder would push RANKING into the matcher, and this feature's standing fence is that
 * `similarity` must never reach anything that settles. Partly-allocated rows are frozen from
 * matching precisely so that the two stay apart; this marker is the one live-match surface that
 * slipped through, so the fix belongs on the screen.
 *
 * ⚠️ IT READS THE SAME STATUS `settleModeLocked` READS. The marks and the mode must describe the
 * same row, so both keep their opinion of "partly allocated" in one place.
 */
export function matcherMarksVisible(rowStatus: string): boolean {
    return !settleModeLocked(rowStatus);
}

/**
 * How the reviewer intends to settle this transfer (ADR-0020 B3, issue #1241).
 *
 * ⚠️ THE LABELS THE SCREEN USES ARE NOT THESE IDS, AND THE WORD "PARTIAL" IS BANNED FROM THEM. The
 * same dialog already renders a radio labelled *"A part payment"*, belonging to the INVERSE feature
 * (one approved payment split across several TRANSFERS). Two radio groups in one dialog with
 * near-identical labels and opposite meanings is the worst available outcome, so the visible copy
 * lives in `SETTLE_MODE_LABEL` below and says "Split across several payments".
 */
export type SettleMode = "normal" | "split";

/** What a row opens on. ⚠️ Mode is NOT remembered between rows -- a sticky one splits by accident. */
export const DEFAULT_SETTLE_MODE: SettleMode = "normal";

/**
 * The visible copy, in one place so the ban above is checkable and the radio and any sentence that
 * names a mode can never drift apart.
 */
export const SETTLE_MODE_LABEL: Record<SettleMode, string> = {
    normal: "Normal",
    split: "Split across several payments",
};

export const SETTLE_MODE_HINT: Record<SettleMode, string> = {
    normal: "One Reconciliation Pending record settles this whole transfer.",
    split: "Allocate this transfer across several Reconciliation Pending payments, over as many sittings as you need.",
};

/**
 * Whether the reviewer gets a choice of mode at all.
 *
 * ⚠️ A `Partially Allocated` ROW HAS NO CHOICE, AND OFFERING ONE WOULD BE A LIE. `settle_row`'s
 * `_load_settleable_row` does not admit that status, so the Normal path is refused server-side
 * before it can write anything.
 */
export function settleModeLocked(rowStatus: string): boolean {
    // ⚠️ BOUND, NOT SPELLED (review fix 5) -- `ROW_PARTIALLY_ALLOCATED` is a pure leaf constant
    // (`outflowImportStatus.ts`), so importing it here adds no cycle.
    return rowStatus === ROW_PARTIALLY_ALLOCATED;
}

/**
 * The mode that actually governs, after the row's own status has had its say.
 *
 * ⚠️ AN ABSENT MODE IS NORMAL, AND THAT IS LOAD-BEARING, NOT A CONVENIENCE DEFAULT. The BULK
 * "confirm all matched" path has no dialog and therefore no radio; it calls the router with no mode
 * at all and must keep taking `settle_row`'s stricter, byte-unchanged path. Splitting a transfer is
 * a judgement call and does not belong in a fifty-row action (ADR-0020 B3, permanently).
 */
export function effectiveSettleMode(
    chosen: SettleMode | undefined,
    rowStatus: string,
): SettleMode {
    if (settleModeLocked(rowStatus)) return "split";
    return chosen ?? DEFAULT_SETTLE_MODE;
}

/**
 * Which picker the settle dialog shows: the single-select radio table, or the fan-out checkbox one.
 *
 * ⚠️ THIS EXISTS TO BE PINNED, AND THAT IS ITS WHOLE JOB (issue #1241, AC10). The ticket offers two
 * ways to close the ledger-withholding gap -- withhold non-payment rows in the radio picker too, or
 * **prove the radio picker can never be shown a `Partially Allocated` row** -- and warns: *"Do not
 * answer 'it can't happen' without pinning it."* **ANSWER 2 IS THE ONE TAKEN, DELIBERATELY.**
 *
 * The gap: `tickAllowedForFanOut` + `disabledKeys` withhold a non-payment tick, and they are wired
 * ONLY to `FanOutRecordTable`. The restored `SettleableRecordTable` has no equivalent, so if it
 * could ever render on a `Partially Allocated` row a reviewer could pick an expense, press Confirm,
 * and be refused by the server for a reason nothing on screen hinted at.
 *
 * It cannot, because `effectiveSettleMode` forces `"split"` on that status and this function is the
 * ONLY thing that turns a mode into a picker. Composing the two is therefore the real guard, and
 * `allocationView.test` pins exactly that composition for every chosen mode -- which is why the
 * fork is a named function rather than a ternary inside the JSX: this repo has no DOM environment,
 * by deliberate choice, so a ternary in the render is untestable where it sits and the "it can't
 * happen" answer would be an assertion about code nothing checks. Same reason `PricingGrid` keeps
 * its own `selectRenderPath` outside the JSX.
 *
 * ⚠️ THE CALLER MUST PASS THE **EFFECTIVE** MODE. Handing it the reviewer's CHOSEN mode would put a
 * `Partially Allocated` row in front of the radio picker and reopen the gap in one word.
 */
export type SettlePicker = "radio" | "checkbox";

export function settlePickerFor(mode: SettleMode): SettlePicker {
    return mode === "normal" ? "radio" : "checkbox";
}

/** The two endpoints a confirm can reach. `null` beside it always means "no record picked". */
export type SettleEndpoint = "settle_row" | "allocate_row";

/**
 * Which endpoint a confirm should call.
 *
 * ⚠️ ROUTING READS INTENT, NOT TICK COUNT (issue #1241, ADR-0020 B3 -- REPLACING the original rule).
 * It used to send a single tick on an untouched row to `settle_row` whatever the reviewer meant,
 * and `settle_row`'s guard demands the record equal the WHOLE transfer -- so the remainder-bounded
 * guard was reachable only with two ticks or on an already-allocated row, and there was no way at
 * all to place a first leg smaller than the transfer and come back for the second. That was the
 * owner's actual blocker. The MODE now decides.
 *
 * ⚠️ SPLIT ALWAYS ROUTES THROUGH `allocate_row`, INCLUDING A SINGLE TICK THAT HAPPENS TO EQUAL THE
 * WHOLE TRANSFER -- and this function cannot see an amount, which is what makes an amount-based
 * shortcut impossible rather than merely discouraged. Both endpoints write a leg (an older version
 * of this note said `settle_row` writes none -- FALSE, corrected at #1271), but `settle_row` holds the
 * whole-transfer guard and may rewrite the payment's amount to the bank's figure (slice X1), which a
 * reversal cannot put back. A shortcut would make two identical-looking actions behave differently,
 * with nothing on screen saying which one you got.
 *
 * ⚠️ THE SAFETY RULE SURVIVES INTACT ON THE NORMAL SIDE: a single Normal pick keeps taking
 * `settle_row`, byte-unchanged, with its stricter whole-transfer guard. Every settle that worked
 * before ADR-0020 -- including every bulk one, which passes no mode -- takes the identical path.
 */
export function chooseSettleEndpoint({
    ticks,
    rowStatus,
    mode,
}: {
    ticks: number;
    rowStatus: string;
    /** Absent means Normal. See `effectiveSettleMode` for why that default is load-bearing. */
    mode?: SettleMode;
}): SettleEndpoint | null {
    if (ticks <= 0) return null;
    if (effectiveSettleMode(mode, rowStatus) === "split") return "allocate_row";
    // ⚠️ THIS IS A CAPACITY RULE, NOT THE OLD TICK-COUNT RULE SURVIVING. `settle_row` takes ONE
    // target, so routing a multi-pick there would settle the first record and silently DROP the
    // rest -- a money bug. Normal mode's picker is single-select by construction, so this branch is
    // unreachable from the product; it exists so that a writer that ever produced the shape lands
    // on the endpoint that can EXPRESS it and is refused loudly, rather than half-written in
    // silence. Do not fold it back into an intent rule.
    if (ticks > 1) return "allocate_row";
    return "settle_row";
}

export function allocateButtonLabel({
    ticks,
    complete,
}: {
    ticks: number;
    complete: boolean;
}): string {
    const noun = ticks === 1 ? "record" : "records";
    const base = `Allocate ${ticks} ${noun}`;
    return complete ? `${base} · completes this transfer` : base;
}

/**
 * Why Confirm is unavailable.
 *
 * ⚠️ A REASON, NOT A BOOLEAN, AND THAT IS THE POINT OF EXTRACTING THIS (#1239). The button's
 * `disabled` and the sentence the reviewer reads beside it used to be derived at two different
 * places inside `DecisionDialog` -- the gate as one OR-expression in the footer, the wording as two
 * separate JSX conditions in the balance bar. Nothing tied them together, so a change to one could
 * silently stop describing the other: a dead control with the wrong explanation, or with none.
 */
export type ConfirmGateReason =
    | "busy"
    | "decision-incomplete"
    | "balance-unknown"
    | "over-allocated";

/** The subset of reasons the allocation arithmetic produces -- the two the balance bar speaks. */
export type BalanceGateReason = Extract<
    ConfirmGateReason,
    "balance-unknown" | "over-allocated"
>;

export interface ConfirmGate {
    /**
     * Why Confirm is unavailable, or `null` when it is available -- so the button's `disabled` IS
     * `reason !== null`, read that way at the call site.
     *
     * ⚠️ THERE IS DELIBERATELY NO `disabled: boolean` BESIDE THIS. A convenience projection is
     * exactly what lets a caller take the boolean and never consult the reason, which is the
     * "bare boolean" shape #1239 exists to remove -- the ticket's requirement is that the dialog
     * render the disabled state FROM the reason, and a second field would quietly excuse it from
     * doing so. Do not add one back.
     *
     * ⚠️ IT IS TOTAL, WHICH IS WHY `busy` AND `decision-incomplete` ARE MEMBERS even though nothing
     * on screen says either out loud today (neither had a message before this change, and #1239 is
     * a prefactor with no user-visible change). Without them `reason` would read `null` -- "Confirm
     * is available" -- on a row where the button is plainly dead, and the narrowing ticket needs to
     * know WHICH blocker won in order to narrow the right one.
     */
    reason: ConfirmGateReason | null;
    /**
     * What the balance itself has to say, whichever decision card is chosen.
     *
     * ⚠️ DELIBERATELY NOT GATED ON `balanceGoverns`. A `Partially Allocated` row whose reviewer has
     * opened the "create a new expense" card still has legs nobody has read yet, and the bar must
     * keep saying so -- printing a confident `allocated ₹0 · left ₹<the whole transfer>` there is
     * the false-confidence defect review fix 1 removed. So `disabled` respects which path is being
     * confirmed and this does not; both still come out of ONE call, which is what stops the gate
     * and the message disagreeing.
     */
    balanceReason: BalanceGateReason | null;
    /** The sentence for `balanceReason`, ready to render. `null` when the balance is fine. */
    balanceMessage: string | null;
}

/**
 * ⚠️ THE EXACT STRINGS THE DIALOG USED TO CARRY INLINE. Moved here so the message and the gate are
 * one value; the wording is unchanged.
 */
const BALANCE_MESSAGES: Record<BalanceGateReason, string> = {
    "balance-unknown":
        "Balance not yet known — waiting on what this transfer has already settled.",
    "over-allocated": "— untick something before confirming",
};

/**
 * What the red bar says once the gate has been NARROWED away from this pick (#1242).
 *
 * ⚠️ THE BAR STILL GOES RED, AND ONLY THE INSTRUCTION CHANGES (ADR-0020 B4). The ticks really do
 * exceed the transfer, which is worth showing on a money screen whichever endpoint is about to be
 * called -- but "untick something before confirming" is advice about a tick-set the gate is
 * REFUSING, and beside a live button the reviewer is now meant to press it is simply wrong. So the
 * fact keeps its red skin and the sentence points at the button, which is where the answer is:
 * `AmountOutsideWindowDialog` opens on the click and names the part-payment and TDS options.
 */
const OVER_ALLOCATED_NARROWED = "— press Confirm to see your options";

/**
 * Whether Confirm is available, and why not.
 *
 * ⚠️ PURE, AND THAT IS THE REASON IT EXISTS. This repo has no DOM test environment, by deliberate
 * choice (`frontend/CLAUDE.md`), so an expression living inside the dialog component is untestable
 * where it sits -- which is how this gate survived four review passes while making the part-payment
 * and TDS-deduction detours unreachable from the product. #1239 moved it here so a test could see
 * it; #1242 is the narrowing that test now pins.
 *
 * ⚠️ THE OVER-ALLOCATION GATE FOLLOWS THE `endpoint`, NOT THE PICK (#1242, ADR-0020 B4). On a fresh
 * row `banked = 0`, so `over` reduces to *"the ticked record exceeds the transfer by more than the
 * tolerance"* -- which is ALGEBRAICALLY the condition that opens the part-payment / TDS detour,
 * since the settle window and `AMOUNT_TOLERANCE` are literally the same constant. That detour's
 * only trigger sits inside the dialog's confirm HANDLER, which a disabled button never fires, so
 * every pick that could open it was a pick whose Confirm was dead: both paths live in source and
 * unreachable from the product. Gating on the endpoint restores them, and loses nothing -- the
 * allocation arithmetic only governs where `allocate_row` is being called, and `settle_row` keeps
 * its own stricter whole-transfer guard server-side and refuses an oversized tick regardless.
 *
 * ⚠️ NARROW, DO NOT DELETE, AND `legsUnknown` IS NOT PART OF THE NARROWING. It is innocent: already
 * scoped to `Partially Allocated` rows, so always false on a fresh row, and such a row is FORCED to
 * Split mode and therefore inside the narrowed set anyway. Ruling U -- never draw a confident
 * balance over an unknown leg set -- must keep biting on every endpoint. Do not fold the two terms
 * back together.
 *
 * ⚠️ `balanceGoverns` IS STILL THE OUTER CONDITION FOR BOTH. It answers "is a link decision being
 * confirmed at all", which a "create something new" card makes false; the endpoint answers "which
 * settle is it". An `allocate_row` on a create-expense card governs nothing, so the two AND.
 *
 * ⚠️ `balance-unknown` OUTRANKS `over-allocated`, matching the bar's own short-circuit -- an
 * over-tick measured against a balance nobody has read is not a fact worth reporting.
 */
export function confirmGate({
    busy,
    decisionConfirmable,
    balanceGoverns,
    endpoint,
    legsUnknown,
    over,
}: {
    busy: boolean;
    decisionConfirmable: boolean;
    balanceGoverns: boolean;
    /**
     * The endpoint this confirm would call -- `chooseSettleEndpoint`'s own return value, passed
     * straight through rather than reduced to a boolean at the call site (ADR-0020 B4: *"the
     * predicate already exists and is already single-homed"*). See the narrowing note on this
     * function for why. `null` -- no record picked -- is not an allocation.
     */
    endpoint: SettleEndpoint | null;
    legsUnknown: boolean;
    over: boolean;
}): ConfirmGate {
    const balanceReason: BalanceGateReason | null = legsUnknown
        ? "balance-unknown"
        : over
          ? "over-allocated"
          : null;

    /** Where the allocation arithmetic actually decides whether this confirm may be sent. */
    const allocationGoverns = balanceGoverns && endpoint === "allocate_row";

    // ⚠️ ORDER IS PRECEDENCE. `balance-unknown` and `over-allocated` now carry DIFFERENT conditions
    // (see the narrowing note above), so unlike the plain OR this replaced, a re-ordering of these
    // last two branches WOULD change which reason is named -- though still never, on any input,
    // whether Confirm is available, because their conditions are evaluated independently.
    const reason: ConfirmGateReason | null = busy
        ? "busy"
        : !decisionConfirmable
          ? "decision-incomplete"
          : balanceGoverns && legsUnknown
            ? "balance-unknown"
            : allocationGoverns && over
              ? "over-allocated"
              : null;

    return {
        reason,
        balanceReason,
        // ⚠️ THE MESSAGE TRACKS WHETHER THE GATE BITES, which is the point of returning one value:
        // "untick something before confirming" is only true where unticking is what unblocks the
        // button. Everywhere else the over-tick is still reported, pointing at the button instead.
        balanceMessage:
            balanceReason === "over-allocated" && !allocationGoverns
                ? OVER_ALLOCATED_NARROWED
                : balanceReason
                  ? BALANCE_MESSAGES[balanceReason]
                  : null,
    };
}

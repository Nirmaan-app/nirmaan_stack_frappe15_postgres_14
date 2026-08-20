/**
 * Partial CEO approval — the pure arithmetic behind the approve dialog's amount box.
 *
 * Kept OUT of the dialog component on purpose: this repo has no DOM test environment
 * (see `frontend/CLAUDE.md`), so anything living inside a React component is structurally
 * untestable here. The boundaries below are exactly where a wrong number becomes a wrong
 * payment, so they get real tests.
 *
 * ⚠️ THIS IS A UX MIRROR, NOT THE GATE. `services/payment_split.py` re-validates every rule
 * here under a row lock, and it is the authority. The point of duplicating them is that the
 * CEO sees the refusal while typing rather than after clicking.
 *
 * The rules, and why each exists:
 *   - Never ABOVE the requested amount. The approval is a trim, not a re-quote; approving more
 *     than the PO term allocated would push the PO past its own total.
 *   - Never BELOW ₹1 approved. That is a rejection, and rejection is a different button with a
 *     different meaning (and a mandatory reason).
 *   - Never a balance BELOW ₹1. It would mint a payment and a PO term row that nobody can ever
 *     action, for an amount that rounds to nothing.
 *   - EXACTLY the full amount is legal and is NOT a split — it is the ordinary full approval.
 */

/** Both halves of a split must be at least this. Mirrors `payment_split.MIN_SPLIT_AMOUNT`. */
export const MIN_SPLIT_AMOUNT = 1;

/**
 * Can this payment be split at all? If not, the approve dialog must NOT offer an amount box.
 *
 * ⚠️ THIS EXISTS BECAUSE OF REFUNDS, AND IT IS NOT AN EDGE CASE.
 * A NEGATIVE Project Payment is a real, common document — a credit or refund raised after a
 * negative-rate amendment. `create_payment_request_for_service` allows `amount < 0` explicitly,
 * and the sub-₹10,001 auto-approval deliberately does NOT apply to it (`0 < amount < threshold`),
 * so a refund ALWAYS travels the full Requested → CEO Pending → Approved route. 127 of them exist
 * on the live database today.
 *
 * Offering the amount box on one of those is worse than useless: the box pre-fills with the
 * negative figure, every split rule rejects it, and the Confirm button goes dead — the CEO simply
 * cannot approve the refund. So an unsplittable payment falls back to the plain full-approve
 * confirmation, exactly as it behaved before partial approval existed.
 *
 * The floor is TWICE the minimum, because a split has two halves and both must clear it.
 */
export function isSplittable(original: number): boolean {
    return Number.isFinite(original) && original >= 2 * MIN_SPLIT_AMOUNT;
}

export interface SplitComputation {
    /** What would be approved now. Only meaningful when `valid`. */
    approved: number;
    /** What would stay pending. 0 when this is a full approval. */
    remainder: number;
    /** True when this would actually split. False for a full approval. */
    isPartial: boolean;
    valid: boolean;
    /** Why it is not valid — shown under the input. Absent when valid. */
    reason?: string;
}

/**
 * Work out what the typed amount would do to a payment of `original`.
 *
 * `typed` is the raw input string, because that is what the field holds — an empty box and a
 * zero are different states and must not collapse into each other.
 */
export function computeSplit(original: number, typed: string): SplitComputation {
    const blank: SplitComputation = { approved: 0, remainder: 0, isPartial: false, valid: false };

    const trimmed = (typed ?? "").trim();
    if (!trimmed) {
        return { ...blank, reason: "Enter the amount you are approving." };
    }

    const approved = Number(trimmed);
    if (!Number.isFinite(approved)) {
        return { ...blank, reason: "Enter a valid amount." };
    }

    if (approved < MIN_SPLIT_AMOUNT) {
        return {
            ...blank,
            approved,
            reason: `Approve at least ₹${MIN_SPLIT_AMOUNT}. To approve nothing, reject the payment instead.`,
        };
    }

    if (approved > original) {
        return {
            ...blank,
            approved,
            reason: "You cannot approve more than the requested amount.",
        };
    }

    // Never independently rounded — the two halves must add back up to the original exactly,
    // because the PO's payment terms have to keep summing to the PO total.
    const remainder = original - approved;

    if (remainder === 0) {
        return { approved, remainder: 0, isPartial: false, valid: true };
    }

    if (remainder < MIN_SPLIT_AMOUNT) {
        return {
            ...blank,
            approved,
            reason: `The balance would be under ₹${MIN_SPLIT_AMOUNT}. Approve the full amount instead.`,
        };
    }

    return { approved, remainder, isPartial: true, valid: true };
}

/**
 * Should the input accept this keystroke?
 *
 * Digits and at most one decimal point. Deliberately permissive about RANGE — range problems are
 * reported by `computeSplit` as a readable message, because a field that silently refuses a
 * keystroke reads as a broken keyboard.
 */
export function isAmountKeystroke(value: string): boolean {
    return value === "" || /^\d*\.?\d*$/.test(value);
}

/**
 * The reason key that sits above the Pending Invoice Approvals table.
 *
 * The "Not Auto-Approved Reason" column can only afford a one-line label per
 * flag — enough to scan, not enough to act on. This panel is the other half:
 * every reason the 12 gates can record, grouped by how urgent it is, with a
 * three-part breakdown one hover away — what the gate checked, WHY that blocks
 * the invoice, and what to do about it.
 *
 * The middle part is the one the column can never carry, and the reason this
 * panel exists: "Invoiced total exceeds what's been delivered" tells a reviewer
 * what happened, not that approving it means paying for goods the site has not
 * received. Each part is a separate labelled line, not merged prose, because
 * the impact is exactly the line that gets skimmed when it is buried mid-
 * paragraph.
 *
 * Three deliberate choices:
 *
 * 1. CATALOGUE, not a count. It lists what the gates CAN say, not what the
 *    current page happens to contain. The table is server-paginated, so any
 *    count computed here would silently mean "on this page" — a number that
 *    reads like a queue total and isn't one. Live per-reason counts need a
 *    backend aggregate; until then the key stays honest about being a key.
 *
 * 2. The tooltip is PORTALLED to <body> and fixed-positioned rather than built
 *    on the shared <HoverCard>. That component does not wrap its content in a
 *    Radix Portal, and this panel renders inside the pending table's
 *    `overflow-hidden` shell — an in-flow popper would be clipped at the panel
 *    edge, which is precisely where a 360px card wants to go.
 *
 * 3. HOVER previews, CLICK pins. Pinning survives the pointer leaving, keeps
 *    the card open while a reviewer works through the invoice underneath, and
 *    gives touch devices a way in — hover alone would leave them with nothing.
 *
 * All content comes from `AUTO_APPROVE_REASON_LABELS` via `listReasonsByTier`,
 * so the key can never drift from what the column renders.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Info, RefreshCw, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    AutoApproveReason,
    ReasonTier,
    listReasonsByTier,
} from "../utils/autoApproveReasons";
import { ReasonBreakdown, ReasonTitle, TIER_DOT } from "./ReasonBreakdown";

const STORAGE_KEY = "inv_pending_reason_key_open";

/**
 * Tiers the key does not list.
 *
 * `legacy` is the three `low_confidence_*` tokens from the retired gate 5.
 * Nothing in the key can be acted on: the gate no longer exists, and no PENDING
 * invoice carries one — all 25 rows that still do were approved long ago. In a
 * key whose job is to explain the queue in front of you, they were three chips
 * of pure noise.
 *
 * They stay in `AUTO_APPROVE_REASON_LABELS`, so those 25 rows still get a
 * proper reading in the row hover, where someone is looking at the actual flag.
 * Hiding a tier is not the same as removing a gate: when gate 8 went, its two
 * tokens were deleted from the catalogue AND erased from the database by
 * `patches/v3_0/retire_po_number_gate.py`, so nothing is left to read.
 */
const HIDDEN_TIERS: ReadonlySet<ReasonTier> = new Set(["legacy"]);
const CARD_WIDTH = 360;
/** Below this much room under the chip, the card flips above it. */
const CARD_MIN_SPACE = 230;

interface TierStyle {
    /** Group heading in the expanded body. */
    title: string;
    /** One line on what the whole tier means. */
    gloss: string;
    /** Short word for the collapsed header summary. */
    short: string;
    chip: string;
}

const TIER_STYLES: Record<ReasonTier, TierStyle> = {
    blocker: {
        title: "Blockers",
        gloss: "evidence of a real problem — verify before you approve",
        short: "blockers",
        chip: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    },
    check: {
        title: "Checks",
        gloss: "the AI could not confirm something — needs a human eye",
        short: "checks",
        chip: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    },
    info: {
        title: "Master-data gaps",
        gloss: "nothing wrong with the invoice — fix the vendor, project or PO",
        short: "data gaps",
        chip: "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100",
    },
    eligibility: {
        title: "Never a candidate",
        gloss: "auto-approval is AI-only and PO-only, by design — not a failure",
        short: "by design",
        chip: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",
    },
    legacy: {
        title: "Retired checks",
        gloss: "the gate no longer exists — only on older invoices",
        short: "retired",
        chip: "border-dashed border-gray-300 bg-white text-gray-500 hover:bg-gray-50",
    },
};

interface Anchored {
    reason: AutoApproveReason;
    rect: DOMRect;
}

/** Fixed-position coordinates for the card, kept inside the viewport. */
const placeCard = (rect: DOMRect): React.CSSProperties => {
    const margin = 8;
    const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - CARD_WIDTH - margin)
    );
    const roomBelow = window.innerHeight - rect.bottom;
    return roomBelow >= CARD_MIN_SPACE
        ? { left, top: rect.bottom + 6 }
        : { left, bottom: window.innerHeight - rect.top + 6 };
};

/** The card itself — same content whether it is hovered or pinned. */
const ReasonCard: React.FC<{
    anchored: Anchored;
    pinned: boolean;
    onClose: () => void;
}> = ({ anchored, pinned, onClose }) => {
    const { reason } = anchored;
    return createPortal(
        <div
            role="tooltip"
            style={{ ...placeCard(anchored.rect), width: CARD_WIDTH }}
            className="fixed z-[60] rounded-md border border-gray-200 bg-white p-3 shadow-lg"
        >
            <div className="flex items-start gap-1.5">
                <ReasonTitle reason={reason} showToken />
                {pinned && (
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="ml-auto -mr-1 -mt-1 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                        <X className="h-3 w-3" />
                    </button>
                )}
            </div>
            <div className="mt-2 border-t border-gray-100 pt-2">
                <ReasonBreakdown reason={reason} />
            </div>
        </div>,
        document.body
    );
};

interface AutoApproveReasonKeyProps {
    className?: string;
    /**
     * Re-run the gates across the pending queue. Omitted for a reviewer who may
     * not action approvals — the key is then read-only, exactly as before.
     */
    onRecheck?: () => void;
    isRechecking?: boolean;
}

export const AutoApproveReasonKey: React.FC<AutoApproveReasonKeyProps> = ({
    className,
    onRecheck,
    isRechecking,
}) => {
    const groups = useMemo(
        () => listReasonsByTier().filter((g) => !HIDDEN_TIERS.has(g.tier)),
        []
    );
    const total = useMemo(
        () => groups.reduce((sum, g) => sum + g.reasons.length, 0),
        [groups]
    );

    // Collapsed by default so it never steals rows from the table; the choice
    // is remembered, because a reviewer learning the gates wants it open all day.
    const [isOpen, setIsOpen] = useState<boolean>(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === "1";
        } catch {
            return false;
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, isOpen ? "1" : "0");
        } catch {
            /* private mode — the panel just forgets between visits */
        }
    }, [isOpen]);

    const [hovered, setHovered] = useState<Anchored | null>(null);
    const [pinned, setPinned] = useState<Anchored | null>(null);
    const shown = hovered ?? pinned;
    const isPinnedCard = !hovered && !!pinned;
    const pinnedToken = pinned?.reason.token ?? null;

    const open = useCallback(
        (reason: AutoApproveReason, el: HTMLElement) =>
            setHovered({ reason, rect: el.getBoundingClientRect() }),
        []
    );

    const togglePin = useCallback((reason: AutoApproveReason, el: HTMLElement) => {
        setPinned((current) =>
            current?.reason.token === reason.token
                ? null
                : { reason, rect: el.getBoundingClientRect() }
        );
    }, []);

    // A fixed card can't follow the page, so anything that moves the anchor
    // dismisses it rather than leaving it stranded mid-screen.
    const dismiss = useRef(() => {
        setHovered(null);
        setPinned(null);
    });
    useEffect(() => {
        if (!shown) return;
        const onScroll = () => dismiss.current();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") dismiss.current();
        };
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onScroll);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onScroll);
            window.removeEventListener("keydown", onKey);
        };
    }, [shown]);

    // Collapsing the panel must not leave a card floating over the table.
    useEffect(() => {
        if (!isOpen) {
            setHovered(null);
            setPinned(null);
        }
    }, [isOpen]);

    if (total === 0) return null;

    return (
        <div
            className={cn(
                "shrink-0 rounded-md border border-gray-200 bg-white",
                className
            )}
        >
            <div className="flex items-center gap-2 px-3 py-2">
                <button
                    type="button"
                    onClick={() => setIsOpen((v) => !v)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <ShieldQuestion className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="text-xs font-medium text-gray-900">
                        Not Auto-Approved Reasons
                    </span>
                    <span className="hidden truncate text-[11px] text-gray-500 sm:inline">
                        {groups
                            .map((g) => `${g.reasons.length} ${TIER_STYLES[g.tier].short}`)
                            .join(" · ")}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-gray-500">
                        {isOpen ? "Hide" : `${total} reasons`}
                        <ChevronDown
                            className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                isOpen && "rotate-180"
                            )}
                        />
                    </span>
                </button>
                {onRecheck && (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onRecheck}
                        disabled={isRechecking}
                        title="Re-run the checks against current PO data. Nothing is approved until you confirm."
                        className="h-7 shrink-0 gap-1.5 border-red-300 px-2 text-[11px] text-red-600 hover:border-red-400 hover:bg-red-50 hover:text-red-700"
                    >
                        <RefreshCw
                            className={cn("h-3 w-3", isRechecking && "animate-spin")}
                        />
                        {isRechecking ? "Checking…" : "Re-check"}
                    </Button>
                )}
            </div>

            {isOpen && (
                <div className="border-t border-gray-100 px-3 pb-2.5 pt-2">
                    {groups.map((group) => {
                        const style = TIER_STYLES[group.tier];
                        return (
                            <div key={group.tier} className="mb-3 last:mb-1">
                                <div className="mb-1.5 flex items-baseline gap-1.5">
                                    <span
                                        className={cn(
                                            "h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full",
                                            TIER_DOT[group.tier]
                                        )}
                                    />
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">
                                        {style.title}
                                    </span>
                                    <span className="text-[11px] text-gray-400">
                                        {style.gloss}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {group.reasons.map((reason) => (
                                        <button
                                            key={reason.token}
                                            type="button"
                                            aria-pressed={pinnedToken === reason.token}
                                            onMouseEnter={(e) => open(reason, e.currentTarget)}
                                            onMouseLeave={() => setHovered(null)}
                                            onFocus={(e) => open(reason, e.currentTarget)}
                                            onBlur={() => setHovered(null)}
                                            onClick={(e) => togglePin(reason, e.currentTarget)}
                                            className={cn(
                                                "rounded border px-1.5 py-0.5 text-[11px] leading-snug transition-colors",
                                                style.chip,
                                                pinnedToken === reason.token &&
                                                "ring-2 ring-sky-400 ring-offset-1"
                                            )}
                                        >
                                            {reason.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}

                    <p className="flex items-start gap-1.5 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-400">
                        <Info className="mt-px h-3 w-3 shrink-0" />
                        <span>
                            Hover a reason for what was checked, why it blocks and what to do —
                            click to keep it open. Reasons are recorded when the invoice is
                            created and do not re-run on their own, so a reason can be stale once
                            the PO has been delivered or the invoice corrected. Re-check re-runs
                            every gate against current data and approves whatever now passes.
                        </span>
                    </p>
                </div>
            )}

            {shown && (
                <ReasonCard
                    anchored={shown}
                    pinned={isPinnedCard}
                    onClose={() => setPinned(null)}
                />
            )}
        </div>
    );
};

export default AutoApproveReasonKey;

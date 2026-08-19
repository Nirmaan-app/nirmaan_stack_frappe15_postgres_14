/**
 * The write-up for one auto-approve reason — shared by the two places that
 * show it, so they can never drift apart:
 *
 *   • the reason key above the pending table (the whole catalogue, `full`)
 *   • the hover on a row's "Not Auto-Approved Reason" cell (this invoice's
 *     flags only, `compact`)
 *
 * `compact` drops the "What was checked" line. In the cell a reviewer may be
 * reading four flags at once and already knows what the gate does — what they
 * need there is why this invoice is stuck and what to do about it. The key,
 * where reasons are read one at a time to learn them, keeps all three.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { AutoApproveReason, ReasonTier } from "../utils/autoApproveReasons";

/** Tier → dot colour. One definition, used by the key and the cell alike. */
export const TIER_DOT: Record<ReasonTier, string> = {
    blocker: "bg-red-500",
    check: "bg-amber-500",
    info: "bg-gray-400",
    eligibility: "bg-sky-500",
    legacy: "bg-gray-300",
};

/**
 * Heading for the middle line. An eligibility reason never blocked anything —
 * the invoice was not a candidate to begin with — and a legacy reason blocked
 * once, under a gate that no longer exists. Calling either "why it blocks"
 * would tell the reviewer something untrue.
 */
export const IMPACT_TERM: Record<ReasonTier, string> = {
    blocker: "Why it blocks",
    check: "Why it blocks",
    info: "Why it blocks",
    eligibility: "Why it never applied",
    legacy: "Why it blocked then",
};

const DetailRow: React.FC<{ term: string; desc: string; emphasis?: boolean }> = ({
    term,
    desc,
    emphasis,
}) => (
    <div className="flex gap-2">
        <dt className="w-[92px] shrink-0 pt-px text-right text-[10px] font-semibold uppercase leading-relaxed tracking-wide text-gray-400">
            {term}
        </dt>
        <dd
            className={cn(
                "text-[11px] leading-relaxed",
                emphasis ? "font-medium text-gray-900" : "text-gray-600"
            )}
        >
            {desc}
        </dd>
    </div>
);

/** Dot + label + the gate that recorded it. */
export const ReasonTitle: React.FC<{
    reason: AutoApproveReason;
    showToken?: boolean;
}> = ({ reason, showToken }) => (
    <div className="flex items-start gap-1.5">
        <span
            className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", TIER_DOT[reason.tier])}
        />
        <div className="min-w-0">
            <p className="text-xs font-semibold leading-snug text-gray-900">
                {reason.label}
            </p>
            <p className="mt-0.5 text-[10px] text-gray-400">
                {reason.gate}
                {showToken ? ` · ${reason.token}` : ""}
            </p>
        </div>
    </div>
);

export const ReasonBreakdown: React.FC<{
    reason: AutoApproveReason;
    compact?: boolean;
}> = ({ reason, compact }) => (
    <dl className="space-y-1.5">
        {!compact && <DetailRow term="What was checked" desc={reason.detail} />}
        <DetailRow term={IMPACT_TERM[reason.tier]} desc={reason.impact} emphasis />
        <DetailRow term="What to do" desc={reason.action} />
    </dl>
);

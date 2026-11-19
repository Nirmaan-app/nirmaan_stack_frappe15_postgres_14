/**
 * The Reimbursements tab bar (owner, 2026-11-19; plan page "Tab layout"): one row of equal-height tabs, each label on
 * two lines with its count beside it, then All, and Reimbursement Raised By Me alone at the right end. Admin and the CEO
 * get their tabs grouped under a top line named for who works them (HR, Admin, Accounts), the name on the line (owner,
 * 2026-11-19: top border only, no box); HR and Accounts -- fewer tabs -- get a plain row. A claimant whose only tab is Raised By Me sees it at the left. Which tabs a person has is `rules.tabsFor`; this only lays
 * them out. On a narrow screen a whole tab or group moves to the next line; a label never breaks further.
 */

import { cn } from "@/lib/utils";
import type { ClaimTabCounts } from "@/types/NirmaanStack/Reimbursement";
import {
    TAB_ALL,
    TAB_GROUPS,
    TAB_LABELS,
    TAB_LINES,
    TAB_MINE,
    type ReimbursementTab,
} from "@/utils/reimbursements/rules";

interface Props {
    tabs: ReimbursementTab[];
    active: ReimbursementTab;
    counts: ClaimTabCounts;
    grouped: boolean;
    onOpen: (tab: ReimbursementTab) => void;
}

export function ReimbursementTabBar({ tabs, active, counts, grouped, onOpen }: Props) {
    const pill = (t: ReimbursementTab) => {
        const on = t === active;
        const count = counts[t];
        const [first, second] = TAB_LINES[t];
        return (
            <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={TAB_LABELS[t]}
                onClick={() => onOpen(t)}
                className={cn(
                    "flex h-11 shrink-0 items-center gap-2 rounded-md px-2.5 text-left transition-colors",
                    // Raised By Me looks like every other tab (owner, 2026-11-19: its white, outlined look read as a
                    // shorter box beside the group boxes); its place at the right end is what sets it apart.
                    on ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-muted dark:text-foreground",
                )}
            >
                <span className="flex flex-col justify-center whitespace-nowrap text-[12.5px] font-medium leading-[1.15]">
                    <span>{first}</span>
                    {second && <span>{second}</span>}
                </span>
                {count !== undefined && (
                    <b className={cn("rounded-full px-1.5 text-[11px] tabular-nums", on ? "bg-white/25" : "bg-black/10 dark:bg-white/10")}>
                        {count}
                    </b>
                )}
            </button>
        );
    };

    const has = (t: ReimbursementTab) => tabs.includes(t);
    const inRow = tabs.filter((t) => t !== TAB_MINE && t !== TAB_ALL);

    return (
        <div className="flex flex-wrap items-end gap-2" role="tablist" aria-label="Reimbursement tabs">
            {tabs.some((t) => t !== TAB_MINE) && <div className={cn("flex flex-wrap items-end", grouped ? "gap-3" : "gap-2")}>
                {grouped
                    ? TAB_GROUPS.map(({ label, tabs: groupTabs }) => {
                        const shown = groupTabs.filter(has);
                        if (!shown.length) return null;
                        return (
                            <fieldset key={label} className="flex flex-wrap items-center gap-1.5 border-0 border-t px-0 pb-0 pt-1">
                                <legend className="ml-2 px-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {label}
                                </legend>
                                {shown.map((t) => pill(t))}
                            </fieldset>
                        );
                    })
                    : inRow.map((t) => pill(t))}
                {has(TAB_ALL) && (
                    <>
                        {grouped && <span className="mx-0.5 mb-1.5 h-8 w-px bg-border" aria-hidden="true" />}
                        {pill(TAB_ALL)}
                    </>
                )}
            </div>}
            {/* Its own wrapper with ml-auto: on a narrow screen it wraps to the next line but stays on the right. When it
                is the person's only tab (a claimant who reviews nothing) it stays at the left: nothing to stand apart from. */}
            {has(TAB_MINE) && <div className={cn(tabs.length > 1 && "ml-auto")}>{pill(TAB_MINE)}</div>}
        </div>
    );
}

/**
 * The Reimbursements tab bar (owner, 2026-11-19; plan page "Tab layout"): one row of equal-height tabs, each label on
 * two lines with its count beside it, then All, and Reimbursement Raised By Me alone at the right end. Admin and the CEO
 * get their tabs grouped under a top line named for who works them (HR, Admin, Accounts), the name on the line (owner,
 * 2026-11-19: top border only, no box); HR and Accounts -- fewer tabs -- get a plain row. A claimant whose only tab is
 * Raised By Me sees it at the left. Which tabs a person has is `rules.tabsFor`; this only lays them out.
 *
 * Narrower than that row (owner, 2026-11-19, plan page "Tablet and phone layout"), nothing is dropped, only laid out
 * differently. The bar measures its own width -- the sidebar and the screen both take from it, so a screen breakpoint
 * would still wrap on a small laptop: when the full row doesn't fit, the tabs go into one row that scrolls sideways
 * (group names inline, Raised By Me last, the open tab scrolled into view); on a phone-narrow bar, one button shows the
 * open tab and its count and opens the whole list, grouped, with every count.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/** Below this width (px) the bar is a phone's: the one-button picker. */
const PICKER_BELOW = 560;

type Layout = "full" | "strip" | "picker";

/** A section of the bar: a group name (null for none) and its tabs, in order. All and Raised By Me close the list. */
interface Section {
    label: string | null;
    tabs: ReimbursementTab[];
}

function sectionsOf(tabs: ReimbursementTab[], grouped: boolean): Section[] {
    const has = (t: ReimbursementTab) => tabs.includes(t);
    const middle: Section[] = grouped
        ? TAB_GROUPS.map(({ label, tabs: g }) => ({ label, tabs: g.filter(has) })).filter((s) => s.tabs.length)
        : [{ label: null, tabs: tabs.filter((t) => t !== TAB_MINE && t !== TAB_ALL) }];
    const end = ([TAB_ALL, TAB_MINE] as ReimbursementTab[]).filter(has);
    return [...middle.filter((s) => s.tabs.length), ...(end.length ? [{ label: null, tabs: end }] : [])];
}

/** Keyboard focus shows a ring; a mouse click leaves no outline. */
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1";

export function ReimbursementTabBar({ tabs, active, counts, grouped, onOpen }: Props) {
    const outerRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState<Layout>("full");

    // Which layout fits: the full row's natural width (an invisible copy, measured) against the bar's own width.
    useLayoutEffect(() => {
        const outer = outerRef.current;
        const measure = measureRef.current;
        if (!outer || !measure) return;
        const decide = () => {
            const width = outer.clientWidth;
            setLayout(width >= measure.scrollWidth ? "full" : width >= PICKER_BELOW ? "strip" : "picker");
        };
        decide();
        const observer = new ResizeObserver(decide);
        observer.observe(outer);
        observer.observe(measure);
        return () => observer.disconnect();
    }, [tabs, grouped]);

    const count = (t: ReimbursementTab) => counts[t];
    const badge = (t: ReimbursementTab, on: boolean) => count(t) !== undefined && (
        <b className={cn("rounded-full px-1.5 text-[11px] tabular-nums", on ? "bg-white/25" : "bg-black/10 dark:bg-white/10")}>
            {count(t)}
        </b>
    );
    const tone = (on: boolean) =>
        on ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-muted dark:text-foreground";

    /** The laptop tab: two-line label, count beside it. */
    const pill = (t: ReimbursementTab, interactive = true) => {
        const on = t === active;
        const [first, second] = TAB_LINES[t];
        return (
            <button
                key={t}
                type="button"
                role={interactive ? "tab" : undefined}
                aria-selected={interactive ? on : undefined}
                aria-label={TAB_LABELS[t]}
                tabIndex={interactive ? undefined : -1}
                onClick={interactive ? () => onOpen(t) : undefined}
                className={cn("flex h-11 shrink-0 items-center gap-2 rounded-md px-2.5 text-left transition-colors", FOCUS, tone(on))}
            >
                <span className="flex flex-col justify-center whitespace-nowrap text-[12.5px] font-medium leading-[1.15]">
                    <span>{first}</span>
                    {second && <span>{second}</span>}
                </span>
                {badge(t, on)}
            </button>
        );
    };

    /** The full laptop row; `interactive` false for the invisible copy that is only measured. */
    const fullRow = (interactive: boolean) => {
        const has = (t: ReimbursementTab) => tabs.includes(t);
        const inRow = tabs.filter((t) => t !== TAB_MINE && t !== TAB_ALL);
        return (
            <>
                {tabs.some((t) => t !== TAB_MINE) && (
                    <div className={cn("flex items-end", interactive && "flex-wrap", grouped ? "gap-3" : "gap-2")}>
                        {grouped
                            ? TAB_GROUPS.map(({ label, tabs: groupTabs }) => {
                                const shown = groupTabs.filter(has);
                                if (!shown.length) return null;
                                return (
                                    <fieldset key={label} className="flex items-center gap-1.5 border-0 border-t px-0 pb-0 pt-1">
                                        <legend className="ml-2 px-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                            {label}
                                        </legend>
                                        {shown.map((t) => pill(t, interactive))}
                                    </fieldset>
                                );
                            })
                            : inRow.map((t) => pill(t, interactive))}
                        {has(TAB_ALL) && (
                            <>
                                {grouped && <span className="mx-0.5 mb-1.5 h-8 w-px bg-border" aria-hidden="true" />}
                                {pill(TAB_ALL, interactive)}
                            </>
                        )}
                    </div>
                )}
                {/* Its own wrapper with ml-auto, at the right end. When it is the person's only tab (a claimant who
                    reviews nothing) it stays at the left: nothing to stand apart from. */}
                {has(TAB_MINE) && <div className={cn(tabs.length > 1 && "ml-auto")}>{pill(TAB_MINE, interactive)}</div>}
            </>
        );
    };

    const sections = sectionsOf(tabs, grouped);

    return (
        <div ref={outerRef} className="relative min-w-0">
            {/* Measured, never seen: the full row's natural width decides the layout. */}
            <div ref={measureRef} aria-hidden="true"
                className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max items-end gap-6 overflow-hidden whitespace-nowrap">
                {fullRow(false)}
            </div>

            {layout === "full" && (
                <div className="flex flex-wrap items-end gap-2" role="tablist" aria-label="Reimbursement tabs">
                    {fullRow(true)}
                </div>
            )}

            {layout === "strip" && (
                <TabStrip sections={sections} active={active} onOpen={onOpen} badge={badge} tone={tone} />
            )}

            {layout === "picker" && (
                <TabPicker sections={sections} active={active} onOpen={onOpen} count={count} />
            )}
        </div>
    );
}

/** Tablet: every tab in one row that scrolls sideways, group names inline, the open tab kept in view. */
function TabStrip({ sections, active, onOpen, badge, tone }: {
    sections: Section[];
    active: ReimbursementTab;
    onOpen: (tab: ReimbursementTab) => void;
    badge: (t: ReimbursementTab, on: boolean) => ReactNode;
    tone: (on: boolean) => string;
}) {
    const activeRef = useRef<HTMLButtonElement>(null);
    useLayoutEffect(() => {
        activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [active]);
    return (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="tablist" aria-label="Reimbursement tabs">
            {sections.map((section, i) => (
                <div key={section.label ?? `s${i}`} className={cn("flex shrink-0 items-center gap-1.5", i > 0 && "border-l pl-2")}>
                    {section.label && (
                        <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {section.label}
                        </span>
                    )}
                    {section.tabs.map((t) => {
                        const on = t === active;
                        return (
                            <button key={t} ref={on ? activeRef : undefined} type="button" role="tab" aria-selected={on}
                                aria-label={TAB_LABELS[t]} onClick={() => onOpen(t)}
                                className={cn("flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium transition-colors", FOCUS, tone(on))}>
                                {TAB_LINES[t].join(" ")}
                                {badge(t, on)}
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/** Phone: one button with the open tab and its count; the list holds every tab, grouped, with its count. */
function TabPicker({ sections, active, onOpen, count }: {
    sections: Section[];
    active: ReimbursementTab;
    onOpen: (tab: ReimbursementTab) => void;
    count: (t: ReimbursementTab) => number | undefined;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button type="button" aria-label={`Tab: ${TAB_LABELS[active]}. Change tab`}
                    className={cn("flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm font-semibold", FOCUS)}>
                    <span className="truncate">{TAB_LABELS[active]}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                        {count(active) !== undefined && (
                            <b className="rounded-full bg-sky-500 px-1.5 text-[11px] tabular-nums text-white">{count(active)}</b>
                        )}
                        <ChevronDown className="h-4 w-4 opacity-60" />
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1.5">
                <div role="listbox" aria-label="Reimbursement tabs" className="flex flex-col">
                    {sections.map((section, i) => (
                        <div key={section.label ?? `s${i}`} className={cn("flex flex-col", i > 0 && "mt-1 border-t pt-1")}>
                            {section.label && (
                                <span className="px-2 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {section.label}
                                </span>
                            )}
                            {section.tabs.map((t) => {
                                const on = t === active;
                                return (
                                    <button key={t} type="button" role="option" aria-selected={on}
                                        onClick={() => { onOpen(t); setOpen(false); }}
                                        className={cn("flex items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm", FOCUS,
                                            on ? "bg-sky-50 font-semibold text-sky-900 dark:bg-sky-950/40 dark:text-sky-200" : "hover:bg-muted")}>
                                        <span>{TAB_LABELS[t]}</span>
                                        {count(t) !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{count(t)}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

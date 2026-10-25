// src/pages/outflow-import/components/PorterProgressBar.tsx
//
// The Porter import's four-phase progress bar (#1556) and its one-line form for Import History. The words
// and tones are `porterProgress`'s; this file only paints them.

import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { type PhaseTone, type PorterProgress, historyChips, progressPhases } from "../porterProgress";

/** Done green, system working blue, a person's turn amber, blocked red. */
const PHASE_TONE: Record<PhaseTone, string> = {
    done: "bg-background text-foreground",
    running: "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
    needs: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
    blocked: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-200",
    current: "bg-background text-foreground",
    idle: "bg-background text-muted-foreground",
};

const MARK_TONE: Record<PhaseTone, string> = {
    done: "border-green-600 bg-green-600 text-white",
    running: "border-blue-600 text-blue-600",
    needs: "border-amber-600 bg-amber-600 text-white",
    blocked: "border-red-600 bg-red-600 text-white",
    current: "border-primary bg-primary text-primary-foreground",
    idle: "border-border text-muted-foreground",
};

const CHIP_TONE: Record<PhaseTone, string> = {
    done: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200",
    needs: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
    blocked: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200",
    current: "bg-muted text-muted-foreground",
    idle: "bg-muted text-muted-foreground",
};

const PhaseMark = ({ tone, step }: { tone: PhaseTone; step: number }) => (
    <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${MARK_TONE[tone]}`}
        aria-hidden
    >
        {tone === "done" ? (
            <Check className="h-3 w-3" />
        ) : tone === "running" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
        ) : tone === "needs" || tone === "blocked" ? (
            <AlertTriangle className="h-2.5 w-2.5" />
        ) : (
            step
        )}
    </span>
);

/** The bar at the top of the Porter dialog; `progress` is null before anything is uploaded. */
export const PorterProgressBar = ({ progress }: { progress: PorterProgress | null | undefined }) => (
    <ol
        aria-label="Import progress"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4"
        data-testid="porter-progress"
    >
        {/* `gap-px` over `bg-border` draws the dividers at both widths (2×2 on a phone, 4 across). */}
        {progressPhases(progress).map((phase, index) => (
            <li
                key={phase.key}
                data-tone={phase.tone}
                className={`grid min-w-0 content-start gap-0.5 px-2.5 py-2 ${PHASE_TONE[phase.tone]}`}
            >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <PhaseMark tone={phase.tone} step={index + 1} />
                    {phase.title}
                </span>
                <span className="text-[11.5px] tabular-nums opacity-90">{phase.counts}</span>
            </li>
        ))}
    </ol>
);

/** One line of chips for a Porter row in Import History: the same phases, the same colours. */
export const PorterProgressChips = ({ progress }: { progress: PorterProgress }) => (
    <div className="mt-1 flex flex-wrap gap-1" aria-label="Import progress">
        {historyChips(progress).map(({ tone, label }, index) => (
            <span
                key={index}
                data-tone={tone}
                className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${CHIP_TONE[tone]}`}
            >
                {tone === "done" ? "✓ " : ""}
                {label}
            </span>
        ))}
    </div>
);

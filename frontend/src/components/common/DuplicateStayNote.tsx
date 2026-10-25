// src/pages/ExpenseRequests/components/DuplicateStayNote.tsx
//
// Another stay for the same person on overlapping dates (spec #1494, #1504). Never blocks.
//
//   "warning"  bold, with every match listed: the Reviewer, and a raiser on Records without
//              review before submit (they act as their own reviewer).
//   "note"     one quiet line: any other raiser, whose reviewer will see the warning.
//
// The matches come from the server (`duplicates.find_stay_duplicates`); this only renders them.

import React from "react";
import { AlertTriangle } from "lucide-react";

import { formatDate } from "@/utils/FormatDate";
import type { StayDuplicate } from "@/types/NirmaanStack/ExpenseRequest";
import RequestHoverCard from "./RequestHoverCard";

interface Props {
    matches: StayDuplicate[];
    variant: "warning" | "note";
}

export const DuplicateStayNote: React.FC<Props> = ({ matches, variant }) => {
    if (!matches.length) return null;

    if (variant === "note") {
        return (
            <p className="text-xs text-muted-foreground">
                This stay overlaps another expense for the same person. Your reviewer will see it.
            </p>
        );
    }

    return (
        <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
        >
            <p className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Possible duplicate. Check this is a valid request
            </p>
            <ul className="mt-1.5 space-y-1">
                {matches.map((m) => (
                    <li key={m.request}>
                        <RequestHoverCard info={{
                            name: m.request, status: m.status, type: m.type,
                            project: m.project_name || m.projects, amount: m.amount,
                            raisedBy: m.owner_name, creation: m.creation, detail: m.detail,
                        }}>
                            <span className="font-semibold">{m.request}</span>
                        </RequestHoverCard>
                        {m.expense && <span className="text-xs"> ({m.expense.name})</span>}
                        {": "}
                        {m.person}, {formatDate(m.period_from)} to {formatDate(m.period_to)}
                        <span className="text-amber-800 dark:text-amber-300">
                            {" · "}{m.status}{m.project_name || m.projects ? ` · ${m.project_name || m.projects}` : ""}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default DuplicateStayNote;

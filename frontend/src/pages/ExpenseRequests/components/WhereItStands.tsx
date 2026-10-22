// src/pages/ExpenseRequests/components/WhereItStands.tsx
//
// The request page's step-by-step view (#1500): Raised -> Review (or Approved on submit) ->
// Admin approval if needed -> CEO approval if needed -> Paid. The steps, which are needed and which
// is current, come from the server (`services/expense_standing.where_it_stands`); this only draws
// them.

import React from "react";
import { Check, Circle, Clock, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import type { StandingStep } from "@/types/NirmaanStack/ExpenseRequest";

const MARK: Record<StandingStep["state"], { icon: React.ReactNode; ring: string; text: string }> = {
    done: { icon: <Check className="h-3.5 w-3.5" />, ring: "bg-emerald-600 text-white border-emerald-600", text: "" },
    current: { icon: <Clock className="h-3.5 w-3.5" />, ring: "bg-amber-50 text-amber-700 border-amber-500", text: "font-semibold" },
    upcoming: { icon: <Circle className="h-2 w-2" />, ring: "bg-white text-gray-300 border-gray-300", text: "text-muted-foreground" },
    rejected: { icon: <X className="h-3.5 w-3.5" />, ring: "bg-red-600 text-white border-red-600", text: "text-red-700 font-semibold" },
};

interface Props {
    steps: StandingStep[];
    getUserName: (id: string | undefined) => string;
}

/** A vertical stepper of where one expense stands. */
export const WhereItStands: React.FC<Props> = ({ steps, getUserName }) => (
    <ol aria-label="Where it stands" className="flex flex-col">
        {steps.map((step, i) => {
            const mark = MARK[step.state];
            const last = i === steps.length - 1;
            const meta = [
                step.by ? `by ${getUserName(step.by)}` : "",
                step.on ? `on ${formatDate(step.on)}` : "",
            ].filter(Boolean).join(" ");
            return (
                <li key={step.key} className="flex gap-3" data-state={step.state}>
                    <div className="flex flex-col items-center">
                        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", mark.ring)}>
                            {mark.icon}
                        </span>
                        {!last && <span className="w-px flex-1 bg-gray-200 my-1 min-h-[1rem]" />}
                    </div>
                    <div className={cn("pb-4", last && "pb-0")}>
                        <div className={cn("text-sm leading-6", mark.text)}>
                            {step.label}
                            {step.state === "current" && (
                                <span className="ml-2 text-xs font-normal text-amber-700">Now</span>
                            )}
                        </div>
                        {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
                        {step.note && <div className="text-xs text-muted-foreground">{step.note}</div>}
                    </div>
                </li>
            );
        })}
    </ol>
);

export default WhereItStands;

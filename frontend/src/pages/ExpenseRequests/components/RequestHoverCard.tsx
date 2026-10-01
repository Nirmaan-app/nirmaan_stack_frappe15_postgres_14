// src/pages/ExpenseRequests/components/RequestHoverCard.tsx
//
// Hover (long-press on touch) a request ID to see what it asked for. ONE card, used by the
// create dialog's duplicate note and by the list's Request ID cell.
//
// `detail` is the request's answers LABELLED BY ITS OWN FORM, built on the server by the same
// walk as the approval dialog and the ledger line -- this card only renders it, and never
// knows a field name. Absent detail still shows the header, never an empty card.

import React from "react";
import { Portal as HoverCardPortal } from "@radix-ui/react-hover-card";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

export interface RequestHoverInfo {
    name: string;
    status?: string;
    type?: string;
    projects?: string | null;
    amount?: number | string;
    raisedBy?: string;
    creation?: string;
    detail?: { label: string; value: string }[];
}

// Answers are stored as ISO dates; everything on screen reads dd-MMM-yyyy.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const show = (v: string) => (ISO_DATE.test(v) ? formatDate(v) : v);

export const RequestHoverCard: React.FC<{ info: RequestHoverInfo; children: React.ReactNode }> = ({
    info, children,
}) => (
    <HoverCard>
        <HoverCardTrigger asChild>
            <span className="cursor-help underline decoration-dotted underline-offset-2">{children}</span>
        </HoverCardTrigger>
        {/* Portalled: inside the create dialog (scrolling, transformed) an in-place card is
            clipped. The body sits above the dialog in paint order. */}
        <HoverCardPortal>
        <HoverCardContent className="w-80 text-xs" align="start">
            <div className="font-medium text-sm">
                {info.name}{info.status ? ` · ${info.status}` : ""}
            </div>
            <div className="text-muted-foreground">
                {[info.type, info.projects,
                  info.amount != null && info.amount !== "" ? formatToRoundedIndianRupee(Number(info.amount)) : ""]
                    .filter(Boolean).join(" · ")}
            </div>
            {(info.raisedBy || info.creation) && (
                <div className="text-muted-foreground">
                    Raised{info.raisedBy ? ` by ${info.raisedBy}` : ""}
                    {info.creation ? ` on ${formatDate(info.creation)}` : ""}
                </div>
            )}
            {!!info.detail?.length && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-2">
                    {info.detail.map((d, i) => (
                        <React.Fragment key={i}>
                            <dt className="text-muted-foreground">{d.label}</dt>
                            <dd className="break-words">{show(String(d.value ?? ""))}</dd>
                        </React.Fragment>
                    ))}
                </dl>
            )}
        </HoverCardContent>
        </HoverCardPortal>
    </HoverCard>
);

export default RequestHoverCard;

// src/pages/tds/components/cells.tsx
//
// Shared cell/badge building blocks for the TDS Repository UI. The master page,
// the detail page, and the quick-peek dialogs all render these so badges and
// cells stay visually identical. Callers control outer alignment — these
// components return the bare element (no flex wrapper), per the Phase-1 revamp.

import React from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── StatusBadge ─────────────────────────────────────────────────────────────
// Ring-inset pill. "Verified" → emerald; anything else → rose. Returns just the
// <span> (no outer flex justify-center — the caller controls alignment).
export const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
    const value = status || "Not Verified";
    const isVerified = value === "Verified";
    const cls = isVerified
        ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
        : "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20";
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${cls}`}
        >
            {value}
        </span>
    );
};

// ─── AttachmentCell ──────────────────────────────────────────────────────────
// Ghost icon button opening `url` in a new tab; greyed + disabled when absent.
export const AttachmentCell: React.FC<{ url?: string }> = ({ url }) => {
    const fileName = url ? url.split("/").pop() : "";
    return (
        <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${url ? "text-blue-600 hover:text-blue-800 hover:bg-blue-50" : "text-gray-300 cursor-not-allowed"}`}
            onClick={() => url && window.open(url, "_blank")}
            title={url ? fileName : "No Attachment"}
            disabled={!url}
        >
            <FileText className="h-4 w-4" />
        </Button>
    );
};

// ─── CountPill ───────────────────────────────────────────────────────────────
// A clickable count chip:
//   • count > 0           → interactive ring-bordered button (with optional icon)
//   • count === 0 + zeroLabel → non-interactive amber pill (e.g. "Custom")
//   • count === 0, no zeroLabel → muted "0" span
export interface CountPillProps {
    count: number;
    icon?: React.ComponentType<{ className?: string }>;
    onClick?: () => void;
    zeroLabel?: string;
    title?: string;
    className?: string;
}

export const CountPill: React.FC<CountPillProps> = ({
    count,
    icon: Icon,
    onClick,
    zeroLabel,
    title,
    className,
}) => {
    if (count > 0) {
        return (
            <button
                type="button"
                onClick={onClick}
                title={title}
                className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-medium tabular-nums ring-1 ring-inset ring-slate-200 text-slate-700 hover:ring-[#dc2626]/40 hover:text-[#dc2626] transition-colors",
                    className
                )}
            >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {count}
            </button>
        );
    }

    if (zeroLabel) {
        return (
            <span
                title={title}
                className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
                    className
                )}
            >
                {zeroLabel}
            </span>
        );
    }

    return (
        <span title={title} className={cn("text-slate-400 text-sm tabular-nums", className)}>
            0
        </span>
    );
};

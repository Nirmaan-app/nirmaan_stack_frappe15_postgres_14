// src/pages/outflow-import/components/PorterFileChecks.tsx

import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";

import { formatDate } from "@/utils/FormatDate";

import { porterFileCheckLines, type PorterFileCheck } from "../porterPrecheck";

/**
 * What the browser found in the chosen Porter file before upload (#1555): the counts of an accepted file,
 * why it was refused, or a short note that it could not be checked here. `null` while the file is being read.
 */
export const PorterFileChecks = ({ check }: { check: PorterFileCheck | null }) => {
    if (!check)
        return (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the file…
            </p>
        );
    if (check.kind === "refused")
        return (
            <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{check.message}</span>
            </div>
        );
    if (check.kind === "skipped")
        return (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {check.message}
            </p>
        );
    return (
        <ul className="space-y-1 text-sm">
            {porterFileCheckLines(check, formatDate).map((line) => (
                <li key={line} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    {line}
                </li>
            ))}
        </ul>
    );
};

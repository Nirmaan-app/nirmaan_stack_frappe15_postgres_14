/**
 * "Someone else changed this record" -- handled INSIDE an edit dialog, for any doctype.
 *
 * A save refused because someone saved the record first (TimestampMismatchError) no longer closes
 * the dialog. A banner says who changed the record and what changed; the form takes the other
 * person's values for every field the user did NOT touch and keeps what the user typed
 * (`keepTyped`); the next save carries the LATEST `modified`. So "Save again" saves both people's
 * work -- it can no longer write the user's stale copy of a field they never edited over someone
 * else's change. Other save errors are left to the dialog.
 *
 * No per-doctype setup: the changed fields are found by comparing the version the form was opened
 * on with the latest one, field by field. A dialog wires it in with four lines, given the pure
 * `formFrom(record)` it already uses to fill its form:
 *
 *   const stale = useStaleConflict({ doctype, record, open });   // the hook
 *   ...{ ...changes, ...stale.guard() }                          // in the save payload
 *   if (await stale.handle(error, latest => setForm(f => keepTyped(f, formFrom(record), formFrom(latest))))) return;
 *   <StaleConflictBanner conflict={stale.conflict} />             // in the dialog body
 */
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDate } from "@/utils/FormatDate";
import { isStaleRecordError, STALE_RECORD_MESSAGE, staleConflictMessage, staleGuard } from "@/utils/frappeErrors";

export interface StaleConflict {
    /** "Nitesh Kumar changed this record at 29 Sep, 12:40 PM." */
    headline: string;
    /** "Amount: 20,000 → 45,000" per changed field. */
    changes: string[];
    /** The latest version's `modified`: the next save is applied on top of it. */
    modified?: string;
}

type AnyRecord = { name: string; modified?: string | null } & Record<string, any>;

/** Frappe's own bookkeeping fields: never something a user changed. */
const SYSTEM_FIELDS = new Set(["name", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "doctype"]);

const DATE = /^\d{4}-\d{2}-\d{2}/;

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** "payment_ref" -> "Payment ref" */
const labelOf = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const sameValue = (a: unknown, b: unknown) => {
    if (isBlank(a) && isBlank(b)) return true;
    if (isBlank(a) || isBlank(b)) return false;
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
    const sa = String(a).trim();
    const sb = String(b).trim();
    return DATE.test(sa) && DATE.test(sb) ? sa.slice(0, 10) === sb.slice(0, 10) : sa === sb;
};

const shown = (v: unknown, label?: (v: string) => string) => {
    if (isBlank(v)) return "(empty)";
    if (typeof v === "number") return v.toLocaleString("en-IN");
    const text = String(v).trim();
    if (label) return label(text);
    if (DATE.test(text)) return formatDate(text.slice(0, 10));
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

/**
 * One line per field that differs between the version opened and the latest one. PURE.
 * Skips system fields, private (`_`) fields, child tables and fields the screen never loaded;
 * an attachment is named as
 * added / removed / replaced, never by its URL.
 */
export const describeChanges = (
    opened: Record<string, any>,
    latest: Record<string, any>,
    labels: Record<string, (v: string) => string> = {}
): string[] =>
    Object.keys(latest).flatMap((key) => {
        if (SYSTEM_FIELDS.has(key) || key.startsWith("_")) return [];
        // A field the screen never loaded (a list query fetches only some columns) cannot be
        // judged "changed" -- it would read as empty on the opened side and look like a change.
        if (!(key in opened)) return [];
        const before = opened[key];
        const after = latest[key];
        if (typeof after === "object" && after !== null) return []; // child tables / JSON
        if (sameValue(before, after)) return [];
        if (key.endsWith("_attachment")) {
            return [`${labelOf(key)}: ${isBlank(before) ? "added" : isBlank(after) ? "removed" : "replaced"}`];
        }
        return [`${labelOf(key)}: ${shown(before, labels[key])} → ${shown(after, labels[key])}`];
    });

/**
 * The form to show after a conflict: each field the user left as it was opened takes the latest
 * value; each field the user edited keeps their typing. PURE. `opened` / `latest` are the same
 * record-to-form mapping the dialog uses to fill itself, so the keys and formats line up.
 */
export const keepTyped = <F extends Record<string, any>>(current: F, opened: Partial<F>, latest: Partial<F>): F => {
    const next = { ...current };
    for (const key of Object.keys(latest) as (keyof F)[]) {
        if (current[key] === opened[key]) next[key] = latest[key] as F[keyof F];
    }
    return next;
};

const fetchLatest = async (doctype: string, name: string): Promise<AnyRecord | null> => {
    try {
        const res = await fetch(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
        return res.ok ? (await res.json())?.data ?? null : null;
    } catch {
        return null;
    }
};

interface Options {
    doctype: string;
    /** The record the form was loaded from. */
    record: AnyRecord | null | undefined;
    /** Whether the dialog is open; closing it forgets the conflict. */
    open: boolean;
    /** Optional readable names for id-valued fields, e.g. `{ vendor: id => vendorName }`. */
    labels?: Record<string, (v: string) => string>;
}

export const useStaleConflict = ({ doctype, record, open, labels }: Options) => {
    const [conflict, setConflict] = useState<StaleConflict | null>(null);

    // Read inside `handle` only; a ref so an inline `labels` never re-creates it.
    const labelsRef = useRef(labels);
    labelsRef.current = labels;

    const name = record?.name;
    useEffect(() => {
        setConflict(null);
    }, [open, name]);

    /** Spread into the save payload. */
    const guard = useCallback(
        () => (conflict?.modified ? { modified: conflict.modified } : staleGuard(record)),
        [conflict, record]
    );

    /**
     * On a "someone else saved first" refusal: show the banner, hand the latest record to
     * `onLatest` (to refresh the untouched fields), and return true -- keep the dialog open.
     */
    const handle = useCallback(
        async (error: unknown, onLatest?: (latest: AnyRecord) => void): Promise<boolean> => {
            if (!record || !isStaleRecordError(error)) return false;
            const [message, latest] = await Promise.all([
                staleConflictMessage(doctype, record.name),
                fetchLatest(doctype, record.name),
            ]);
            setConflict({
                // The server's sentence ends "…after you opened it. Refresh and try again." -- keep who and when.
                headline: (message || STALE_RECORD_MESSAGE).replace(/,?\s*after you opened it\..*$/, "."),
                changes: latest ? describeChanges(record, latest, labelsRef.current) : [],
                modified: latest?.modified ?? undefined,
            });
            if (latest) onLatest?.(latest);
            return true;
        },
        [doctype, record]
    );

    return { conflict, guard, handle };
};

export const StaleConflictBanner = ({ conflict }: { conflict: StaleConflict | null }) => {
    if (!conflict) return null;
    return (
        <Alert variant="warning" className="text-sm">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{conflict.headline}</AlertTitle>
            <AlertDescription className="space-y-1.5">
                {conflict.changes.length > 0 && (
                    <ul className="list-disc pl-4">
                        {conflict.changes.map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                )}
                <p>The form now shows their changes, and keeps what you typed. Check it, then click Save again.</p>
            </AlertDescription>
        </Alert>
    );
};

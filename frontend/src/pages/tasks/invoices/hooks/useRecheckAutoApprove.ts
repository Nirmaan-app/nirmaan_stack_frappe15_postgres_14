/**
 * Re-run the auto-approve gates on Pending invoices, preview first.
 *
 * Only the two PO-value ceilings are re-evaluated (owner ruling) — they are the
 * only gates reading data that keeps moving after the invoice is filed. A PO
 * delivered later still carries `nothing_delivered_yet`, and its invoice still
 * sits in the queue. Every other stored reason is carried through untouched,
 * and invoices that are not ceiling candidates never enter a run at all.
 *
 * PREVIEW IS NOT OPTIONAL. Every entry point runs `dry_run` first and shows the
 * result before anything is written — on the current queue one press moves
 * ~₹24L across ~39 invoices, which is not something to discover after the fact.
 * `apply` then re-runs the SAME SCOPE for real rather than replaying the
 * preview's verdict, so a delivery recorded between the two is picked up
 * instead of acted on stale. The applied result is what the dialog reports.
 *
 * Thin over the endpoint, per ADR-0010 F4 — the tiering and wording live in the
 * pure `autoApproveReasons` module, and the summarising lives in the backend.
 */
import { useCallback, useState } from "react";
import { useFrappePostCall, useSWRConfig } from "frappe-react-sdk";

import { useToast } from "@/components/ui/use-toast";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import {
    API_RECHECK_AUTO_APPROVE,
    API_RECHECK_PENDING_QUEUE,
} from "../constants";

/** What a re-check did to one invoice. Mirrors `_outcome()` in the endpoint. */
export type RecheckOutcome = "approved" | "cleared" | "blocked" | "failed";

export interface RecheckResultRow {
    invoice_id: string;
    document_type?: string;
    document_name?: string;
    invoice_no?: string | null;
    invoice_amount: number;
    vendor?: string | null;
    /** Reason tokens the row carried going in. */
    before: string[];
    /** Reason tokens it carries coming out — empty when approved. */
    after: string[];
    cleared: string[];
    outcome: RecheckOutcome;
    /** The figures the two checks compared — the evidence behind the verdict. */
    po_total: number | null;
    po_delivered: number | null;
    cumulative: number | null;
    detail?: string | null;
}

export interface RecheckResponse {
    status: number;
    dry_run: boolean;
    checked: number;
    /** How many candidates the sweep cap left out. 0 in the normal case. */
    truncated: number;
    counts: Record<RecheckOutcome, number>;
    approved_value: number;
    results: RecheckResultRow[];
}

/**
 * What a run covers. Held from preview through to apply so the two can never
 * target different sets.
 */
export type RecheckScope =
    | { kind: "queue" }
    | { kind: "invoices"; ids: string[] };

interface UseRecheckAutoApproveProps {
    /** Called after a successful apply — refetch the table here. */
    onApplied?: () => void;
}

export const useRecheckAutoApprove = ({
    onApplied,
}: UseRecheckAutoApproveProps = {}) => {
    const { toast } = useToast();
    const { mutate: globalMutate } = useSWRConfig();

    const [scope, setScope] = useState<RecheckScope | null>(null);
    const [preview, setPreview] = useState<RecheckResponse | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isApplying, setIsApplying] = useState(false);

    const { call: callQueue } = useFrappePostCall(API_RECHECK_PENDING_QUEUE);
    const { call: callInvoices } = useFrappePostCall(API_RECHECK_AUTO_APPROVE);

    const run = useCallback(
        async (target: RecheckScope, dryRun: boolean): Promise<RecheckResponse> => {
            const response =
                target.kind === "queue"
                    ? await callQueue({ dry_run: dryRun })
                    : await callInvoices({
                          invoice_ids: target.ids,
                          dry_run: dryRun,
                      });
            const payload = response?.message as RecheckResponse | undefined;
            if (!payload || payload.status !== 200) {
                throw new Error("Re-check failed. Please try again.");
            }
            return payload;
        },
        [callQueue, callInvoices]
    );

    /** Step 1 — evaluate and report, writing nothing. */
    const startPreview = useCallback(
        async (target: RecheckScope) => {
            setIsPreviewing(true);
            setScope(target);
            try {
                setPreview(await run(target, true));
            } catch (error) {
                setScope(null);
                toast({
                    title: "Re-check failed",
                    description:
                        error instanceof Error
                            ? error.message
                            : "An unexpected error occurred.",
                    variant: "destructive",
                });
            } finally {
                setIsPreviewing(false);
            }
        },
        [run, toast]
    );

    /** Step 2 — re-run the same scope for real. */
    const applyRecheck = useCallback(async () => {
        if (!scope) return;
        setIsApplying(true);
        try {
            const result = await run(scope, false);
            const approved = result.counts.approved ?? 0;
            const stayed = (result.counts.cleared ?? 0) + (result.counts.blocked ?? 0);
            // The dialog closes on success, so this toast is the ONLY report of
            // what actually happened — it carries the applied numbers, which can
            // differ from the preview if a delivery landed in between.
            toast({
                title: approved > 0 ? "Invoices auto-approved" : "Re-check applied",
                description:
                    approved > 0
                        ? `${approved} invoice${
                              approved === 1 ? "" : "s"
                          } approved · ${formatToRoundedIndianRupee(
                              result.approved_value
                          )}${stayed > 0 ? ` · ${stayed} still pending` : ""}`
                        : "Reasons updated. Nothing could be auto-approved.",
                variant: approved > 0 ? "success" : "default",
            });
            // Approvals move money into the Approved-only totals the recon
            // screens read, so the shared cache has to drop with the table.
            globalMutate("Recon-Total-Invoiced-By-Document");
            onApplied?.();
        } catch (error) {
            toast({
                title: "Re-check failed",
                description:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setIsApplying(false);
        }
    }, [scope, run, toast, globalMutate, onApplied]);

    const reset = useCallback(() => {
        setScope(null);
        setPreview(null);
    }, []);

    return {
        /** The dry-run result awaiting confirmation, or null. */
        preview,
        scope,
        isPreviewing,
        isApplying,
        startPreview,
        applyRecheck,
        reset,
    };
};

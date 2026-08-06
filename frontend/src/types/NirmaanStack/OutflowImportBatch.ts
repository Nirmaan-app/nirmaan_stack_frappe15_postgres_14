/**
 * Bulk Import Outflow -- the uploaded bank statement batch.
 *
 * Mirrors the `Outflow Import Batch` doctype. `name` is required by `useServerDataTable`, which is
 * declared `<TData extends { name: string }>`.
 *
 * The counters are DENORMALISED and derived server-side by
 * `services/outflow_import/status.py` -- never recompute them in the client, or the list page and
 * the review screen will disagree about how much of a batch is done.
 */
export interface OutflowImportBatch {
    name: string;
    creation: string;
    modified: string;
    owner: string;

    /** Which outflow channel the statement came from. */
    source: "Cashfree" | "Cashbook";
    /** The stored CSV. Attached to the BATCH and only the batch (owner ruling R3). */
    source_file?: string;
    original_filename?: string;

    /** Derived from the statement's own min/max transaction date, never entered. */
    period_from?: string;
    period_to?: string;
    /** An earlier batch whose period overlaps. A WARNING only -- it never blocks an upload. */
    overlaps_batch?: string;

    status:
        | "Draft"
        | "In Review"
        | "Partially Settled"
        | "Completed"
        | "Completed with exceptions";

    total_rows?: number;
    reviewed_rows?: number;
    reconciled_rows?: number;
    settled_rows?: number;
    skipped_rows?: number;
    exception_rows?: number;
    error_rows?: number;

    /** Sum of the beneficiary amounts on SUCCESSFUL rows. Excludes gateway charges. */
    gross_amount?: number;
    /** Gateway charge + tax across EVERY row -- money that left the bank and belongs to no row. */
    charges_amount?: number;
    /** Set only if the charges were booked as a non-project expense (opt-in). */
    charges_expense?: string;

    uploaded_by?: string;
    uploaded_at?: string;

    /**
     * Set when someone closed the batch with rows still undecided. ITS PRESENCE IS THE FLAG --
     * it is what makes the derived status "Completed with exceptions". Closing is not a freeze:
     * abandoned rows keep their status and can still be settled.
     */
    closed_at?: string;
    closed_by?: string;
    close_reason?: string;
}

/** A match recorded between a bank row and a target. `Reconciled` means nothing was written. */
export interface OutflowRowMatch {
    import_row: string;
    target_doctype: string;
    target_name: string;
    target_amount: number;
    match_kind: "Reconciled" | "Settled";
    match_basis: "Bank reference" | "Vendor+amount+date" | "Manual";
}

/** One staged transfer, as `get_batch_rows` returns it. */
export interface OutflowImportRow {
    name: string;
    transfer_id: string;
    reference_id?: string;
    added_on?: string;
    amount: number;
    status_raw?: string;
    beneficiary_name?: string;
    beneficiary_id?: string;
    bank_account?: string;
    ifsc?: string;
    remarks?: string;
    bank_reference_no?: string;
    service_charge: number;
    service_tax: number;
    added_by_raw?: string;
    normalized_account?: string;
    normalized_reference?: string;
    resolved_vendor?: string;
    resolved_project?: string;
    row_status: string;
    skip_reason?: string;
    outcome_note?: string;
    matches: OutflowRowMatch[];
}

/** Ranked candidates for one row, fetched on demand when a reviewer opens it. */
export interface OutflowRowCandidates {
    row: string;
    vendor_candidates: {
        vendor: string;
        vendor_name: string;
        account_name: string;
        score: number;
        basis: string;
        reasons: string[];
    }[];
    vendor_ambiguous: boolean;
    payment_groups: {
        basis: string;
        is_fan_out: boolean;
        total_amount: number;
        targets: {
            doctype: string;
            name: string;
            amount: number;
            status: string;
            reference: string;
            project: string | null;
        }[];
    }[];
    expense_candidates: {
        doctype: string;
        name: string;
        amount: number;
        status: string;
        project: string | null;
        description: string;
        score: number;
        reasons: string[];
    }[];
}

/** The batch's read-only findings plus the payments this statement does not account for. */
export interface OutflowReconciliationReport {
    batch: string;
    period_from: string | null;
    period_to: string | null;
    counters: Record<string, number>;
    status: string;
    exceptions: {
        name: string;
        transfer_id: string;
        amount: number;
        beneficiary_name: string;
        row_status: string;
        outcome_note: string;
    }[];
    unmatched_payments: {
        name: string;
        amount: number;
        utr: string | null;
        payment_date: string | null;
        project: string | null;
        vendor_name: string | null;
    }[];
    unmatched_payment_total: number;
}

/** The payload `upload_outflow_statement` returns. */
export interface OutflowUploadResult {
    batch: string;
    source: string;
    period_from: string | null;
    period_to: string | null;
    status: string;
    total_rows: number;
    skipped_rows: number;
    gross_amount: number;
    charges_amount: number;
    overlaps_batch: string | null;
    warnings: string[];
    duplicate_transfer_ids: string[];
}

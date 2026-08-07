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

    status: "Draft" | "In Review" | "Partially Settled" | "Completed";

    total_rows?: number;
    reviewed_rows?: number;
    settled_rows?: number;
    skipped_rows?: number;
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
     * Set when someone closed the batch with rows still undecided.
     *
     * ⚠️ v3: this no longer changes the derived status. "Completed with exceptions" is retired, so
     * a batch closed with work outstanding reads "Partially Settled" and the three tabs show which
     * rows are outstanding. Closing is bookkeeping, not a freeze: abandoned rows keep their status
     * and can still be settled.
     */
    closed_at?: string;
    closed_by?: string;
    close_reason?: string;
}

/**
 * A settlement recorded between a bank row and the record it paid.
 *
 * ⚠️ v3: this table records SETTLEMENTS ONLY. `Reconciled` -- the v2 kind meaning "matched, nothing
 * written" -- is retired, and a match run no longer writes here at all. A row in this table means
 * money was written. The suggestion a reviewer is looking at lives in `outcome_note`, and full
 * candidate details are loaded on demand by `get_row_candidates`.
 */
export interface OutflowRowMatch {
    import_row: string;
    target_doctype: string;
    target_name: string;
    target_amount: number;
    match_kind: "Settled";
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
    /**
     * The ONE record the match run suggests this transfer settled, or blank.
     *
     * ⚠️ Written by the match run, never by the screen, and blanked on every re-run that no longer
     * finds a single candidate. Blank is the normal case: no candidate, SEVERAL candidates (the
     * screen never guesses between two real records), or a fan-out, which has no single name.
     * It is a SUGGESTION, not a decision -- a person still confirms it.
     */
    suggested_doctype?: string;
    suggested_name?: string;
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

/** The payload `upload_outflow_statement` returns. */
/**
 * What importing this statement WOULD do, from `preview_outflow_statement`. Nothing is written to
 * produce it, and the browser re-posts the same file to confirm (slice V3).
 *
 * ⚠️ `refused` and `warn` are DIFFERENT OUTCOMES, never one flag. `refused` means the confirm
 * button must not be offered at all -- every transfer was already imported, so there is nothing to
 * create. `warn` means it MUST still be offered: a warning never blocks (owner ruling Q2).
 */
export interface OutflowPreviewResult {
    preview: true;
    source: string;
    original_filename: string;
    period_from: string | null;
    period_to: string | null;
    total_rows: number;
    successful_rows: number;
    failed_rows: number;
    gross_amount: number;
    charges_amount: number;
    duplicate_rows: number;
    new_rows: number;
    duplicate_message: string;
    refused: boolean;
    warn: boolean;
    duplicate_of_batch: string | null;
    overlaps_batch: string | null;
    warnings: string[];
    duplicate_transfer_ids: string[];
}

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

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
     * Set when someone closed the batch, back when closing existed.
     *
     * ⚠️ HISTORICAL ONLY (owner ruling 2026-08-10). The Close Import action is gone: it wrote these
     * three fields and nothing read them, and once an import stopped being a place to visit,
     * "closing" one marked nothing as finished with. Retained on the doctype so the history of
     * batches closed before then survives; no endpoint writes them and no endpoint returns them.
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
    /**
     * The ORDER this payment is against (`Project Payments.document_name`), stamped server-side so
     * the screen can use the app's own `/project-payments/<order>` route (slice E3).
     *
     * ⚠️ PAYMENTS ONLY, and blank when the payment carries no order. Absent means the link falls
     * back to the older search-param scheme rather than disappearing -- see `settlementLink`.
     */
    order_name?: string;
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
    /**
     * Already-Paid payments this row's bank reference points at — the records behind a
     * "Already recorded as Paid on …" skip, and behind a `Mismatched` row.
     *
     * ⚠️ NOT a settlement and NOT a suggestion. The row settled nothing, so it has no
     * `Outflow Row Match` record, and it carries no stored suggestion either. Derived server-side in
     * `get_batch_rows` from the same loader the duplicate guard uses, so the screen can link the
     * payment its note only names in prose.
     */
    related_payments?: {
        target_doctype: string;
        target_name: string;
        /** The order this payment is against, for the app's own route (slice E3). */
        order_name?: string;
    }[];
    /**
     * The order behind `suggested_name`, for the app's own route (slice E3).
     *
     * ⚠️ ITS OWN KEY BECAUSE THE SUGGESTION IS NOT A LIST. `matches` and `related_payments` carry
     * their order stamped onto each entry; the suggestion is two scalar columns on the row, so
     * there is no entry to stamp.
     */
    suggested_order_name?: string;
    /**
     * Whether this settlement took the matcher's pick: "Suggestion accepted" / "Suggestion
     * overridden" / "No suggestion". Blank until the row is settled (slice Q1).
     *
     * ⚠️ NOT `auto_matched`, which means only that a suggestion EXISTED and says nothing about
     * whether a person accepted it. Denormalised from `Outflow Row Match` so the table can filter
     * and count on it without a join.
     */
    settlement_origin?: string;
    /** Denormalised from the batch, so the table can filter by source without a join. */
    source?: string;
    /**
     * Which import staged this row.
     *
     * ⚠️ `import_batch` HAS ALWAYS EXISTED ON THE DOCTYPE; what is new at X3 is that the SCREEN
     * reads it. The batch page showed one import and had no use for it. The master table spans
     * every import, so the row has to say where it came from -- and the filename is what a person
     * recognises, which is why the endpoint joins it in rather than making the client resolve ids.
     */
    import_batch?: string;
    import_filename?: string;
    import_period_from?: string;
    import_period_to?: string;
}

/** One page of `review.get_outflow_rows`. */
export interface OutflowRowsPage {
    rows: OutflowImportRow[];
    total: number;
    limit: number;
    offset: number;
    scope: string;
    /**
     * Rows per tab UNDER THE CURRENT FILTERS -- not over the whole table.
     *
     * ⚠️ KEYED BY SCOPE NAME, which is not the tab id -- `SCOPE_FOR_TAB` is the one place the two
     * vocabularies meet. `all` EXCLUDES `Skipped`, exactly as the tab does (owner ruling
     * 2026-08-10); there is no skipped count here because there is no skipped tab, and the import
     * summary panel reports them instead.
     */
    /**
     * ⚠️ `skipped` IS A SCOPE WITH NO TAB (owner ruling). The three working scopes label the tab
     * strip; `skipped` exists so the Skipped chip's dialog can ask for those rows by name, and it
     * is deliberately absent from `SCOPE_FOR_TAB` — there is no tab to map to it.
     */
    tab_counts: { all: number; not_matched: number; matched: number; skipped: number };
    /**
     * The SAME population as `tab_counts`, broken down by status instead of by tab.
     *
     * ⚠️ IT EXISTS BECAUSE ONE TAB HOLDS TWO STATUSES. "Matched / Settled" pairs an OPEN status
     * with a TERMINAL one, so its single number cannot say which — live-observed as 863 under a tab
     * whose second word means finished, when nothing had been settled at all. The tab renders
     * `863 matched · 0 settled` from this.
     *
     * ⚠️ RAW, AND IT INCLUDES `Skipped`, which no tab shows. This is a breakdown OF the population,
     * not a fourth scope — never sum it expecting a tab's number. `tab_counts` stays the only thing
     * derived from the scope statuses, and the only thing a tab may be labelled with wholesale.
     */
    status_counts: Record<string, number>;
}

/** One import, as the summary picker lists it. */
export interface OutflowImportOption {
    name: string;
    original_filename?: string;
    period_from?: string;
    period_to?: string;
    status?: string;
    /**
     * Which kind of statement this was (slice CF/S2).
     *
     * ⚠️ OPTIONAL, AND `importsForSource` TREATS A BLANK AS MATCHING EVERY SCOPE. A batch predating
     * the column — or on a site where the backfill has not run — would otherwise vanish from the
     * picker with no control able to bring it back, while its transfers still needed settling.
     */
    source?: string;
    total_rows?: number;
    /**
     * How many of this statement's transfers the bank actually moved (slice CF/S4).
     *
     * ⚠️ NOT `total_rows`, WHICH INCLUDES REFUSED TRANSFERS. It pairs with `gross_amount`, which has
     * excluded them since parse time — printing `total_rows` beside that amount would put a count
     * and a figure describing different populations on one line.
     */
    successful_rows?: number;
    /** Money that actually left the account. Bank-refused transfers were never in it. */
    gross_amount?: number;
    uploaded_at?: string;
    uploaded_by?: string;
}

/** `review.get_import_summary` (slice X2). Every money figure crosses the wire as a number. */
export interface OutflowImportSummary {
    /**
     * The import this summary is pinned to, or `null` when it describes a PERIOD spanning several
     * (slice P1). `get_outflow_summary` is the period-scoped read; `get_import_summary` is the thin
     * wrapper that pins it to one statement and is what fills `import` below.
     */
    batch: string | null;
    /**
     * Which statements the selected transfers came from.
     *
     * ⚠️ DERIVED FROM THE ROWS, not from batches whose declared period overlaps. Three different
     * "periods" exist in this schema and they do not coincide; reading the imports back off the same
     * rows the figures were computed from is the only answer that cannot disagree with them.
     *
     * `row_count` is how many of the batch's rows are IN scope; `total_rows` is how many it holds.
     * The gap is what "Re-run match" overspills, and the screen says so before the click.
     */
    imports?: {
        name: string;
        original_filename?: string;
        period_from?: string;
        period_to?: string;
        uploaded_at?: string;
        row_count: number;
        total_rows: number;
    }[];
    /** Only present on the batch-pinned read — a period has no single statement's metadata. */
    import?: OutflowImportOption & {
        source?: string;
        gross_amount?: number;
        charges_amount?: number;
        overlaps_batch?: string | null;
    };
    totals: {
        total_rows: number;
        total_value: number;
        by_status: Record<string, { count: number; value: number }>;
        open_rows: number;
        open_value: number;
        decided_rows: number;
        decided_percent: number;
        settled_rows: number;
        settled_value: number;
        /**
         * Of `settled_rows`, how many took the matcher's own pick (slice Q1).
         *
         * ⚠️ OPTIONAL, so an older payload renders the tile exactly as it did before rather than
         * claiming "0 auto-matched" on data that simply predates the field. The hand-found count is
         * `settled_rows - settled_from_suggestion` and is deliberately not sent: two numbers that
         * must sum to a third are two chances to disagree with it.
         */
        settled_from_suggestion?: number;
        skipped_rows: number;
        skipped_value: number;
        matched_rows: number;
        matched_value: number;
        /**
         * ⚠️ ABSORBED `unmatched_rows` / `unmatched_value` (owner ruling 2026-08-10). It was the
         * rare figure -- 0 on almost every import -- and is now the productive one, carrying most
         * of a statement's work.
         */
        mismatched_rows: number;
        mismatched_value: number;
        pending_rows: number;
        error_rows: number;
        /** `Matched` rows carrying the match run's single pick -- what "Confirm all" can act on. */
        confirmable_rows: number;
        confirmable_value: number;
        /** `Matched` rows with SEVERAL candidates and therefore no pick. Never auto-confirmable. */
        ambiguous_rows: number;
        /**
         * Transfers the bank REFUSED to move -- reported here and counted in nothing else.
         *
         * ⚠️ EVERY OTHER FIGURE IN THIS OBJECT EXCLUDES THEM (owner ruling 2026-08-10, option B).
         * A failed transfer is money that never left the account, so counting it in `total_value`
         * overstates the statement and counting it in `total_rows` makes `decided_percent` a
         * percentage of work that does not exist. The row is still staged -- the evidence survives
         * -- and these two fields are the only place it surfaces after import.
         */
        failed_rows: number;
        failed_value: number;
    };
    auto_skipped_rows: number;
    manually_skipped_rows: number;
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


/**
 * One approved-and-unpaid record, from any of the three ledgers, in one shape.
 *
 * ⚠️ `approved_on` AND `updated_on` ARE SEPARATE KEYS AND EXACTLY ONE IS EVER FILLED. Only
 * `Project Payments` records an approval date — neither expense doctype has the field at all — so a
 * single "approved" column would present a modification timestamp as an approval on every expense in
 * the list (owner ruling 2026-08-06).
 *
 * ⚠️ `amount` MAY BE `null`, WHICH IS NOT ZERO. `Project Expenses.amount` is a Data column of
 * numeric strings; a value that cannot be read as a number comes back null rather than taking the
 * page down. A zero would be a claim that the record costs nothing.
 */
export interface ApprovedRecord {
    target_doctype: string;
    name: string;
    amount: number | null;
    status: string;
    vendor_name: string;
    project_name: string;
    /** Payments only, and NOT always a PO — a quarter are Service Requests. */
    order_doctype: string;
    order_name: string;
    /** Expenses only: the Expense Type. */
    expense_type: string;
    approved_on: string;
    updated_on: string;
}

export interface ApprovedRecordsPage {
    rows: ApprovedRecord[];
    total: number;
    value: number;
    /** Per-ledger split. The three are not comparable, so one total would hide the shape. */
    by_ledger: Record<string, { count: number; value: number }>;
    limit: number;
    offset: number;
    ledger: string;
    sortable: string[];
}

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

    /** Which channel the statement came from.
     *
     * ⚠️ These strings ARE the parser's adapter keys (`parser._ADAPTERS`) and the doctype Select
     * options, all three spellings pinned together by test. A value here that does not match the
     * Select fails Frappe's validation on every batch insert for that source, so this union is not
     * cosmetic — widen it in the same change as the other two, never on its own.
     *
     * ⚠️ `ICICI Bank Statement` names the BANK, not "a bank statement", deliberately: the source
     * selects a COLUMN ADAPTER, and a second bank has different columns and a different narration
     * grammar. Adding HDFC later is one more option, not a re-fit of this one.
     */
    source: "Cashfree" | "Cashbook" | "ICICI Bank Statement";
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
    /**
     * `Debit` / `Credit` / blank — WHICH WAY THE MONEY WENT (slices B3, shipped to the screen at B6).
     *
     * ⚠️ A FIELD, NEVER A SIGN ON `amount`. `amount` is the positive magnitude the statement printed
     * on every source, so NOTHING else on this row can tell a receipt from a payment. The decision
     * dialog offers "Create a project inflow" on a `Credit` and only on a `Credit`.
     *
     * ⚠️ BLANK IS NOT "Debit BY DEFAULT". A gateway export has no direction column at all, and a
     * bank row is blank when the parser found a figure in BOTH money columns and refused to guess.
     */
    direction?: string;
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
    /**
     * Every ledger this row settled into: "Project Payments" / "Project Expenses" /
     * "Non Project Expenses" -- possibly more than one, since one transfer may now settle several
     * payments across different books (ADR-0020's fan-out). Empty on an unsettled row.
     *
     * ⚠️ RENAMED FROM A SCALAR `settled_ledger` AT TASK 6, RATHER THAN WIDENED IN PLACE -- following
     * the `settled_by_ledger` precedent (`review.py`): three independent `LIMIT 1` subqueries with
     * no `ORDER BY` could each pick a different leg on a fan-out, so the old scalar key is GONE. A
     * stale reader now gets `undefined` and renders nothing, which is the intended loud failure
     * rather than one arbitrarily-picked ledger.
     *
     * ⚠️ DERIVED AT READ TIME from the row's `Outflow Row Match` rows, not stored on the row --
     * unlike `settlement_origin` beside it, which is denormalised onto the row. Same shape all the
     * same: empty on an unsettled row is CORRECT, because an open transfer has no settlement yet and
     * so has no ledger. The facet's own "(blank)" entry is what selects them.
     *
     * ⚠️ FILTERABLE BUT NOT SORTABLE. `review._FACET_COLUMNS` carries the (still singular)
     * `settled_ledger` FILTER column; `_SORTABLE_COLUMNS` deliberately does not -- ordering the
     * whole filtered table by a per-row correlated subquery that is blank on most rows buys nothing.
     * It is absent from `SERVER_SORT_COLUMNS` for the same reason, which is also what withholds the
     * header's sort affordance.
     */
    settled_ledgers?: string[];
    /**
     * The settled record's own name(s) and amount(s), one entry per settled leg.
     *
     * ⚠️ EXPORT-ONLY. `get_outflow_rows` does NOT return these two -- only
     * `export_outflow_rows` does -- so they are declared here for the CSV path and must NEVER be
     * given an entry in `OUTFLOW_COLUMNS`. A screen column reading a field the page query does not
     * select renders an em dash on every row forever, which is the `settlement_origin` defect
     * (a facet registered without its SELECT) wearing the other face.
     *
     * They exist because a reconciler opening the file asks "which record(s), and for how much
     * each" -- and on a partial settle a `settled_target_amounts` entry differs from the transfer's
     * own `amount`, which is the whole reason to look. `settled_target_amounts` stays null on an
     * unsettled row rather than 0: an open transfer did not settle nothing, it settled nothing YET.
     *
     * ⚠️ RENAMED FROM SCALARS (`settled_target_name` / `settled_target_amount`) AT TASK 6, for the
     * same fan-out reason `settled_ledgers` was. Each stays a PIPE-JOINED STRING in leg order
     * (`matched_at, name` -- a total order, since `name` is unique), NOT a list: these two are
     * export-only, a spreadsheet cell rather than a JSON array a screen renders, and the two
     * subqueries share that one ordering so a CSV line's name and amount always come from the same
     * leg.
     */
    settled_target_names?: string;
    settled_target_amounts?: string;
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
     * ⚠️ `skipped` IS A SCOPE WITH NO TAB (owner ruling). The four working scopes (`all`,
     * `not_matched`, `partly`, `matched`) label the tab strip; `skipped` exists so the Skipped
     * chip's dialog can ask for those rows by name, and it is deliberately absent from
     * `SCOPE_FOR_TAB` — there is no tab to map to it.
     */
    tab_counts: {
        all: number;
        not_matched: number;
        partly: number;
        matched: number;
        skipped: number;
    };
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
        /**
         * The WHOLE-STATEMENT figure split by which way the money went, as plain counts and
         * totals (`status.derive_import_summary`).
         *
         * ⚠️ THEY PARTITION `total_rows` / `total_value`, **NOT** `settled_rows` /
         * `settled_value` — every row the panel counts, whatever its status, not just the
         * settled ones. `status.py` states the identity twice (~906, ~993) and it is proven on
         * live data: `246 = 241 + 5`. They share the axis of `settled_by_direction` and NOTHING
         * ELSE; `status.py` ~1005 carries an explicit warning that the two deliberately total
         * DIFFERENT money. Reading them as a settled split — which an earlier version of this
         * very comment did — is exactly the confusion that warning exists to prevent.
         *
         * ⚠️ ALL FOUR ARE OPTIONAL, ON THE `settled_from_suggestion` / `settled_by_direction`
         * PRECEDENT, AND THAT IS NOT DEFENSIVENESS ABOUT THE TYPE. An older server does not send
         * them, and a required `number` would render as a confident `₹0` on data that simply
         * predates the field — a screen stating that nothing was received when it does not know.
         * Absent must render NOTHING. Check for `undefined`, never for falsiness: a real 0 and an
         * unsent key are different facts and `!x` cannot tell them apart.
         *
         * ⚠️ THEY ARE NEVER NETTED AGAINST EACH OTHER (owner ruling Q14 (a)). Money in and money
         * out are two totals, not one difference. And each is READ AS SENT — never obtain one by
         * subtracting the other from `total_value`, or a rounding disagreement becomes a figure
         * nothing on the server ever computed.
         */
        paid_rows?: number;
        paid_value?: number;
        received_rows?: number;
        received_value?: number;
        /**
         * `Still open` on the SAME axis — the third figure each of the panel's two direction
         * BANDS needs (`status.derive_import_summary`).
         *
         * ⚠️ THEY PARTITION `open_rows` / `open_value` — what somebody still owes a decision on,
         * cut by which way the money went. **NOT** `total_rows` / `total_value` (that cut is
         * `paid_*` / `received_*` above) and **NOT** the settled population (that is
         * `settled_by_direction`). Three different populations of the one direction axis, which
         * is exactly what lets a band's three cards reconcile:
         *
         *     <dir>_value == settled_by_direction[<dir>].value + open_<dir>_value
         *
         * proven on live data whole-system and per import (2026-09-08): paid
         * `3,798,616.00 + 5,853,190.00 = 9,651,806.00`, received `0 + 4,268,880.20 =
         * 4,268,880.20`. `status.py` pins the partition itself on every input.
         *
         * ⚠️ THE SETTLED HALF IS DELIBERATELY NOT A KEY HERE. `settled_by_direction` already
         * carries it, WITH the per-ledger lines the Settled card renders, and two keys totalling
         * the same money are two chances to disagree about it.
         *
         * ⚠️ ALL FOUR ARE OPTIONAL, on the same precedent and for the same reason as the four
         * above: an older server does not send them, and a required `number` would render a
         * confident `₹0` over money that is genuinely open. Check for `undefined`, never for
         * falsiness — a real 0 (nothing left open on that side) and an unsent key are different
         * facts, and `!x` cannot tell them apart. Absent means the panel falls back to its single
         * flat row of tiles.
         */
        open_paid_rows?: number;
        open_paid_value?: number;
        open_received_rows?: number;
        open_received_value?: number;
    };
    /**
     * Where the settled money went, as TWO BLOCKS — Paid and Received (slice B8b, owner Q14 (a)).
     *
     * ⚠️ IT REPLACED `settled_by_ledger`, WHICH IS GONE RATHER THAN KEPT BESIDE IT. The screen now
     * carries money IN as well as OUT, and one flat list could only be a single figure that hides
     * both halves, a meaningless sum of the two directions, or a total that silently omits receipts.
     * Two payload keys totalling the same money would be two chances to disagree about it.
     *
     * ⚠️ EACH BLOCK CARRIES ITS OWN TOTAL, AND ITS `ledgers` LINES ADD UP TO IT EXACTLY — the
     * server sums each total from the lines it just built (`status.derive_settled_direction_blocks`),
     * so the reconciliation holds by construction. The two block totals in turn add back to
     * `totals.settled_value`. NEVER net one against the other.
     *
     * ⚠️ THE PAID BLOCK IS ALWAYS SENT, ZERO-FILLED; THE RECEIVED BLOCK ONLY WHEN IT HOLDS ROWS.
     * Cashfree and Cashbook are single-direction sources, so an empty received block would sit on
     * every gateway import forever, claiming receipts were possible where none can occur.
     *
     * ⚠️ OPTIONAL, so a client running against a server that predates the key renders nothing
     * rather than claiming nothing settled — the call `settled_from_suggestion` above already makes,
     * for the same reason. `settledDirectionBlocks.ts` is the one reader and passes the list through
     * untouched: the split, the order and the fill are the server's, because it holds the
     * `GROUP BY`, and a client that re-sorted, re-partitioned or re-totalled would be a second
     * opinion about figures printed beside the server's own.
     */
    settled_by_direction?: {
        /** `Paid` or `Received`. */
        direction: string;
        rows: number;
        value: number;
        /** This block's own books. `Project Payments` / `Project Expenses` /
         *  `Non Project Expenses` / `Other` when paid; `Project Inflows` /
         *  `Non Project Expenses` / `Other` when received. */
        ledgers: {
            ledger: string;
            rows: number;
            value: number;
        }[];
    }[];
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
 * One field the parser will read, and the sheet column(s) it reads it from.
 *
 * ⚠️ DERIVED SERVER-SIDE FROM THE ADAPTER'S OWN COLUMN MAP, never a second hand-written list. The
 * screen states what the parser will do; a separate list would be free to disagree with it, and the
 * screen is the thing a reviewer trusts before committing an import.
 *
 * `columns` holds MORE THAN ONE entry when the field is resolved across several columns, in the
 * order the parser consults them -- a date that prefers `Transaction Date` and falls back to
 * `Value Date`, or the withdrawal/deposit pair that yields the amount AND the direction together.
 * `note` says which rule applies and is absent for a plain single-column field.
 */
export interface StatementSheetColumnRead {
    label: string;
    columns: { header: string; letter: string }[];
    note?: string;
}

/**
 * Where the table sits inside an uploaded sheet, for the Check step's header picker.
 *
 * ⚠️ PRESENT ONLY FOR A SOURCE WHOSE EXPORT WRAPS ITS TABLE IN A PREAMBLE. A raw ICICI download
 * carries sixteen rows of account information above the header and a totals-plus-legends trailer
 * below the last transaction; Cashfree and Cashbook carry neither, so `sheet` is ABSENT for them
 * and their flows stay byte-identical.
 *
 * ⚠️ EVERY ROW NUMBER HERE IS 1-BASED AND MEANS THE SHEET'S OWN ROW, so it matches what the person
 * sees in Excel. `grid[0]` is always sheet row 1, so sheet row N is `grid[N - 1]`; there is
 * deliberately no offset field, because an offset is one more thing that can be wrong.
 *
 * ⚠️ `trailing_rows_ignored` IS REPORTED RATHER THAN LEFT SILENT. The table ends at the first
 * wholly-blank row, and a rule that ends a table is a rule that can truncate one -- so the count of
 * what was dropped is on screen, where a wrong answer is visible.
 */
export interface StatementSheetInfo {
    /** 1-based row where auto-detection found the header. */
    detected_header_row: number;
    /** 1-based row actually used -- differs from the detected one only after an override. */
    header_row_used: number;
    was_overridden: boolean;
    total_sheet_rows: number;
    /** 1-based first data row, always `header_row_used + 1`. */
    table_start_row: number;
    /** 1-based last data row. */
    table_end_row: number;
    /** NON-BLANK rows below `table_end_row` that were not read. */
    trailing_rows_ignored: number;
    grid_truncated: boolean;
    /** Capped, padded, trimmed cells. `grid[0]` is sheet row 1. Never null. */
    grid: string[][];
    columns_read: StatementSheetColumnRead[];
}

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
    /**
     * Where the table sits in the uploaded sheet. PRESENT ONLY for a source whose export wraps
     * its table in a preamble (a raw bank statement); ABSENT for Cashfree and Cashbook.
     */
    sheet?: StatementSheetInfo;
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
    /**
     * Both expense ledgers only — `Project Payments` has no description column at all, the exact
     * inverse of the `approved_on` asymmetry above (`ledger_read.py` asymmetry 4).
     *
     * ⚠️ OPTIONAL BECAUSE AN OLDER SERVER DOES NOT SEND THE KEY, and `null` because a ledger that
     * cannot have one must be renderable as an absence rather than as an empty description somebody
     * forgot to fill in. Today's server sends `""` for a payment, in the same style as every other
     * string key in the shared shape.
     */
    description?: string | null;
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

import frappe
from frappe.utils import today, add_days, getdate

from nirmaan_stack.api.outflow_import.review import not_matched_totals
from nirmaan_stack.services.outflow_import.expense_links import load_linked_totals


def _to_float(value):
    """Safely coerce a stored amount to float (None / '' / bad data → 0.0)."""
    try:
        return float(value) if value else 0.0
    except (ValueError, TypeError):
        return 0.0


@frappe.whitelist(allow_guest=False)
def get_payment_dashboard_stats():
    """
    Fetches aggregated statistics for Project Payments (Pending, Approved, Paid),
    including both count and amount for all time-based metrics.
    
    This function aggregates data in Python to ensure cross-database compatibility 
    and reliable date comparisons using getdate().
    """
    
    doctype = 'Project Payments'
    
    # Date calculations (All converted to datetime.date objects for reliable comparison)
    today_date = getdate(today())
    seven_days_ago = getdate(add_days(today_date, -6))
    thirty_days_ago = getdate(add_days(today_date, -29))   # inclusive 30-day window

    # --- DEBUGGING PRINT STATEMENTS ---
    # Keeping top-level date information for context
    print(f"\n--- Payment Dashboard Stats Debug ---")
    print(f"Today's Date (for comparison): {today_date.strftime('%Y-%m-%d')}")
    print(f"7 Days Ago Date (for comparison): {seven_days_ago.strftime('%Y-%m-%d')}")
    # ----------------------------------

    # Initialize raw statistics accumulator
    stats = {
        # Pending
        'total_pending_payment_count': 0,
        'total_pending_payment_amount': 0.0,
        # Requested (L1 Pending)
        'total_requested_payment_count': 0,
        'total_requested_payment_amount': 0.0,
        # CEO Pending
        'total_ceo_pending_count': 0,
        'total_ceo_pending_amount': 0.0,

        # Money that has LEFT the bank but the bank has not confirmed it. Reads 0
        # until the fulfil path starts writing the status — an honest zero, the same
        # one the tab shows.
        'total_reconciliation_pending_count': 0,
        'total_reconciliation_pending_amount': 0.0,
        # The part of those records bank lines ALREADY cover -- an expense several lines pay
        # stays Reconciliation Pending until they add up. Amount minus this = what is actually
        # still waiting for the bank, and that difference is the only thing the card prints on
        # the row: the covered part is confirmed cash out and is counted in the 30-day outflow
        # by 2h2 instead. Both come off ONE read in 2h2, so what leaves this figure is exactly
        # what lands over there. Read inside the outflow `try` below; 0 if that fails.
        'total_reconciliation_pending_reconciled_amount': 0.0,

        # Approved
        'total_approval_done_today': 0,
        'total_approval_done_today_amount': 0.0,
        'total_approval_done_7_days': 0,
        'total_approval_done_7_days_amount': 0.0,
        # CEO Approved
        'total_ceo_approval_done_today': 0,
        'total_ceo_approval_done_today_amount': 0.0,
        'total_ceo_approval_done_7_days': 0,
        'total_ceo_approval_done_7_days_amount': 0.0,
        # Auto Approved (amount below threshold — skipped the L1 + CEO gates)
        'total_auto_approval_today': 0,
        'total_auto_approval_today_amount': 0.0,
        'total_auto_approval_7_days': 0,
        'total_auto_approval_7_days_amount': 0.0,
        # Paid
        'payment_done_today': 0,
        'payment_done_today_amount': 0.0,
        'payment_done_7_days': 0,
        'payment_done_7_days_amount': 0.0,

        # --- Cash flow (last 30 days) ---
        # Inflow: money received (Project Inflows)
        'total_inflow_30_days_count': 0,
        'total_inflow_30_days_amount': 0.0,
        # Non-project inflow: Non Project Inflows (ADR-0016 A-D4). Its own figure, NEVER netted
        # against any outflow.
        'total_non_project_inflow_30_days_count': 0,
        'total_non_project_inflow_30_days_amount': 0.0,
        # Project outflow: PO + WO Paid payments + Project Expenses, PLUS the bank-confirmed
        # part of records still Reconciliation Pending (2h2 -- see there for why).
        'total_project_outflow_30_days_count': 0,
        'total_project_outflow_30_days_amount': 0.0,
        # Non-project outflow: Non Project Expenses, on the same two terms.
        'total_non_project_expense_30_days_count': 0,
        'total_non_project_expense_30_days_amount': 0.0,

        # How much of each figure above came from 2h2 rather than from a Paid record -- the
        # card prints it as an "incl. ..." note under the row.
        #
        # ⚠️ A SUBSET OF THE FIGURE BESIDE IT, NEVER A THIRD BUCKET. It is already inside
        # `total_project_outflow_30_days_amount` / `total_non_project_expense_30_days_amount`;
        # adding it to either, or to the column total the card prints from those two, counts
        # the same money twice. Its count is part of theirs on the same terms.
        'total_project_outflow_30_days_part_reconciled_count': 0,
        'total_project_outflow_30_days_part_reconciled_amount': 0.0,
        'total_non_project_expense_30_days_part_reconciled_count': 0,
        'total_non_project_expense_30_days_part_reconciled_amount': 0.0,

        # --- Total Unreconciled Outflow (#1286) ---
        # Bank money that has left the account and still owes somebody a decision in Bulk
        # Import: EVERY import, EVERY source, ALL TIME. It is NOT a 30-day figure and must
        # never be folded into the cash-flow block above, which is.
        #
        # ⚠️ IT IS NOT AGGREGATED HERE. It is Bulk Import's **Not Matched – Outflow** tab PLUS what
        # is still unallocated on each **Partly Allocated – Outflow** line (owner, 2026-09-22 -- it
        # was #1286's "Still open", which also counted Matched lines and the WHOLE of a part-used
        # one). `review.not_matched_totals` builds both from the tabs' own scope clauses, so the
        # card and the tabs cannot disagree. A second query written here would be how they do.
        'total_unreconciled_outflow_amount': 0.0,
        'total_unreconciled_outflow_count': 0,

        # --- Total Unreconciled Inflow ---
        # The inflow twin: Bulk Import's **Not Matched – Inflow** tab. Same source call, same
        # all-time scope, same rule -- never folded into the 30-day inflow figures.
        'total_unreconciled_inflow_amount': 0.0,
        'total_unreconciled_inflow_count': 0,
    }

    try:
        # 1. Fetch ALL necessary documents
        # ── ALL THREE MONEY-OUT LEDGERS ──────────────────────────────────────
        #
        # This used to read `Project Payments` alone, so every figure in the
        # Pending and Approved & Paid blocks silently excluded expenses — the card
        # said "Approved But not Paid ₹13,848" while the tab beside it listed 15
        # rows worth ₹87,408. A summary that contradicts the list under it is worse
        # than no summary.
        #
        # The fields are identical on all three (the expense ledgers gained
        # `approval_date` / `ceo_approval_date` / `auto_approved` on 15 Sep), so one
        # loop still serves all of them — only the SOURCE widened, not the rules.
        LEDGERS = (doctype, 'Project Expenses', 'Non Project Expenses')
        _row_fields = ['name', 'status', 'amount', 'approval_date',
                       'ceo_approval_date', 'payment_date', 'auto_approved']

        all_payments = []
        # Reconciliation Pending records -> {name: payment_date}. The DATE is what 2h2 needs:
        # a record in this state normally has NONE (`derive_expense_status` returns
        # `payment_date=None` until the last bank line lands), and a record with no date is
        # taken as inside the 30-day window.
        reconciliation_pending = {_ledger: {} for _ledger in LEDGERS}
        # (ledger, name) of every record the 30-day outflow has already taken at its FULL amount.
        # 2h2 adds the part-reconciled ones and must not touch a record that is in here twice.
        outflow_window_records = set()
        for _ledger in LEDGERS:
            for _row in frappe.get_all(_ledger, fields=_row_fields, limit_page_length=None):
                _row['ledger'] = _ledger
                all_payments.append(_row)

        # 2. Python Aggregation (Manual Calculation)
        for doc in all_payments:
            status = doc.status
            is_payment = doc.get('ledger') == doctype
            
            # Safely convert amount to float
            try:
                amount = float(doc.amount) if doc.amount else 0.0
            except (ValueError, TypeError):
                amount = 0.0
            
            # --- 2a. PENDING Check ---
            # FIX: The correct check for Pending is NOT IN ['Rejected', 'Approved', 'Paid']
            if status == 'Requested':
                stats['total_requested_payment_count'] += 1
                stats['total_requested_payment_amount'] += amount
            if status == 'CEO Pending':
                stats['total_ceo_pending_count'] += 1
                stats['total_ceo_pending_amount'] += amount
            if status == 'Approved':
                stats['total_pending_payment_count'] += 1
                stats['total_pending_payment_amount'] += amount
            if status == 'Reconciliation Pending':
                stats['total_reconciliation_pending_count'] += 1
                stats['total_reconciliation_pending_amount'] += amount
                reconciliation_pending[doc.ledger][doc.name] = doc.payment_date

            # --- 2b & 2c. APPROVED Check (L1) ---
            # Exclude auto-approved payments — they skipped the L1 gate and are
            # reported under the dedicated Auto Approval metric instead.
            if doc.approval_date and not doc.auto_approved:
                approval_date = doc.approval_date
                
                # Compare as date objects
                if approval_date == today_date:
                    stats['total_approval_done_today'] += 1
                    stats['total_approval_done_today_amount'] += amount
                
                if approval_date >= seven_days_ago and approval_date <= today_date:
                    stats['total_approval_done_7_days'] += 1
                    stats['total_approval_done_7_days_amount'] += amount

            # --- 2c2. CEO APPROVED Check ---
            # Exclude auto-approved payments — they skipped the CEO gate too.
            if doc.ceo_approval_date and not doc.auto_approved:
                ceo_approval_date = doc.ceo_approval_date

                if ceo_approval_date == today_date:
                    stats['total_ceo_approval_done_today'] += 1
                    stats['total_ceo_approval_done_today_amount'] += amount

                if ceo_approval_date >= seven_days_ago and ceo_approval_date <= today_date:
                    stats['total_ceo_approval_done_7_days'] += 1
                    stats['total_ceo_approval_done_7_days_amount'] += amount

            # --- 2c3. AUTO APPROVED Check ---
            # Small payments that auto-approved (skipped L1 + CEO). approval_date is
            # stamped at creation for these, so it is the right window anchor.
            if doc.auto_approved and doc.approval_date:
                auto_approval_date = doc.approval_date

                if auto_approval_date == today_date:
                    stats['total_auto_approval_today'] += 1
                    stats['total_auto_approval_today_amount'] += amount

                if auto_approval_date >= seven_days_ago and auto_approval_date <= today_date:
                    stats['total_auto_approval_7_days'] += 1
                    stats['total_auto_approval_7_days_amount'] += amount


            # --- 2d & 2e. PAID Check ---
            if doc.payment_date:
                payment_date = doc.payment_date

                # Paid Today
                if payment_date == today_date:
                    stats['payment_done_today'] += 1
                    stats['payment_done_today_amount'] += amount
                
                # Paid Last 7 Days (inclusive)
                if payment_date >= seven_days_ago and payment_date <= today_date:
                    stats['payment_done_7_days'] += 1
                    stats['payment_done_7_days_amount'] += amount

                # Project outflow — Paid PAYMENTS (PO + WO) in the last 30 days.
                # payment_date is only stamped on fulfilment, so this is cash actually out.
                #
                # ⚠️ PAYMENTS ONLY, and the guard is load-bearing: Project Expenses are
                # added to this same accumulator at 2e2 below and Non-Project at 2g, so
                # without it the widened loop would count every expense TWICE.
                if is_payment and payment_date >= thirty_days_ago and payment_date <= today_date:
                    stats['total_project_outflow_30_days_count'] += 1
                    stats['total_project_outflow_30_days_amount'] += amount
                    outflow_window_records.add((doc.ledger, doc.name))

        # --- 2e2. Project Expenses → also project outflow (last 30 days) ---
        # Folded into the same bucket as PO + WO payments so "Project Outflow"
        # means PO + WO + Project Expenses (matches the Cash Sheet report).
        project_expenses = frappe.get_all(
            "Project Expenses",
            filters={"payment_date": ["between", [thirty_days_ago, today_date]], "status": "Paid"},
            fields=["amount"],
            limit_page_length=None,
        )
        stats['total_project_outflow_30_days_count'] += len(project_expenses)
        stats['total_project_outflow_30_days_amount'] += sum(
            _to_float(r.amount) for r in project_expenses
        )

        # --- 2f. Inflow (Project Inflows) — last 30 days ---
        inflows = frappe.get_all(
            "Project Inflows",
            filters={"payment_date": ["between", [thirty_days_ago, today_date]]},
            fields=["amount"],
            limit_page_length=None,
        )
        stats['total_inflow_30_days_count'] = len(inflows)
        stats['total_inflow_30_days_amount'] = sum(_to_float(r.amount) for r in inflows)

        # --- 2f2. Non-project inflow (Non Project Inflows) — last 30 days ---
        # A separate figure (ADR-0016 A-D4): it is never subtracted from the non-project outflow
        # below. No status field — a record counts the moment it is saved.
        non_project_inflows = frappe.get_all(
            "Non Project Inflows",
            filters={"payment_date": ["between", [thirty_days_ago, today_date]]},
            fields=["amount"],
            limit_page_length=None,
        )
        stats['total_non_project_inflow_30_days_count'] = len(non_project_inflows)
        stats['total_non_project_inflow_30_days_amount'] = sum(
            _to_float(r.amount) for r in non_project_inflows
        )

        # --- 2g. Non-project outflow (Non Project Expenses) — last 30 days ---
        non_project_expenses = frappe.get_all(
            "Non Project Expenses",
            filters={"payment_date": ["between", [thirty_days_ago, today_date]], "status": "Paid"},
            fields=["amount"],
            limit_page_length=None,
        )
        stats['total_non_project_expense_30_days_count'] = len(non_project_expenses)
        stats['total_non_project_expense_30_days_amount'] = sum(
            _to_float(r.amount) for r in non_project_expenses
        )

        # --- 2h. Total Unreconciled Outflow / Inflow — all imports, all sources, all time ---
        # Bulk Import's two Not Matched tabs (owner, 2026-09-22): lines still `Pending match run`,
        # `Mismatched` or `Error`, by direction -- and on the outflow side, the part of every
        # Partly Allocated line no record has taken yet (that line counts once). Matched, Settled
        # and Skipped lines are out, and so are transfers the bank refused.
        #
        # ⚠️ IT CARRIES ITS OWN `try`, AND THAT IS NOT DEFENSIVE HABIT -- IT IS A FAILURE DOMAIN
        # THESE FIGURES BROUGHT WITH THEM. Everything above reads the payment, expense and inflow
        # ledgers; this reads `tabOutflow Import Row` and `tabOutflow Row Match` through raw SQL.
        # The function's outer `except` rolls back and re-throws, and the card's client turns ANY
        # error from this endpoint into a single "Error Loading Summary" panel -- so without this
        # guard a site where the outflow-import migration has not run, or a later rename of one of
        # those columns, blanks pending approvals, amounts due, paid today / 7 days and both
        # 30-day cash-flow figures, none of which have anything to do with Bulk Import.
        #
        # ⚠️ THE FALLBACK IS THE HONEST ZERO ALREADY INITIALISED ABOVE, and it is safe here for a
        # reason the 30-day figures could not claim: this number's own screen (Bulk Import) is
        # where the work actually gets done, so a 0 on the card understates a backlog rather than
        # hiding money nothing else reports. The failure is LOGGED, never swallowed silently.
        try:
            not_matched = not_matched_totals()

            # --- 2h2. The bank-confirmed part of a Reconciliation Pending record ----------
            # `load_linked_totals` is the live-slip aggregate the queue and the Bank lines card
            # read, grouped by record; only the Reconciliation Pending records' share is taken.
            # That one figure is used TWICE, and reading it once is what keeps the two sides of
            # the card tied to the penny:
            #
            #   * SUBTRACTED from the pending row, which prints what is ACTUALLY still waiting.
            #   * ADDED to the 30-day outflow it belongs to, project or non-project by ledger.
            #     Its status keeps it out of the two outflow queries above (they read Paid
            #     records and stamped `payment_date`s), so without this the confirmed part is
            #     reported NOWHERE -- gone from pending, not yet in outflow.
            #
            # ⚠️ NO DATE OF ITS OWN MEANS INSIDE THE WINDOW (owner, 2026-09-23). These records
            # carry `payment_date = None` by design -- `derive_expense_status` withholds it until
            # the lines cover the amount -- so there is no date to test and every one of them
            # counts. A record that DOES carry a date is held to it like any other row here: in
            # the window it counts, outside it does not. One rule, one field, the same
            # `payment_date` the queries above use.
            #
            # ⚠️ NO DOUBLE COUNT. A record the window already took in FULL is skipped via
            # `outflow_window_records` -- a Project Payment is counted on `payment_date` with no
            # status filter, so one in Reconciliation Pending can be in both sets. The expense
            # queries (2e2, 2g) filter `status = Paid`, which a Reconciliation Pending expense
            # can never satisfy. And a record becomes Paid only once its lines cover it, at which
            # point it leaves this set and its FULL amount is counted there instead.
            reconciled_in_pending = 0.0
            for _ledger, _pending in reconciliation_pending.items():
                if not _pending:
                    continue
                for _name, _links in load_linked_totals(_ledger).items():
                    if _name not in _pending:
                        continue
                    _confirmed = float(_links.linked_total)
                    if not _confirmed:
                        continue
                    # The pending row's subtraction takes every one of them, counted or not.
                    reconciled_in_pending += _confirmed

                    if (_ledger, _name) in outflow_window_records:
                        continue
                    _paid_on = _pending[_name]
                    if _paid_on and not (thirty_days_ago <= _paid_on <= today_date):
                        continue
                    if _ledger == 'Non Project Expenses':
                        stats['total_non_project_expense_30_days_count'] += 1
                        stats['total_non_project_expense_30_days_amount'] += _confirmed
                        stats['total_non_project_expense_30_days_part_reconciled_count'] += 1
                        stats['total_non_project_expense_30_days_part_reconciled_amount'] += _confirmed
                    else:
                        stats['total_project_outflow_30_days_count'] += 1
                        stats['total_project_outflow_30_days_amount'] += _confirmed
                        stats['total_project_outflow_30_days_part_reconciled_count'] += 1
                        stats['total_project_outflow_30_days_part_reconciled_amount'] += _confirmed
            stats['total_unreconciled_outflow_amount'] = (
                not_matched['outflow']['amount'] + not_matched['partly_outflow']['pending']
            )
            stats['total_unreconciled_outflow_count'] = (
                not_matched['outflow']['rows'] + not_matched['partly_outflow']['rows']
            )
            stats['total_unreconciled_inflow_amount'] = not_matched['inflow']['amount']
            stats['total_unreconciled_inflow_count'] = not_matched['inflow']['rows']
            stats['total_reconciliation_pending_reconciled_amount'] = reconciled_in_pending

        except Exception as unmatched_error:
            frappe.log_error(
                f"Total Unreconciled Outflow / Inflow unavailable: {unmatched_error}",
                "Payment Stats API - unmatched outflow",
            )
            # The 30-day outflow figures keep everything 2d-2g put in them; only 2h2's
            # part-reconciled add-on is missing, which is the same understatement the card
            # showed before it existed.

        # 3. Return the dictionary of statistics
        # --- DEBUGGING PRINT STATEMENT ---
        print(f"--- Finished Processing. Returning Stats: {stats}")
        # ---------------------------------
        
        return stats

    except Exception as e:
        # 4. Handle and throw the error
        frappe.db.rollback() 
        
        frappe.log_error(f"Error fetching payment dashboard stats: {e}", "Payment Stats API Error - Rolled Back")
        
        frappe.throw(f"An unexpected error occurred while fetching payment statistics: {e}")
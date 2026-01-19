"""
Credits API - Dedicated endpoint for PO Payment Terms (Credits)

This API uses direct SQL to filter at the CHILD ROW level, not the parent level.
This solves the issue where the generic useServerDataTable API returns ALL child rows
from parents that have ANY matching child, instead of just the matching child rows.

Key features:
- Row-level filtering for "Due" tab:
  - Created terms with due_date <= today (displayed as "Due")
  - Requested terms
  - Approved terms
- Computed display_status field: Shows "Due" for eligible Created terms
- Permission-aware based on user's project access
- TanStack filter format support
- Aggregates calculation for summary cards
"""

import frappe
from frappe import _
from frappe.utils import cint, today
import json


@frappe.whitelist()
def get_credits_list(
    status_filter: str = "All",       # "Due", "All", or specific term_status
    filters: str = None,              # JSON string of TanStack column filters
    search_term: str = None,          # Search query
    search_field: str = "name",       # Which field to search (po.name, vendor_name, project_name)
    order_by: str = None,             # Sort order (e.g., "due_date asc")
    limit_start: int = 0,
    limit_page_length: int = 50,
    with_aggregates: bool = True      # Return totals for summary cards
):
    """
    Fetches PO Payment Terms (Credits) with row-level filtering.

    Unlike the generic get_list API, this filters at the child row level,
    ensuring "Due" tab only shows rows that individually match the criteria.

    Args:
        status_filter: "Due" (Created + past due_date), "All", or specific status
        filters: TanStack column filters as JSON string
        search_term: Text to search for
        search_field: Field to search on (name, vendor_name, project_name)
        order_by: SQL ORDER BY clause (e.g., "due_date asc")
        limit_start: Offset for pagination
        limit_page_length: Page size
        with_aggregates: Include aggregate totals

    Returns:
        dict with data, total_count, and optionally aggregates
    """
    limit_start = cint(limit_start)
    limit_page_length = cint(limit_page_length)
    with_aggregates_bool = isinstance(with_aggregates, str) and with_aggregates.lower() == 'true' or with_aggregates is True

    # Get user's allowed projects
    user = frappe.session.user
    allowed_projects = _get_user_allowed_projects(user)

    # Build WHERE conditions
    conditions = []
    values = {}

    # Base conditions: Only Credit payment terms from active POs
    conditions.append('po.status NOT IN (\'Merged\', \'Inactive\', \'PO Amendment\')')
    conditions.append('pt.payment_type = \'Credit\'')

    # Project permission filter
    if allowed_projects is not None:  # None means full access
        if len(allowed_projects) == 0:
            # User has no project access - return empty
            return {
                "data": [],
                "total_count": 0,
                "aggregates": {"total_credit_amount": 0, "total_due_amount": 0, "total_paid_amount": 0} if with_aggregates_bool else None
            }
        conditions.append('po.project IN %(allowed_projects)s')
        values['allowed_projects'] = tuple(allowed_projects)

    # Status filter - this is the key difference from generic API
    # We filter at the ROW level, not parent level
    today_date = today()
    values['today'] = today_date  # Always include today for display_status calculation

    if status_filter == "Due":
        # "Due" tab shows:
        # - Created terms with due_date <= today (these are overdue/due for payment)
        # - Requested terms (payment has been requested)
        # - Approved terms (payment is approved, pending disbursement)
        conditions.append('''(
            (pt.term_status = 'Created' AND pt.due_date <= %(today)s)
            OR pt.term_status = 'Requested'
            OR pt.term_status = 'Approved'
        )''')
    elif status_filter != "All":
        # Specific status filter
        conditions.append('pt.term_status = %(status_filter)s')
        values['status_filter'] = status_filter

    # Parse and apply TanStack column filters
    if filters:
        parsed_filters = _parse_tanstack_filters(filters)
        for filter_condition, filter_value_key, filter_value in parsed_filters:
            conditions.append(filter_condition)
            values[filter_value_key] = filter_value

    # Search filter
    if search_term and search_term.strip():
        search_patterns = []
        search_tokens = search_term.strip().split()
        for idx, token in enumerate(search_tokens):
            token_key = f'search_{idx}'
            if search_field == "name":
                search_patterns.append(f'po.name ILIKE %({token_key})s')
            elif search_field == "vendor_name":
                search_patterns.append(f'po.vendor_name ILIKE %({token_key})s')
            elif search_field == "project_name":
                search_patterns.append(f'po.project_name ILIKE %({token_key})s')
            else:
                # Default to PO name search
                search_patterns.append(f'po.name ILIKE %({token_key})s')
            values[token_key] = f'%{token}%'

        if search_patterns:
            conditions.append(f'({" AND ".join(search_patterns)})')

    # Build WHERE clause
    where_clause = ' AND '.join(conditions)

    # Build ORDER BY clause
    order_clause = _build_order_clause(order_by)

    # Main data query
    # display_status: Shows "Due" for Created terms with past due_date, otherwise shows term_status
    data_sql = f"""
        SELECT
            po.name,
            po.creation,
            po.modified,
            po.total_amount,
            po.status as postatus,
            po.project,
            po.project_name,
            po.vendor,
            po.vendor_name,
            pt.name as ptname,
            pt.term_status,
            CASE
                WHEN pt.term_status = 'Created' AND pt.due_date <= %(today)s THEN 'Due'
                ELSE pt.term_status
            END as display_status,
            pt.label,
            pt.amount,
            pt.percentage,
            pt.due_date,
            pt.modified as term_modified
        FROM "tabProcurement Orders" po
        INNER JOIN "tabPO Payment Terms" pt ON pt.parent = po.name
        WHERE {where_clause}
        {order_clause}
        LIMIT %(limit)s OFFSET %(offset)s
    """

    values['limit'] = limit_page_length
    values['offset'] = limit_start

    data = frappe.db.sql(data_sql, values, as_dict=True)

    # Count query (without LIMIT/OFFSET)
    count_sql = f"""
        SELECT COUNT(*) as total
        FROM "tabProcurement Orders" po
        INNER JOIN "tabPO Payment Terms" pt ON pt.parent = po.name
        WHERE {where_clause}
    """
    # Remove pagination params for count query
    count_values = {k: v for k, v in values.items() if k not in ('limit', 'offset')}
    total_count = frappe.db.sql(count_sql, count_values)[0][0]

    # Aggregates query (optional)
    aggregates = None
    if with_aggregates_bool:
        aggregates = _calculate_aggregates(where_clause, count_values, today_date, allowed_projects)

    return {
        "data": data,
        "total_count": total_count,
        "aggregates": aggregates
    }


def _get_user_allowed_projects(user: str):
    """
    Get list of projects the user is allowed to access.
    Returns None for full access users, empty list for no access,
    or list of project names for restricted users.
    """
    # Roles with full access
    full_access_roles = [
        "Nirmaan Admin Profile",
        "Nirmaan PMO Executive Profile",
        "Nirmaan Accountant Profile",
    ]

    if user == "Administrator":
        return None  # Full access

    user_role = frappe.get_value("Nirmaan Users", user, "role_profile")
    if user_role in full_access_roles:
        return None  # Full access

    # Get user's allowed projects from permissions
    return frappe.get_all(
        "Nirmaan User Permissions",
        filters={"user": user, "allow": "Projects"},
        pluck="for_value"
    )


def _parse_tanstack_filters(filters_json: str) -> list:
    """
    Parse TanStack column filters from JSON string.

    Expected format: [{"id": "column_name", "value": ["val1", "val2"]}]

    Returns list of (condition_sql, value_key, value) tuples.

    Special handling for term_status/display_status:
    - "Due" in filter translates to: term_status='Created' AND due_date <= today
    """
    result = []
    try:
        filters = json.loads(filters_json)
        if not isinstance(filters, list):
            return result

        for idx, f in enumerate(filters):
            if not isinstance(f, dict) or 'id' not in f or 'value' not in f:
                continue

            column_id = f['id']
            filter_value = f['value']

            # Map column IDs to SQL fields
            field_map = {
                'name': 'po.name',
                'project_name': 'po.project_name',
                'vendor_name': 'po.vendor_name',
                'term_status': 'pt.term_status',
                'display_status': 'pt.term_status',  # Special handling below
                'due_date': 'pt.due_date',
                'amount': 'pt.amount',
                'label': 'pt.label',
            }

            sql_field = field_map.get(column_id)
            if not sql_field:
                continue

            value_key = f'filter_{idx}'

            # Special handling for status filters with "Due" value
            if column_id in ('term_status', 'display_status') and isinstance(filter_value, list):
                # Check if "Due" is in the selected values
                has_due = 'Due' in filter_value
                other_statuses = [v for v in filter_value if v != 'Due']

                if has_due and other_statuses:
                    # User selected "Due" and other statuses
                    # Due = Created with past due_date
                    result.append((
                        f'''((pt.term_status = 'Created' AND pt.due_date <= %(today)s) OR pt.term_status IN %({value_key})s)''',
                        value_key,
                        tuple(other_statuses)
                    ))
                elif has_due:
                    # User only selected "Due"
                    result.append((
                        f'''(pt.term_status = 'Created' AND pt.due_date <= %(today)s)''',
                        value_key,
                        None  # No value needed, condition is self-contained
                    ))
                elif other_statuses:
                    # User selected statuses but not "Due"
                    result.append((
                        f'pt.term_status IN %({value_key})s',
                        value_key,
                        tuple(other_statuses)
                    ))
                continue

            # Handle different filter value types
            if isinstance(filter_value, list) and len(filter_value) > 0:
                # IN clause for multi-select facets
                result.append((
                    f'{sql_field} IN %({value_key})s',
                    value_key,
                    tuple(filter_value)
                ))
            elif isinstance(filter_value, dict):
                # Operator-based filter (e.g., date range)
                operator = filter_value.get('operator', '=')
                val = filter_value.get('value')

                if operator == 'Between' and isinstance(val, list) and len(val) == 2:
                    # Date range filter
                    start_key = f'{value_key}_start'
                    end_key = f'{value_key}_end'
                    result.append((
                        f'{sql_field} >= %({start_key})s AND {sql_field} <= %({end_key})s',
                        start_key,
                        val[0]
                    ))
                    result.append((
                        '',  # Empty condition, we're adding the end part
                        end_key,
                        val[1]
                    ))
                elif val is not None:
                    # Single value with operator
                    result.append((
                        f'{sql_field} {operator} %({value_key})s',
                        value_key,
                        val
                    ))
            elif isinstance(filter_value, str) and filter_value.strip():
                # Text search (LIKE)
                result.append((
                    f'{sql_field} ILIKE %({value_key})s',
                    value_key,
                    f'%{filter_value}%'
                ))

        # Filter out empty conditions and conditions with None values (self-contained)
        result = [(c, k, v) for c, k, v in result if c and (v is not None or 'today' in c)]

    except (json.JSONDecodeError, ValueError) as e:
        print(f"Error parsing TanStack filters: {e}")

    return result


def _build_order_clause(order_by: str) -> str:
    """
    Build SQL ORDER BY clause from user input.
    Default: due_date ASC
    """
    if not order_by:
        return 'ORDER BY pt.due_date ASC'

    # Map frontend field names to SQL fields
    field_map = {
        'due_date': 'pt.due_date',
        'amount': 'pt.amount',
        'term_status': 'pt.term_status',
        'creation': 'po.creation',
        'modified': 'pt.modified',
        'term_modified': 'pt.modified',
        'name': 'po.name',
        'project_name': 'po.project_name',
        'vendor_name': 'po.vendor_name',
    }

    # Parse order_by string (e.g., "due_date asc")
    parts = order_by.strip().split()
    if len(parts) >= 1:
        field = parts[0].strip('`').lower()
        direction = 'ASC'
        if len(parts) >= 2 and parts[1].upper() in ('ASC', 'DESC'):
            direction = parts[1].upper()

        sql_field = field_map.get(field, 'pt.due_date')
        return f'ORDER BY {sql_field} {direction}'

    return 'ORDER BY pt.due_date ASC'


def _calculate_aggregates(base_where: str, base_values: dict, today_date: str, allowed_projects) -> dict:
    """
    Calculate aggregate totals for summary cards.

    Returns:
        - total_credit_amount: Sum of all credit term amounts
        - total_due_amount: Sum of Created terms with past due_date
        - total_paid_amount: Sum of Paid terms
    """
    # Build base conditions for aggregates (without status filter)
    agg_conditions = ['po.status NOT IN (\'Merged\', \'Inactive\', \'PO Amendment\')', 'pt.payment_type = \'Credit\'']
    agg_values = {}

    if allowed_projects is not None:
        if len(allowed_projects) == 0:
            return {"total_credit_amount": 0, "total_due_amount": 0, "total_paid_amount": 0}
        agg_conditions.append('po.project IN %(allowed_projects)s')
        agg_values['allowed_projects'] = tuple(allowed_projects)

    agg_where = ' AND '.join(agg_conditions)

    # Single query with conditional aggregation
    agg_sql = f"""
        SELECT
            COALESCE(SUM(pt.amount), 0) as total_credit_amount,
            COALESCE(SUM(CASE
                WHEN pt.term_status = 'Created' AND pt.due_date <= %(today)s
                THEN pt.amount
                ELSE 0
            END), 0) as total_due_amount,
            COALESCE(SUM(CASE
                WHEN pt.term_status = 'Paid'
                THEN pt.amount
                ELSE 0
            END), 0) as total_paid_amount
        FROM "tabProcurement Orders" po
        INNER JOIN "tabPO Payment Terms" pt ON pt.parent = po.name
        WHERE {agg_where}
    """

    agg_values['today'] = today_date

    result = frappe.db.sql(agg_sql, agg_values, as_dict=True)

    if result and len(result) > 0:
        return {
            "total_credit_amount": float(result[0].get('total_credit_amount', 0)),
            "total_due_amount": float(result[0].get('total_due_amount', 0)),
            "total_paid_amount": float(result[0].get('total_paid_amount', 0))
        }

    return {"total_credit_amount": 0, "total_due_amount": 0, "total_paid_amount": 0}

import frappe
from frappe import _
from frappe.utils import cint
from frappe.desk.reportview import execute as reportview_execute
import re
import traceback

from .constants import LINK_FIELD_MAP, CHILD_TABLE_ITEM_SEARCH_MAP, JSON_ITEM_SEARCH_DOCTYPE_MAP
from .utils import (
    _parse_filters_input, _process_filters_for_query,
    _parse_target_search_field
)
from .token_search import tokenize

def get_facet_values_impl(
    doctype=None,
    field=None,
    filters=None,
    search_term=None,
    current_search_fields=None,
    limit=100,
    require_pending_items=False
):
    try:
        if not frappe.db.exists("DocType", doctype): frappe.throw(_("Invalid DocType: {0}").format(doctype))
        if not frappe.has_permission(doctype, "read"): frappe.throw(_("Not permitted"), frappe.PermissionError)
        
        meta = frappe.get_meta(doctype)
        field_meta = meta.get_field(field)
        
        # Standard Frappe fields that don't have explicit field_meta but are valid for facets
        STANDARD_FIELDS = ['owner', 'modified_by', 'creation', 'modified', 'docstatus', 'name']
        is_standard_field = field in STANDARD_FIELDS
        
        child_table_field_name = None
        child_doctype = None
        if not field_meta and not is_standard_field:
            # Check child tables
            for df in meta.get_table_fields():
                child_meta = frappe.get_meta(df.options)
                field_meta = child_meta.get_field(field)
                if field_meta:
                    child_table_field_name = df.fieldname
                    child_doctype = df.options
                    break
        
        if not field_meta and not is_standard_field: frappe.throw(_("Invalid field '{0}' for DocType '{1}'").format(field, doctype))
        
        raw_filters = _parse_filters_input(filters, doctype)
        # Filter out existing filters for the target field so we get all possible options
        # We handle both plain field names and prefixed ones (like 'DocType.fieldname')
        filtered_filters = [f for f in raw_filters if not (
            (len(f) == 3 and (f[0] == field or f[0].endswith(f".{field}"))) or 
            (len(f) == 4 and (f[1] == field or f[1].endswith(f".{field}")))
        )]
        processed_filters = _process_filters_for_query(filtered_filters, doctype)
        
        if search_term and current_search_fields:
            target_search_field = _parse_target_search_field(current_search_fields, doctype)

            if target_search_field and target_search_field != field:
                # If the search field is a child-table or JSON item field, do a
                # separate sub-query for matching parents and append as a
                # `name in [...]` filter. A plain LIKE on a relationship field
                # crashes (e.g. `tabProcurement Requests.order_list does not
                # exist`) because it isn't a real column on the parent table.
                search_tokens = tokenize(search_term)
                doctype_str = str(doctype)
                is_child_table_field = (
                    doctype_str in CHILD_TABLE_ITEM_SEARCH_MAP
                    and target_search_field in CHILD_TABLE_ITEM_SEARCH_MAP[doctype_str]
                )
                is_json_field = (
                    doctype_str in JSON_ITEM_SEARCH_DOCTYPE_MAP
                    and JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype_str]["json_field"] == target_search_field
                )

                if is_child_table_field and search_tokens:
                    item_search_config = CHILD_TABLE_ITEM_SEARCH_MAP[doctype_str][target_search_field]
                    child_doctype_name = str(item_search_config["child_doctype"])
                    child_link_field = str(item_search_config["link_field_to_parent"])
                    searchable_child_fields = list(item_search_config["searchable_child_fields"])
                    # Drop short tokens from SQL filter (mirrors search.py).
                    filter_tokens = [t for t in search_tokens if len(t) >= 1] or search_tokens
                    # Scope the child sub-query to parents that already match
                    # the other facet filters. Without this, `~*` falls back to
                    # a sequential scan of the full child table on every request.
                    candidate_parent_names = [
                        doc.get("name") for doc in reportview_execute(
                            doctype=doctype, filters=processed_filters,
                            fields=["name"], limit_page_length=0,
                        ) if doc.get("name")
                    ]
                    if not candidate_parent_names:
                        processed_filters.append([doctype, "name", "=", "__NO_MATCH__"])
                    else:
                        # Token-OR (union) at PARENT level: a parent qualifies if any
                        # of its rows matches any token. Matches search.py's behavior
                        # so the facet panel agrees with the list.
                        # Word-boundary regex: matches token only at start of a "word"
                        # (after whitespace/hyphen/underscore/slash/paren/start-of-string).
                        # Expand the OR clause across every (field × token) pair so
                        # the union resolves in one round-trip instead of N.
                        field_token_clauses = []
                        regex_params = []
                        for f in searchable_child_fields:
                            for token in filter_tokens:
                                field_token_clauses.append(f"`tab{child_doctype_name}`.`{f}` ~* %s")
                                regex_params.append(r"(^|[\s\-_/()])" + re.escape(token))
                        or_clause = " OR ".join(field_token_clauses)
                        sql = (
                            f"SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}` "
                            f"FROM `tab{child_doctype_name}` "
                            f"WHERE `tab{child_doctype_name}`.`{child_link_field}` IN %s "
                            f"AND `parenttype` = %s AND ({or_clause})"
                        )
                        union_set = {
                            r[0] for r in frappe.db.sql(
                                sql, (tuple(candidate_parent_names), doctype, *regex_params),
                                as_list=True,
                            ) if r and r[0]
                        }
                        item_matches = list(union_set)
                        if item_matches:
                            processed_filters.append([doctype, "name", "in", item_matches])
                        else:
                            processed_filters.append([doctype, "name", "=", "__NO_MATCH__"])
                elif is_json_field and search_tokens:
                    item_search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype_str]
                    json_field_name = item_search_config["json_field"]
                    item_path_parts = item_search_config["item_path_parts"]
                    item_name_key = item_search_config.get("item_name_key_in_json", "item")
                    json_array_key = item_path_parts[0]
                    # Drop short tokens from SQL filter (mirrors search.py).
                    filter_tokens = [t for t in search_tokens if len(t) >= 2] or search_tokens
                    # Scope the JSON sub-query to parents that already match
                    # the other facet filters. Without this, the EXISTS clause
                    # is evaluated against every row in the parent table.
                    candidate_parent_names = [
                        doc.get("name") for doc in reportview_execute(
                            doctype=doctype, filters=processed_filters,
                            fields=["name"], limit_page_length=0,
                        ) if doc.get("name")
                    ]
                    if not candidate_parent_names:
                        processed_filters.append([doctype, "name", "=", "__NO_MATCH__"])
                    else:
                        # Token-OR (union) at PARENT level — mirrors the search.py
                        # JSON branch so facets agree with the list.
                        # OR all token regex tests inside a single EXISTS so the
                        # union resolves in one round-trip; EXISTS short-circuits
                        # on the first matching JSON element per parent.
                        token_conditions = []
                        sql_params: dict = {"names_tuple": tuple(candidate_parent_names)}
                        for i, token in enumerate(filter_tokens):
                            key = f"token_{i}"
                            token_conditions.append(f"item_obj->>'{item_name_key}' ~* %({key})s")
                            sql_params[key] = r"(^|[\s\-_/()])" + re.escape(token)
                        or_clause = " OR ".join(token_conditions)
                        sql = (
                            f"SELECT DISTINCT name FROM `tab{doctype_str}` "
                            f"WHERE name IN %(names_tuple)s AND EXISTS("
                            f"SELECT 1 FROM jsonb_array_elements("
                            f"COALESCE(`tab{doctype_str}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)"
                            f") AS item_obj WHERE ({or_clause}))"
                        )
                        union_set = {
                            r[0] for r in frappe.db.sql(sql, sql_params, as_list=True)
                            if r and r[0]
                        }
                        item_matches = list(union_set)
                        if item_matches:
                            processed_filters.append([doctype, "name", "in", item_matches])
                        else:
                            processed_filters.append([doctype, "name", "=", "__NO_MATCH__"])
                else:
                    # Plain column field — original behavior
                    for token in search_tokens:
                        processed_filters.append([doctype, target_search_field, "like", f"%{token}%"])
        
        # limit=0 means no limit, otherwise use the requested limit (no artificial cap)
        limit_int = cint(limit) if cint(limit) > 0 else None
        require_pending_items_bool = (
            isinstance(require_pending_items, str) and require_pending_items.lower() == 'true'
        ) or require_pending_items is True

        names_query_args = {"doctype": doctype, "filters": processed_filters, "fields": ["name"], "limit_page_length": 0}
        matching_names = [doc.get("name") for doc in reportview_execute(**names_query_args) if doc.get("name")]
        
        # --- Apply require_pending_items filter ---
        if require_pending_items_bool and matching_names:
            if doctype in CHILD_TABLE_ITEM_SEARCH_MAP:
                # Use first available child table config (e.g., "order_list")
                child_table_key = next(iter(CHILD_TABLE_ITEM_SEARCH_MAP[doctype]))
                search_config = CHILD_TABLE_ITEM_SEARCH_MAP[doctype][child_table_key]
                child_status_field = search_config.get("status_field")
                if child_status_field:
                    child_doctype_name = search_config["child_doctype"]
                    child_link_field = search_config["link_field_to_parent"]
                    sql = (
                        f"SELECT DISTINCT `tab{child_doctype_name}`.`{child_link_field}` "
                        f"FROM `tab{child_doctype_name}` "
                        f"WHERE `{child_link_field}` IN %(names_tuple)s "
                        f"AND `parenttype` = %(parent_doctype)s "
                        f"AND `{child_status_field}` = 'Pending'"
                    )
                    sql_params = {"names_tuple": tuple(matching_names), "parent_doctype": doctype}
                    matching_names = [
                        r[0] for r in frappe.db.sql(sql, sql_params, as_list=True) if r and r[0]
                    ]
            elif doctype in JSON_ITEM_SEARCH_DOCTYPE_MAP:
                search_config = JSON_ITEM_SEARCH_DOCTYPE_MAP[doctype]
                json_field_name = search_config["json_field"]
                item_path_parts = search_config["item_path_parts"]
                json_array_key = item_path_parts[0]
                json_pending_sql = (
                    f"SELECT DISTINCT name FROM `tab{doctype}` "
                    f"WHERE name IN %(names_tuple)s AND "
                    f"EXISTS(SELECT 1 FROM jsonb_array_elements("
                    f"COALESCE(`tab{doctype}`.`{json_field_name}`::jsonb->'{json_array_key}','[]'::jsonb)"
                    f") AS item_obj WHERE item_obj->>'status' = 'Pending')"
                )
                matching_names = [
                    r[0] for r in frappe.db.sql(json_pending_sql, {"names_tuple": tuple(matching_names)}, as_list=True) if r and r[0]
                ]
        # --- End require_pending_items filter ---

        if not matching_names:
            return {"values": []}
        
        facet_values = []

        # Check if the field is a JSON field
        is_json_field = field_meta.fieldtype == 'JSON' if field_meta else False

        # Postgres rejects `column != ''` against non-text columns — comparing
        # smallint/int/timestamp to '' raises `invalid input syntax`. Only emit
        # the empty-string guard when the column actually stores text.
        _NON_TEXT_FIELDTYPES = {
            'Int', 'Float', 'Currency', 'Percent', 'Rating',
            'Date', 'Datetime', 'Time', 'Duration', 'Check',
        }
        _STANDARD_NON_TEXT_FIELDS = {'docstatus', 'creation', 'modified'}
        if is_standard_field:
            field_is_text = field not in _STANDARD_NON_TEXT_FIELDS
        elif field_meta:
            field_is_text = field_meta.fieldtype not in _NON_TEXT_FIELDTYPES
        else:
            field_is_text = True

        if child_doctype:
            limit_clause = "LIMIT %(limit)s" if limit_int else ""
            empty_check = f"AND `tab{child_doctype}`.`{field}` != ''" if field_is_text else ""
            sql = f"""
                SELECT `tab{child_doctype}`.`{field}` as value, COUNT(*) as count
                FROM `tab{child_doctype}`
                WHERE `tab{child_doctype}`.parent IN %(names)s
                  AND `tab{child_doctype}`.parenttype = %(parent_doctype)s
                  AND `tab{child_doctype}`.`{field}` IS NOT NULL
                  {empty_check}
                GROUP BY `tab{child_doctype}`.`{field}`
                ORDER BY count DESC, `tab{child_doctype}`.`{field}` ASC
                {limit_clause}
            """
            params = {"names": tuple(matching_names), "parent_doctype": doctype}
            if limit_int:
                params["limit"] = limit_int
            results = frappe.db.sql(sql, params, as_dict=True)
        elif is_json_field:
            # Special handling for JSON fields.
            # Handles both top-level arrays and objects with a 'categories' key (standard in this app)
            limit_clause = "LIMIT %(limit)s" if limit_int else ""
            sql = f"""
                SELECT value, COUNT(*) as count
                FROM (
                    SELECT jsonb_array_elements_text(
                        CASE
                            WHEN jsonb_typeof("{field}"::jsonb) = 'array' THEN "{field}"::jsonb
                            ELSE COALESCE("{field}"::jsonb->'categories', '[]'::jsonb)
                        END
                    ) as value
                    FROM "tab{doctype}"
                    WHERE name IN %(names)s
                    AND "{field}" IS NOT NULL
                ) as unnested
                GROUP BY value
                ORDER BY count DESC, value ASC
                {limit_clause}
            """
            params = {"names": tuple(matching_names)}
            if limit_int:
                params["limit"] = limit_int
            results = frappe.db.sql(sql, params, as_dict=True)
        else:
            limit_clause = "LIMIT %(limit)s" if limit_int else ""
            empty_check = f"AND `{field}` != ''" if field_is_text else ""
            sql = f"SELECT `{field}` as value, COUNT(*) as count FROM `tab{doctype}` WHERE name IN %(names)s AND `{field}` IS NOT NULL {empty_check} GROUP BY `{field}` ORDER BY count DESC, `{field}` ASC {limit_clause}"
            params = {"names": tuple(matching_names)}
            if limit_int:
                params["limit"] = limit_int
            results = frappe.db.sql(sql, params, as_dict=True)
        
        for row in results:
            value = row.get("value")
            label = value
            if value:
                # Priority 1: Check if we have a custom mapping in LINK_FIELD_MAP
                if field in LINK_FIELD_MAP:
                    try:
                        target_doctype = LINK_FIELD_MAP[field]["doctype"]
                        label_field = LINK_FIELD_MAP[field]["label_field"]
                        label = frappe.db.get_value(target_doctype, value, label_field) or value
                    except: pass
                # Priority 2: Fallback to standard Frappe title field
                elif field_meta and field_meta.fieldtype == "Link":
                    try:
                        link_meta = frappe.get_meta(field_meta.options)
                        title_field = link_meta.get_title_field()
                        if title_field and title_field != "name":
                            label = frappe.db.get_value(field_meta.options, value, title_field) or value
                    except: pass
            
            facet_values.append({"value": value, "label": label, "count": row.get("count", 0)})
        
        return {"values": facet_values}
        
    except Exception as e:
        traceback.print_exc()
        frappe.throw(_("An error occurred while fetching facet values: {0}").format(str(e)))

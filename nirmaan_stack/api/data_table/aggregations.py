import frappe
from frappe.utils import cint
import json
import traceback
from .utils import _build_safe_sql_expression

def get_aggregates(doctype, final_matching_parent_names, aggregates_config):
    aggregates_result = None
    if aggregates_config and isinstance(aggregates_config, str):
        try:
            config = json.loads(aggregates_config)
            if isinstance(config, list) and config and final_matching_parent_names:
                select_expressions = []
                valid_simple_functions = {"SUM", "AVG", "COUNT", "MIN", "MAX"}
                valid_custom_aggregates = {"SUM", "AVG", "COUNT"}
                meta = frappe.get_meta(doctype)
                
                for agg_item in config:
                    if "expression" in agg_item and "alias" in agg_item:
                        alias = agg_item.get("alias")
                        final_agg_func = agg_item.get("aggregate", "SUM").upper()
                        if not alias or not alias.isidentifier(): continue
                        if final_agg_func not in valid_custom_aggregates: continue
                        row_level_expression = _build_safe_sql_expression(agg_item["expression"], meta)
                        expression = f"{final_agg_func}({row_level_expression}) AS `{alias}`"
                        select_expressions.append(expression)
                    elif "field" in agg_item and "function" in agg_item:
                        field = agg_item.get("field")
                        func = agg_item.get("function", "").upper()
                        if meta.has_field(field) and func in valid_simple_functions:
                            alias = f"`{func.lower()}_of_{field}`"
                            if func in ["SUM", "AVG", "MIN", "MAX"]:
                                expression = f"{func}(CAST(`{field}` AS DECIMAL(21, 9))) AS {alias}"
                            else:
                                expression = f"COUNT(`{field}`) AS {alias}"
                            select_expressions.append(expression)
                
                if select_expressions:
                    query = f"SELECT {', '.join(select_expressions)} FROM `tab{doctype}` WHERE name IN %(names)s"
                    result = frappe.db.sql(query, {"names": tuple(final_matching_parent_names)}, as_dict=True)
                    if result:
                        aggregates_result = result[0]
        except Exception:
            traceback.print_exc()
    return aggregates_result

def get_group_by_results(doctype, final_matching_parent_names, group_by_config):
    group_by_result = None
    if group_by_config and isinstance(group_by_config, str):
        try:
            config = json.loads(group_by_config)
            if isinstance(config, dict) and final_matching_parent_names:
                gb_field = config.get("groupByField")
                agg_field = config.get("aggregateField")
                agg_func = config.get("aggregateFunction", "sum").upper()
                limit = cint(config.get("limit", 5))

                meta = frappe.get_meta(doctype)
                valid_fields = {f.fieldname for f in meta.fields}
                valid_numeric_fields = {f.fieldname for f in meta.fields if f.fieldtype in ['Data', 'Currency', 'Int', 'Float', 'Percent']}
                valid_functions = {"SUM", "AVG", "COUNT"}

                if gb_field in valid_fields and agg_field in valid_numeric_fields and agg_func in valid_functions:
                    agg_expression = f"{agg_func}(CAST(`{agg_field}` AS DECIMAL(21, 9)))"
                    query = f"""
                        SELECT
                            `{gb_field}` as group_key,
                            {agg_expression} as aggregate_value
                        FROM `tab{doctype}`
                        WHERE name IN %(names)s
                        GROUP BY `{gb_field}`
                        ORDER BY aggregate_value DESC
                        LIMIT %(limit)s
                    """
                    result = frappe.db.sql(query, {
                        "names": tuple(final_matching_parent_names),
                        "limit": limit
                    }, as_dict=True)
                    group_by_result = result
        except Exception:
            traceback.print_exc()
    return group_by_result

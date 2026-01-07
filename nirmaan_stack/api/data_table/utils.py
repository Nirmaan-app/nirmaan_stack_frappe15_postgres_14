import frappe
from frappe import _
from frappe.utils import cint, getdate
import frappe.utils.data
import json

def _parse_json_string_to_list(json_string: str | None, param_name: str, doctype_for_log: str) -> list | None:
    if json_string is None: return None
    if not isinstance(json_string, str): return None
    try:
        parsed_list = json.loads(json_string)
        if not isinstance(parsed_list, list): raise ValueError("Not a list")
        return parsed_list
    except (json.JSONDecodeError, ValueError):
        print(f"WARNING ({doctype_for_log}): Invalid JSON list for {param_name}: {json_string}")
        frappe.throw(_(f"Invalid JSON format for '{param_name}'."))
    return None

def _parse_filters_input(filters_input: str | list | dict | None, doctype_for_log: str) -> list:
    print(f"DEBUG (_parse_filters_input for {doctype_for_log}): Input type = {type(filters_input)}, Value = {filters_input}")
    parsed_list_of_lists = []
    parsed_input = None
    if isinstance(filters_input, str):
        try: parsed_input = json.loads(filters_input)
        except json.JSONDecodeError: return []
    elif isinstance(filters_input, (list, dict)): parsed_input = filters_input
    else: return []

    if isinstance(parsed_input, list):
        for item in parsed_input:
            if isinstance(item, list) and len(item) >= 3:
                if len(item) == 3 and isinstance(item[0], str):
                     parsed_list_of_lists.append(item)
                elif len(item) == 4 and isinstance(item[1], str):
                     parsed_list_of_lists.append(item)
                else:
                     print(f"WARNING (_parse_filters_input): Skipping malformed list filter item: {item}")
            elif isinstance(item, dict) and 'id' in item and 'value' in item:
                column_id = item['id']
                filter_value = item['value']
                if isinstance(filter_value, dict) and 'operator' in filter_value and 'value' in filter_value:
                    parsed_list_of_lists.append([column_id, filter_value['operator'], filter_value['value']])
                elif isinstance(filter_value, list):
                    if len(filter_value) > 0:
                        parsed_list_of_lists.append([column_id, 'in', filter_value])
                elif isinstance(filter_value, str):
                    if filter_value.strip():
                         parsed_list_of_lists.append([column_id, 'like', f'%{filter_value}%'])
            else:
                print(f"WARNING (_parse_filters_input for {doctype_for_log}): Unexpected item format in filters list: {item}")
    elif isinstance(parsed_input, dict):
        for k, v in parsed_input.items():
            parsed_list_of_lists.append([k, "=", v])

    return parsed_list_of_lists

def _process_filters_for_query(filters_list: list, doctype: str) -> list:
    processed_filters = []
    COMMON_DATE_FIELDS = {"creation", "modified"}
    sql_date_format = "%Y-%m-%d"

    for f in filters_list:
        if not isinstance(f, list) or len(f) < 3: continue

        field, operator, value = None, None, None
        original_filter_doctype = doctype

        if len(f) == 3:
            field, operator, value = f[0], f[1], f[2]
        elif len(f) == 4:
            if isinstance(f[0], str) and frappe.db.exists("DocType", f[0]):
                original_filter_doctype = f[0]
                field, operator, value = f[1], f[2], f[3]
            else: field, operator, value = f[0], f[1], f[2]
        else: continue

        if not isinstance(field, str) or not field.strip(): continue

        filter_processed_correctly = False
        is_date_type, is_datetime_type = False, False

        if field in COMMON_DATE_FIELDS: is_date_type, is_datetime_type = True, True
        else:
            try:
                field_meta = frappe.get_meta(original_filter_doctype).get_field(field)
                if not field_meta:
                    parent_meta = frappe.get_meta(original_filter_doctype)
                    for df in parent_meta.get_table_fields():
                        child_meta = frappe.get_meta(df.options)
                        field_meta = child_meta.get_field(field)
                        if field_meta: break
                
                if field_meta:
                    is_date_type = field_meta.fieldtype == "Date"
                    is_datetime_type = field_meta.fieldtype == "Datetime"
                    if field_meta.fieldtype == "Data" and operator in ["Timespan", "Is", "IsNot", "Between", "<=", ">="]:
                        if isinstance(value, str) and value.strip():
                            try:
                                getdate(value)
                                is_date_type = True
                            except: pass
                        elif isinstance(value, list) and len(value) > 0:
                            try:
                                first_val = value[0]
                                if isinstance(first_val, str) and first_val.strip():
                                    getdate(first_val)
                                    is_date_type = True
                            except: pass
            except: pass

        if is_date_type or is_datetime_type:
            if operator == "Timespan" and isinstance(value, str):
                try:
                    dt_range = frappe.utils.data.get_timespan_date_range(value)
                    start_dt_str = dt_range[0].strftime(sql_date_format)
                    end_dt_str = dt_range[1].strftime(sql_date_format)
                    val_start = start_dt_str + " 00:00:00.000000" if is_datetime_type else start_dt_str
                    val_end = end_dt_str + " 23:59:59.999999" if is_datetime_type else end_dt_str
                    processed_filters.append([original_filter_doctype, field, ">=", val_start])
                    processed_filters.append([original_filter_doctype, field, "<=", val_end])
                    filter_processed_correctly = True
                except: pass
            elif operator == "Is" and isinstance(value, str):
                if value.strip() == "":
                    processed_filters.append([original_filter_doctype, field, "is", "not set"])
                    filter_processed_correctly = True
                else:
                    try:
                        target_date = getdate(value)
                        target_date_str = target_date.strftime(sql_date_format)
                        if is_datetime_type:
                            start_dt_str = target_date_str + " 00:00:00.000000"
                            end_dt_str = target_date_str + " 23:59:59.999999"
                            processed_filters.append([original_filter_doctype, field, ">=", start_dt_str])
                            processed_filters.append([original_filter_doctype, field, "<=", end_dt_str])
                        else: processed_filters.append([original_filter_doctype, field, "=", target_date_str])
                        filter_processed_correctly = True
                    except: pass
            elif operator == "IsNot" and isinstance(value, str):
                if value.strip() == "":
                    processed_filters.append([original_filter_doctype, field, "is", "set"])
                    filter_processed_correctly = True
                else:
                    try:
                        target_date = getdate(value)
                        target_date_str = target_date.strftime(sql_date_format)
                        processed_filters.append([original_filter_doctype, field, "!=", target_date_str])
                        filter_processed_correctly = True
                    except: pass
            elif operator == "Between" and isinstance(value, list) and len(value)==2:
                try:
                    start_date_obj = getdate(value[0]) if value[0] else None
                    end_date_obj = getdate(value[1]) if value[1] else None
                    if start_date_obj and end_date_obj:
                        start_str = start_date_obj.strftime(sql_date_format)
                        end_str = end_date_obj.strftime(sql_date_format)
                        val_start = start_str + " 00:00:00.000000" if is_datetime_type else start_str
                        val_end = end_str + " 23:59:59.999999" if is_datetime_type else end_str
                        processed_filters.append([original_filter_doctype, field, ">=", val_start])
                        processed_filters.append([original_filter_doctype, field, "<=", val_end])
                        filter_processed_correctly = True
                except: pass
            elif operator in ["<=", ">="] and isinstance(value, str):
                 try:
                    parsed_date = getdate(value)
                    value_str = parsed_date.strftime(sql_date_format)
                    value_for_query = value_str
                    if is_datetime_type:
                         if operator == "<=": value_for_query = value_str + " 23:59:59.999999"
                         elif operator == ">=": value_for_query = value_str + " 00:00:00.000000"
                    processed_filters.append([original_filter_doctype, field, operator, value_for_query])
                    filter_processed_correctly = True
                 except: pass

        if not filter_processed_correctly:
            processed_filters.append([original_filter_doctype, field, operator, value])

    return processed_filters

def _parse_search_fields_input(search_fields_input: str | list[str] | None, doctype_for_log: str) -> list[str] | None:
    if isinstance(search_fields_input, str):
        parsed_list_from_json = _parse_json_string_to_list(search_fields_input, "current_search_fields", doctype_for_log)
        if parsed_list_from_json is not None:
             return parsed_list_from_json
    elif isinstance(search_fields_input, list):
        return search_fields_input
    return None

def _parse_target_search_field(search_fields_input: str | None, doctype_for_log: str) -> str | None:
    if not search_fields_input or not isinstance(search_fields_input, str): return None
    try:
        parsed_list = json.loads(search_fields_input)
        if isinstance(parsed_list, list) and len(parsed_list) == 1:
            return parsed_list[0]
    except: pass
    return None

def _build_safe_sql_expression(expression_obj: dict, meta) -> str:
    if not isinstance(expression_obj, dict) or "function" not in expression_obj or "args" not in expression_obj:
        frappe.throw(_("Invalid custom aggregate expression format."))
    func = expression_obj["function"].upper()
    args = expression_obj["args"]
    allowed_functions = {
        "MIN": "LEAST({0}, {1})", 
        "MAX": "GREATEST({0}, {1})",
        "ADD": "({0} + {1})", 
        "SUBTRACT": "({0} - {1})",
        "MULTIPLY": "({0} * {1})", 
        "DIVIDE": "NULLIF({0}, 0) / NULLIF({1}, 0)",
    }
    if func not in allowed_functions:
        frappe.throw(_(f"Disallowed function in custom aggregate: {func}"))
    
    processed_args = []
    for arg in args:
        if isinstance(arg, (int, float)):
            processed_args.append(str(arg))
        elif isinstance(arg, str):
            df = meta.get_field(arg)
            if not df:
                 frappe.throw(_(f"Invalid field in custom aggregate expression: {arg}"))
            if df.fieldtype in ['Currency', 'Int', 'Float', 'Percent', 'Data']:
                processed_args.append(f"COALESCE(CAST(`{arg}` AS DECIMAL(21, 9)), 0)")
            else:
                frappe.throw(_(f"Field '{arg}' is not a numeric type."))
        elif isinstance(arg, dict):
            processed_args.append(_build_safe_sql_expression(arg, meta))
    
    sql_template = allowed_functions[func]
    return sql_template.format(*processed_args)

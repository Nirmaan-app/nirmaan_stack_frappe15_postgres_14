import frappe
from frappe import _
from frappe.utils import cint
from frappe.desk.reportview import execute as reportview_execute
import json
import hashlib
import traceback

from .constants import CACHE_EXPIRY, LINK_FIELD_MAP
from .utils import (
    _parse_filters_input, _process_filters_for_query,
    _parse_target_search_field
)

def get_facet_values_impl(
    doctype=None,
    field=None,
    filters=None,
    search_term=None,
    current_search_fields=None,
    limit=100
):
    try:
        if not frappe.db.exists("DocType", doctype): frappe.throw(_("Invalid DocType: {0}").format(doctype))
        if not frappe.has_permission(doctype, "read"): frappe.throw(_("Not permitted"), frappe.PermissionError)
        
        meta = frappe.get_meta(doctype)
        field_meta = meta.get_field(field)
        
        child_table_field_name = None
        child_doctype = None
        if not field_meta:
            # Check child tables
            for df in meta.get_table_fields():
                child_meta = frappe.get_meta(df.options)
                field_meta = child_meta.get_field(field)
                if field_meta:
                    child_table_field_name = df.fieldname
                    child_doctype = df.options
                    break
        
        if not field_meta: frappe.throw(_("Invalid field '{0}' for DocType '{1}'").format(field, doctype))
        
        raw_filters = _parse_filters_input(filters, doctype)
        filtered_filters = [f for f in raw_filters if not (
            (len(f) == 3 and f[0] == field) or (len(f) == 4 and f[1] == field)
        )]
        processed_filters = _process_filters_for_query(filtered_filters, doctype)
        
        if search_term and current_search_fields:
            target_search_field = _parse_target_search_field(current_search_fields, doctype)
            if target_search_field and target_search_field != field:
                for token in search_term.split():
                    processed_filters.append([doctype, target_search_field, "like", f"%{token}%"])
        
        limit_int = min(cint(limit), 200)
        cache_key_params = {"v_api": "facet_5.2", "doctype": doctype, "field": field, "filters": json.dumps(processed_filters), "limit": limit_int}
        cache_key = f"facet_values_{hashlib.sha1(json.dumps(cache_key_params, sort_keys=True, default=str).encode()).hexdigest()}"
        
        cached_result = frappe.cache().get_value(cache_key)
        if cached_result: return cached_result
        
        names_query_args = {"doctype": doctype, "filters": processed_filters, "fields": ["name"], "limit_page_length": 0}
        matching_names = [doc.get("name") for doc in reportview_execute(**names_query_args) if doc.get("name")]
        
        if not matching_names:
            result = {"values": []}
            frappe.cache().set_value(cache_key, result, expires_in_sec=CACHE_EXPIRY)
            return result
        
        facet_values = []
        if child_doctype:
             sql = f"""
                SELECT `tab{child_doctype}`.`{field}` as value, COUNT(*) as count 
                FROM `tab{child_doctype}` 
                WHERE `tab{child_doctype}`.parent IN %(names)s 
                  AND `tab{child_doctype}`.parenttype = %(parent_doctype)s
                  AND `tab{child_doctype}`.`{field}` IS NOT NULL 
                  AND `tab{child_doctype}`.`{field}` != '' 
                GROUP BY `tab{child_doctype}`.`{field}` 
                ORDER BY count DESC, `tab{child_doctype}`.`{field}` ASC 
                LIMIT %(limit)s
            """
             results = frappe.db.sql(sql, {"names": tuple(matching_names), "parent_doctype": doctype, "limit": limit_int}, as_dict=True)
        else:
            sql = f"SELECT `{field}` as value, COUNT(*) as count FROM `tab{doctype}` WHERE name IN %(names)s AND `{field}` IS NOT NULL AND `{field}` != '' GROUP BY `{field}` ORDER BY count DESC, `{field}` ASC LIMIT %(limit)s"
            results = frappe.db.sql(sql, {"names": tuple(matching_names), "limit": limit_int}, as_dict=True)
        
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
                elif field_meta.fieldtype == "Link":
                    try:
                        link_meta = frappe.get_meta(field_meta.options)
                        title_field = link_meta.get_title_field()
                        if title_field and title_field != "name":
                            label = frappe.db.get_value(field_meta.options, value, title_field) or value
                    except: pass
            
            facet_values.append({"value": value, "label": label, "count": row.get("count", 0)})
        
        result = {"values": facet_values}
        frappe.cache().set_value(cache_key, result, expires_in_sec=CACHE_EXPIRY)
        return result
        
    except Exception as e:
        traceback.print_exc()
        frappe.throw(_("An error occurred while fetching facet values: {0}").format(str(e)))

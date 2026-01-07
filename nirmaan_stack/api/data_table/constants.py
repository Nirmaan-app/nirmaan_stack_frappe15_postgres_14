import frappe

DEFAULT_PAGE_LENGTH = 50
MAX_PAGE_LENGTH = 10000
CACHE_EXPIRY = 300 # 5 minutes

JSON_ITEM_SEARCH_DOCTYPE_MAP = {
    "Service Requests": {"json_field": "service_order_list", "item_path_parts": ["list", "*", "item"], "item_name_key_in_json": "description"},
}

CHILD_TABLE_ITEM_SEARCH_MAP = {
    "Procurement Requests": {
        "order_list": {
            "child_doctype": "Procurement Request Item Detail",
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["item_name", "item_id"],
            "status_field": "status"
        }
    },
    "Sent Back Category": {
        "order_list": {
            "child_doctype": "Procurement Request Item Detail",
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["item_name", "item_id"],
            "status_field": "status"
        }
    },
    "Procurement Orders": {
        "items": {
            "child_doctype": "Purchase Order Item",
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["item_name", "item_id"],
        }
    }
}

LINK_FIELD_MAP = {
    "project": {"doctype": "Projects", "label_field": "project_name"},
    "vendor": {"doctype": "Vendors", "label_field": "vendor_name"},
    "customer": {"doctype": "Customers", "label_field": "customer_name"},
    "owner": {"doctype": "User", "label_field": "full_name"},
    "assigned_to": {"doctype": "User", "label_field": "full_name"},
    "created_by": {"doctype": "User", "label_field": "full_name"},
}

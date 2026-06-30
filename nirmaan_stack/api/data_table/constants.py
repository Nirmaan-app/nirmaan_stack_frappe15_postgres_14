import frappe

DEFAULT_PAGE_LENGTH = 50
MAX_PAGE_LENGTH = 10000
EXPORT_MAX_PAGE_LENGTH = 100_000
CACHE_EXPIRY = 300 # 5 minutes

JSON_ITEM_SEARCH_DOCTYPE_MAP = {}

CHILD_TABLE_ITEM_SEARCH_MAP = {
    "Procurement Requests": {
        "order_list": {
            "child_doctype": "Procurement Request Item Detail",
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["item_name", "item_id"],
            "status_field": "status"
        },
        "pr_tag_list": {
            "child_doctype": "PR Tag Child Table",
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["tag_package", "tag_header"]
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
    },
    "Service Requests": {
        "work_order_items": {
            "child_doctype": "Work Order Items",
            "link_field_to_parent": "parent",
            "searchable_child_fields": ["item_name"],
        }
    }
}

# Doctypes opted into automatic token-score ranking for item searches.
# When a list page does "Item in X" search on one of these doctypes, the
# matched parents get reordered by relevance (best match first) instead of
# `modified desc`. Same matches, same total count — only order changes.
# Add more doctypes here to opt in. Soft cap of 2000 candidates per request
# is applied in search.py.
TOKEN_SCORE_OPTED_IN_DOCTYPES = {
    "Procurement Requests",
    "Procurement Orders",
    "Service Requests",
}

LINK_FIELD_MAP = {
    "project": {"doctype": "Projects", "label_field": "project_name"},
    "projects": {"doctype": "Projects", "label_field": "project_name"},
    "vendor": {"doctype": "Vendors", "label_field": "vendor_name"},
    "customer": {"doctype": "Customers", "label_field": "company_name"},
    "owner": {"doctype": "User", "label_field": "full_name"},
    "assigned_to": {"doctype": "User", "label_field": "full_name"},
    "created_by": {"doctype": "User", "label_field": "full_name"},
    "modified_by": {"doctype": "User", "label_field": "full_name"},
    "payment_by": {"doctype": "User", "label_field": "full_name"},
}

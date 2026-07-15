import frappe
from frappe.utils import create_batch

@frappe.whitelist()
def get_attachments_by_name(attachment_names):
    """
    Accepts a list of attachment names via a POST request and returns their details.
    This avoids the GET request URL length limit.

    :param attachment_names: A list of strings (attachment document names).
    """
    if not attachment_names or not isinstance(attachment_names, list):
        return []

    # The client list is intentionally large (POST to dodge URL limits). Chunk the `name IN (...)` so the
    # generated query never exceeds sqlparse's 10,000-token cap (validate_generated_query). De-dupe first so
    # a name split across two chunks can't yield a duplicate row; `IN` already de-dupes, so the merged result
    # set is byte-identical to the single-query result.
    unique_names = list(dict.fromkeys(attachment_names))
    results = []
    for chunk in create_batch(unique_names, 500):
        chunk = list(chunk)
        results.extend(frappe.get_all(
            "Nirmaan Attachments",
            fields=["name", "attachment"],
            filters=[["name", "in", chunk]],
            # Limit per chunk = chunk size, so all matching rows in the chunk are fetched.
            limit=len(chunk)
        ))
    return results
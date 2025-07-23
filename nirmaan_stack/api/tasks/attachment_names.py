import frappe

@frappe.whitelist()
def get_attachments_by_name(attachment_names):
    """
    Accepts a list of attachment names via a POST request and returns their details.
    This avoids the GET request URL length limit.

    :param attachment_names: A list of strings (attachment document names).
    """
    if not attachment_names or not isinstance(attachment_names, list):
        return []

    return frappe.get_all(
        "Nirmaan Attachments",
        fields=["name", "attachment"],
        filters=[["name", "in", attachment_names]],
        # The limit should be the length of the list to ensure all are fetched
        limit=len(attachment_names) 
    )
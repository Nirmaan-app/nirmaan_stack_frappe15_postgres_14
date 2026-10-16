import frappe
from frappe import _
from typing import Dict, Optional, Union

from nirmaan_stack.services.payees.choosing import choose_payee
from nirmaan_stack.services.payees.writer import unless_duplicate
from nirmaan_stack.services.role_profiles import assert_vendor_payee_access


@frappe.whitelist(methods=["POST"])
def create_vendor_and_address(
    # ⚠️ `int` / `float` ARE REQUIRED, not tidiness. Frappe validates a whitelisted
    # endpoint's annotations with pydantic and REJECTS THE WHOLE REQUEST on a
    # mismatch -- so once `tds_deduction_percentage` started arriving as a number,
    # the old `Dict[str, Union[str, None]]` failed every vendor creation with
    # "Input should be a valid string ... input_type=int". Any future non-string
    # field in this payload must be admitted here too.
    values: Dict[str, Union[str, int, float, None]],
    vendorType: str,
    service: bool,
    payee: Optional[str] = None,
    bank: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Union[int, str, dict, None]]:
    """
    Create New Vendor and Associated New Address entries.

    Args:
        values (Dict[str, Union[str, int, float, None]]): A dictionary mapping field
            names to values. Mostly strings; `tds_deduction_percentage` is numeric.
        vendorType (str): Vendor Type : Service | Material | Material & Service.
        service (bool): A flag indicating if the vendor is a service vendor.
        payee (str): "Use a payee already on record": the Active Payee to link the vendor to.
        bank (dict): "Enter new bank details": `{account_name, account_number, ifsc}`, made into a
            Payee by the Payee module (`services/payees/choosing.choose_payee`). Exactly one of
            `payee` / `bank` is required (spec #1420, #1425).

    The vendor's bank account is its Payee (ADR-0033); a Vendor holds no bank fields of its own. Who:
    `role_profiles.VENDOR_PAYEE_PROFILES`.

    A new vendor starts with NO categories: `tasks/vendor_category_sync.py` fills them in from the
    vendor's POs and Work Orders (owner, 21/09/2026). A stale client still sending the old category
    arguments is harmless -- Frappe drops arguments this function does not declare.

    Returns:
        Dict[str, Union[int, str]]: A dictionary containing the result of the operation.
            - "message": A success message if the operation was successful.
            - "error": An error message if the operation failed.
            - "status": 200 if the operation was successful, 409 when the bank details belong to
              a Payee already (nothing is created; "duplicate" is that Payee's summary), 400
              otherwise.
            - "payee": the vendor's Payee, on success.
    """
    assert_vendor_payee_access(frappe.session.user)
    try:
        frappe.db.begin()
        vendor_doc, duplicate = unless_duplicate(lambda: _insert_vendor(values, vendorType, payee, bank))
        if duplicate:
            return {"error": duplicate["message"], "status": 409, "duplicate": duplicate["duplicate"]}
        frappe.db.commit()

        return {"message": "Vendor created successfully.", "status": 200, "payee": vendor_doc.payee}

    except frappe.ValidationError as e:
        frappe.db.rollback()
        return {"error": str(e), "status": 400}
    except Exception as e:
        frappe.db.rollback()
        return {"error": str(e), "status": 400}


def _insert_vendor(values, vendor_type, payee, bank):
    """The vendor's Address, its Payee (`choose_payee`) and the vendor itself. Never commits."""
    address_doc = frappe.new_doc("Address")
    address_doc.address_title = values.get("vendor_name")
    address_doc.address_type = "Shop"
    address_doc.address_line1 = values.get("address_line_1")
    address_doc.address_line2 = values.get("address_line_2")
    address_doc.city = values.get("vendor_city")
    address_doc.state = values.get("vendor_state")
    address_doc.country = "India"
    address_doc.pincode = values.get("pin")
    address_doc.email_id = values.get("vendor_email")
    address_doc.phone = values.get("vendor_mobile")
    address_doc.insert(ignore_permissions=True)

    vendor_doc = frappe.new_doc("Vendors")
    vendor_doc.vendor_name = values.get("vendor_name")
    vendor_doc.vendor_nickname = values.get("vendor_nickname")
    vendor_doc.vendor_type = vendor_type
    vendor_doc.vendor_address = address_doc.name
    vendor_doc.vendor_city = address_doc.city
    vendor_doc.vendor_state = address_doc.state
    vendor_doc.vendor_contact_person_name = values.get("vendor_contact_person_name")
    vendor_doc.vendor_mobile = values.get("vendor_mobile")
    # Optional alternate number. Vendors doc only -- the Address doc carries a
    # single `phone`, which belongs to the primary contact.
    vendor_doc.vendor_alt_mobile = values.get("vendor_alt_mobile")
    vendor_doc.vendor_email = values.get("vendor_email")
    vendor_doc.vendor_gst = values.get("vendor_gst")
    vendor_doc.vendor_pan = values.get("vendor_pan")
    # The default is applied HERE, not by the doctype: this builds the doc
    # field-by-field, so whatever this line assigns wins over the field default,
    # and an omitted key would write 0.
    #
    # ⚠️ Tested against `None`/`""`, NEVER `or` -- `0 or 2` is 2, so a vendor
    # deliberately set to 0% TDS would be silently saved at 2%. The form allows
    # 0 (the zod rule is `.min(0)`), so that value is reachable, not theoretical.
    _tds = values.get("tds_deduction_percentage")
    vendor_doc.tds_deduction_percentage = 2 if _tds is None or _tds == "" else _tds
    vendor_doc.payee = choose_payee(payee, bank)
    vendor_doc.credit_limit = 50000
    vendor_doc.available_credit = 50000

    # Never None: the Vendors after_insert hook reads vendor_category["categories"].
    vendor_doc.vendor_category = {"categories": []}

    vendor_doc.insert(ignore_permissions=True)
    return vendor_doc

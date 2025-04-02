import frappe
from frappe import _
from frappe.utils import cint

def get_customer_financial_details(customer_id):
    """
    API to fetch financial details of a customer, including projects, payments,
    inflows, procurement orders, and service requests.

    Args:
        customer_id (str): The ID of the customer to fetch financial details for.

    Returns:
        dict: A dictionary containing the financial details of the customer.
    """

    try:
        # Fetch associated projects
        projects = frappe.get_all(
            "Projects",
            fields=["name", "project_name"],
            filters={"customer": customer_id},
            limit=1000
        )

        project_names = [p["name"] for p in projects]

        # Fetch project payments
        project_payments = frappe.get_all(
            "Project Payments",
            fields=["amount"],
            filters={"project": ("in", project_names)},
            limit=1000
        )

        # Fetch project inflows
        project_inflows = frappe.get_all(
            "Project Inflows",
            fields=["*"],
            filters={"customer": customer_id},
            limit=1000
        )

        # Fetch Procurement Orders
        procurement_orders = frappe.get_all(
            "Procurement Orders",
            fields=["order_list", "loading_charges", "freight_charges"],
            filters={"status": ("not in", ["Cancelled", "Merged", "PO Amendment"]), "project": ("in", project_names)},
            limit=100000,
            order_by="modified desc"
        )

        # Fetch Service Requests
        service_requests = frappe.get_all(
            "Service Requests",
            fields=["service_order_list", "gst"],
            filters={"status": "Approved", "project": ("in", project_names)},
            limit=10000,
            order_by="modified desc"
        )

        # Calculate totals
        total_amount_paid = sum(cint(p["amount"]) for p in project_payments)
        total_inflow_amount = sum(cint(i["amount"]) for i in project_inflows)

        def get_po_total(order):
            if not order or not order.get("order_list") or not order["order_list"].get("list"):
                return {"total": 0, "total_gst": 0, "total_amt": 0}

            order_data = order["order_list"]["list"]

            total, total_gst = 0, 0
            for item in order_data:
                price = cint(item.get("quote", 0))
                quantity = cint(item.get("quantity", 1))
                gst = price * quantity * (cint(item.get("tax", 0)) / 100)
                total += price * quantity
                total_gst += cint(gst)

            loading_charges = cint(order.get("loading_charges", 0))
            freight_charges = cint(order.get("freight_charges", 0))
            additional_charges = loading_charges + freight_charges
            additional_gst = loading_charges * 0.18 + freight_charges * 0.18

            return {
                "total": total + additional_charges,
                "total_gst": total_gst + additional_gst,
                "total_amt": total + total_gst + additional_charges + additional_gst,
            }

        def get_sr_total(order):
            if not order or not order.get("service_order_list") or not order["service_order_list"].get("list"):
                return {"with_gst": 0, "without_gst": 0}

            order_data = order["service_order_list"]["list"]
            without_gst, with_gst = 0, 0

            for item in order_data:
                item_total = cint(item.get("rate", 0)) * cint(item.get("quantity", 0))
                without_gst += item_total
                with_gst += item_total * (1.18 if order.get("gst") == "true" else 1)

            return {"with_gst": with_gst, "without_gst": without_gst}

        total_po_amount_with_gst = sum(get_po_total(po)["total_amt"] for po in procurement_orders)
        total_sr_amount_with_gst = sum(get_sr_total(sr)["with_gst"] for sr in service_requests)

        # Prepare response
        response = {
            "projects": projects,
            # "project_payments": project_payments,
            "project_inflows": project_inflows,
            # "procurement_orders": procurement_orders,
            # "service_requests": service_requests,
            "totals": {
                "total_amount_paid": total_amount_paid,
                "total_inflow_amount": total_inflow_amount,
                "total_po_amount_with_gst": total_po_amount_with_gst,
                "total_sr_amount_with_gst": total_sr_amount_with_gst,
                "total_amount_due": (total_po_amount_with_gst + total_sr_amount_with_gst) - total_amount_paid,
            }
        }

        return response

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), _("Error fetching customer financial details"))
        frappe.throw(_("An error occurred while fetching financial details: {}").format(e))

@frappe.whitelist()
def get_customer_financial_details_api(customer_id):
    """
    Whitelist function to expose the API.
    """
    return get_customer_financial_details(customer_id)
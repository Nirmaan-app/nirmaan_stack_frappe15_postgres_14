import frappe
from frappe import _
from frappe.utils import flt


@frappe.whitelist()
def get_delivery_challan_pos_with_categories(project_id=None):
	"""
	API to fetch Procurement Orders with 'Partially Delivered' or 'Delivered' status
	along with their categories and item details from Purchase Order Item child table.

	Args:
		project_id (str, optional): Filter POs by project ID

	Returns:
		dict: {
			"pos": List of PO records with enriched category and item data,
			"unique_categories": Sorted list of all unique categories,
			"category_counts": Dict mapping category to number of POs containing it
		}
	"""
	# Build filters for Procurement Orders
	filters = {
		"status": ["in", ["Partially Delivered", "Delivered"]]
	}

	if project_id:
		filters["project"] = project_id

	# Fetch all matching POs with required fields
	po_list = frappe.get_all(
		"Procurement Orders",
		filters=filters,
		fields=[
			"name",
			"project",
			"vendor",
			"vendor_name",
			"status",
			"dispatch_date",
			"latest_delivery_date",
			"procurement_request",
			"creation"
		],
		order_by="latest_delivery_date desc",
		limit=0
	)

	# Initialize aggregation data structures
	unique_categories = set()
	category_po_map = {}  # Tracks how many POs contain each category
	enriched_pos = []

	# Process each PO to extract item and category data
	for po in po_list:
		try:
			# Get full PO document to access child table items
			# This bypasses child table permission issues
			po_doc = frappe.get_doc("Procurement Orders", po.name)

			po_categories = set()
			items_data = []

			# Access the 'items' child table field (Purchase Order Item)
			for item in po_doc.items:
				category = item.category

				# Track categories
				if category:
					unique_categories.add(category)
					po_categories.add(category)

					# Count POs per category
					if category not in category_po_map:
						category_po_map[category] = 0

				# Build item data object
				items_data.append({
					"item_id": item.item_id,
					"item_name": item.item_name,
					"category": category,
					"quantity": flt(item.quantity),
					"received_quantity": flt(item.received_quantity),
					"unit": item.unit,
					"quote": flt(item.quote),
					"make": item.make,
					"tax": flt(item.tax) if item.tax else 0,
					"tax_amount": flt(item.tax_amount) if item.tax_amount else 0,
					"total_amount": flt(item.total_amount) if item.total_amount else 0,
					"amount": flt(item.amount) if item.amount else 0,
					"procurement_package": item.procurement_package,
					"comment": item.comment
				})

			# Increment category counts for this PO
			for category in po_categories:
				category_po_map[category] += 1

			# Build enriched PO object
			enriched_pos.append({
				"name": po.name,
				"project": po.project,
				"vendor": po.vendor,
				"vendor_name": po.vendor_name,
				"status": po.status,
				"dispatch_date": po.dispatch_date,
				"latest_delivery_date": po.latest_delivery_date,
				"procurement_request": po.procurement_request,
				"creation": po.creation,
				"categories": sorted(list(po_categories)),  # Categories in this specific PO
				"category_count": len(po_categories),
				"items": items_data,
				"item_count": len(items_data)
			})

		except Exception as e:
			# Log error but continue processing other POs
			frappe.log_error(
				message=f"Error processing PO {po.name}: {str(e)}",
				title="Delivery Challan Data API Error"
			)
			# Add PO without enriched data as fallback
			enriched_pos.append({
				**po,
				"categories": [],
				"category_count": 0,
				"items": [],
				"item_count": 0,
				"error": "Failed to load item details"
			})

	result = {
		"pos": enriched_pos,
		"unique_categories": sorted(list(unique_categories)),
		"category_counts": category_po_map,
		"total_pos": len(enriched_pos)
	}

	return result


@frappe.whitelist()
def get_unique_categories_for_delivery_challans(project_id=None):
	"""
	Lightweight API to fetch only unique categories from delivery challan POs.
	Useful for populating filter dropdowns without fetching full PO data.

	Args:
		project_id (str, optional): Filter by project ID

	Returns:
		dict: {
			"categories": Sorted list of unique category names
		}
	"""
	filters = {
		"status": ["in", ["Partially Delivered", "Delivered"]]
	}

	if project_id:
		filters["project"] = project_id

	# Get all matching PO names
	po_names = frappe.get_all(
		"Procurement Orders",
		filters=filters,
		pluck="name"
	)

	# Collect unique categories from child table items
	categories = set()

	for po_name in po_names:
		try:
			# Get categories from Purchase Order Item child table
			po_doc = frappe.get_doc("Procurement Orders", po_name)
			for item in po_doc.items:
				if item.category:
					categories.add(item.category)
		except Exception as e:
			# Log but continue
			frappe.log_error(
				message=f"Error fetching categories for PO {po_name}: {str(e)}",
				title="Get Categories Error"
			)
			continue

	return {
		"categories": sorted(list(categories)),
		"total_categories": len(categories)
	}

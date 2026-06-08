import frappe


@frappe.whitelist()
def allocate_pcus_ids(project_id: str, count: int):
	"""Return `count` sequential PCUS-NNNNNN ids for the given project, starting
	from one past the highest PCUS-* currently stored on Project TDS Item List
	rows for that project.

	Single source of truth for PCUS allocation — frontend SWR caches can go stale
	when navigating between TDS request pages, leading to id collisions if the
	caller computes the next id from a cached value. This always reads the DB.

	Note: not transactional w.r.t. concurrent approvals from different users.
	If two approvers fire at the same instant the same id may be returned twice.
	Add a unique index on (tdsi_project_id, tds_item_id) if that becomes a real
	concern.
	"""
	count = int(count)
	if count <= 0:
		return []
	if not project_id:
		frappe.throw("project_id is required")

	row = frappe.db.sql(
		"""
		SELECT tds_item_id FROM `tabProject TDS Item List`
		WHERE tdsi_project_id = %s
		  AND tds_item_id LIKE 'PCUS-%%'
		ORDER BY CAST(SUBSTRING(tds_item_id, 6) AS INTEGER) DESC
		LIMIT 1
		""",
		(project_id,),
		as_dict=True,
	)

	last_num = 0
	if row and row[0].get("tds_item_id"):
		try:
			last_num = int(row[0]["tds_item_id"].replace("PCUS-", ""))
		except ValueError:
			last_num = 0

	return [f"PCUS-{str(last_num + i + 1).zfill(6)}" for i in range(count)]

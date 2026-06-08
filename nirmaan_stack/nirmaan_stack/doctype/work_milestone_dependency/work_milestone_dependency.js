frappe.ui.form.on("Work Milestone Dependency", {
	dependency_type(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.dependency_type === "Full Dependence") {
			frappe.model.set_value(cdt, cdn, "dependency_percentage", 100);
		} else if (row.dependency_percentage === 100) {
			frappe.model.set_value(cdt, cdn, "dependency_percentage", null);
		}
	},
});

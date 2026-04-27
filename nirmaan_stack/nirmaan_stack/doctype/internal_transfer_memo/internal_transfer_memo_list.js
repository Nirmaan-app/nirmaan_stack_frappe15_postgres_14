// List view customization: show "Warehouse" when source_type/target_type is Warehouse.
frappe.listview_settings["Internal Transfer Memo"] = {
	add_fields: ["source_type", "target_type"],
	formatters: {
		source_project(value, field, doc) {
			if (doc.source_type === "Warehouse") {
				return `<span class="indicator-pill blue">Warehouse</span>`;
			}
			return value || "";
		},
		target_project(value, field, doc) {
			if (doc.target_type === "Warehouse") {
				return `<span class="indicator-pill blue">Warehouse</span>`;
			}
			return value || "";
		},
	},
};

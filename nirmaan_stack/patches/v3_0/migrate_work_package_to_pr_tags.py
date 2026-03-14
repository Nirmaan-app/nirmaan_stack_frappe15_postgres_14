import frappe
import json

def execute():
    try:
        _execute()
    except Exception as e:
        frappe.db.rollback()
        raise e

def _execute():
    # 1. Map Tag Headers: tag_package -> pr_header
    headers = frappe.get_all("PR Tag Headers", fields=["pr_header", "tag_package"])
    pkg_to_header = {h.tag_package: h.pr_header for h in headers}

    if not pkg_to_header:
        # If no headers configured, nothing to match against
        print("Migration: No PR Tag Headers found. Skipping.")
        return

    # Counters
    migration_results = {
        "total_prs_found": 0,
        "already_tagged_skipped": 0,
        "main_wp_migrated": 0,
        "item_wp_migrated": 0,
        "category_wp_migrated": 0,
        "no_mapping_found": 0,
        "critical_tags_upserted": 0
    }

    # Project Mapping Cache: project_name -> {category: package}
    project_mappings = {}

    # 2. Migrate Procurement Requests
    prs = frappe.get_all("Procurement Requests", 
                        fields=["name", "work_package", "project", "category_list"])

    migration_results["total_prs_found"] = len(prs)

    for pr_info in prs:
        # 1. Get existing tags to avoid duplicates
        existing_tags = frappe.get_all("PR Tag Child Table", 
                                      filters={"parent": pr_info.name}, 
                                      fields=["tag_package"])
        existing_pkgs = {t.tag_package for t in existing_tags}
        
        current_wp = pr_info.work_package
        tag_added = False
        
        # 2. Standardization & Multi-Fallback Smart Tagging
        if current_wp not in ["Normal", "Custom"]:
            if current_wp: # Legacy value existed (Standardize to Normal)
                if current_wp in pkg_to_header and current_wp not in existing_pkgs:
                    _add_tag(pr_info.name, pkg_to_header[current_wp], current_wp)
                    migration_results["main_wp_migrated"] += 1
                    tag_added = True
                
                frappe.db.set_value("Procurement Requests", pr_info.name, "work_package", "Normal", update_modified=False)
            else: # Empty field -> Fallback steps
                # Step 1: Item-based mapping
                items = frappe.get_all("Procurement Request Item Detail", 
                                      filters={"parent": pr_info.name}, 
                                      fields=["procurement_package"],
                                      order_by="idx asc", limit=1)
                if items:
                    pkg = items[0].procurement_package
                    if pkg and pkg in pkg_to_header and pkg not in existing_pkgs:
                        _add_tag(pr_info.name, pkg_to_header[pkg], pkg)
                        migration_results["item_wp_migrated"] += 1
                        tag_added = True

                # Step 2: Category-based mapping (Fallback)
                if not tag_added and pr_info.category_list:
                    # Cache project mappings for speed
                    if pr_info.project not in project_mappings:
                        project_mappings[pr_info.project] = {}
                        mappings = frappe.get_all("Project Work Package Category Make",
                                                 filters={"parent": pr_info.project},
                                                 fields=["category", "procurement_package"])
                        for m in mappings:
                            project_mappings[pr_info.project][m.category] = m.procurement_package
                    
                    try:
                        categories = json.loads(pr_info.category_list)
                        if isinstance(categories, list):
                            for cat in categories:
                                current_mappings = project_mappings.get(pr_info.project, {})
                                pkg = current_mappings.get(cat)
                                if pkg and pkg in pkg_to_header and pkg not in existing_pkgs:
                                    _add_tag(pr_info.name, pkg_to_header[pkg], pkg)
                                    migration_results["category_wp_migrated"] += 1
                                    tag_added = True
                                    break
                    except Exception:
                        pass
                
                frappe.db.set_value("Procurement Requests", pr_info.name, "work_package", "Custom", update_modified=False)
        
        if existing_tags:
            migration_results["already_tagged_skipped"] += 1
        elif not tag_added and not current_wp:
            migration_results["no_mapping_found"] += 1

    # 3. Sync Critical PR Tags
    # Collect all unique (project, header, package) combinations from PRs
    unique_tags = frappe.db.sql("""
        SELECT DISTINCT p.project, c.tag_header as header, c.tag_package as package
        FROM `tabProcurement Requests` p
        JOIN `tabPR Tag Child Table` c ON c.parent = p.name
    """, as_dict=True)

    for ut in unique_tags:
        # 1. Calculate the name using the same logic as the doctype's autoname
        project_id = ut.project.split("-")[-1][-5:]
        target_name = f"{project_id}-{ut.header}"

        # 2. Find all matching PRs (this combination of project/header/package)
        matching_prs = frappe.db.sql("""
            SELECT parent 
            FROM `tabPR Tag Child Table` 
            WHERE tag_header = %s AND tag_package = %s 
            AND parent IN (SELECT name FROM `tabProcurement Requests` WHERE project = %s)
        """, (ut.header, ut.package, ut.project), as_dict=True)
        
        new_pr_names = [r.parent for r in matching_prs]

        # 3. Check if record exists by name
        if frappe.db.exists("Critical PR Tags", target_name):
            # Merge PRs
            existing_doc = frappe.get_doc("Critical PR Tags", target_name)
            current_prs = []
            if existing_doc.associated_prs:
                try:
                    current_prs = json.loads(existing_doc.associated_prs).get("prs", [])
                except Exception:
                    current_prs = []
            
            # Combine and deduplicate
            merged_prs = list(set(current_prs + new_pr_names))
            associated_prs_json = json.dumps({"prs": merged_prs})
            
            frappe.db.set_value("Critical PR Tags", target_name, {
                "associated_prs": associated_prs_json
            }, update_modified=False)
        else:
            # Create new record
            associated_prs_json = json.dumps({"prs": new_pr_names})
            new_ct = frappe.get_doc({
                "doctype": "Critical PR Tags",
                "project": ut.project,
                "header": ut.header,
                "package": ut.package,
                "associated_prs": associated_prs_json
            })
            # This will use the autoname logic to set the correct name
            new_ct.insert(ignore_permissions=True)
        
        migration_results["critical_tags_upserted"] += 1

    frappe.db.commit()

    # Final Log Summary
    print("\n--- PR Tag Migration Summary ---")
    print(f"Total PRs scanned:          {migration_results['total_prs_found']}")
    print(f"Already tagged (skipped):   {migration_results['already_tagged_skipped']}")
    print(f"Migrated via Main WP:       {migration_results['main_wp_migrated']}")
    print(f"Migrated via Item WP:       {migration_results['item_wp_migrated']}")
    print(f"Migrated via Category:      {migration_results['category_wp_migrated']}")
    print(f"No valid package found:     {migration_results['no_mapping_found']}")
    print(f"Critical Tags upserted:     {migration_results['critical_tags_upserted']}")
    print("--------------------------------\n")

def _add_tag(parent_name, header, pkg):
    frappe.get_doc({
        "doctype": "PR Tag Child Table",
        "parent": parent_name,
        "parenttype": "Procurement Requests",
        "parentfield": "pr_tag_list",
        "tag_header": header,
        "tag_package": pkg,
        "idx": 0
    }).insert(ignore_permissions=True, set_name=False)

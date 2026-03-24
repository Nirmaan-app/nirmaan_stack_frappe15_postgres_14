"""
PR Tag Migration Patch Flow:
1. Setup: Queries 'PR Tag Headers' to map packages to headers and initializes tracking lists.
2. PR Iteration: Loops through all Procurement Requests to migrate their 'work_package' field.
   - If work_package has legacy text (e.g., 'Fire Fighting System'): Validates the text against headers, creates the tag row in 'PR Tag Child Table', and overwrites work_package to 'Normal'.
   - If work_package is empty: Attempts fallback logic by inspecting the PR's first item in 'Procurement Request Item Detail'.
     - Bypass: Skips tagging completely for 'Additional Charges'.
     - Hardcoded Overrides: Forcibly maps orphaned 'DX System' (HVAC VRF/DX) and 'HVAC Hardware & Accessories' (HVAC Ancillary Work).
     - Item Package: Derives tag directly from the item's 'procurement_package'.
     - Category Mapping: Matches the item's category using the Project's specific 'Project Work Package Category Make' mappings.
     * All item fallback methods (both successes and skips) result in setting the PR's work_package field to 'Custom'.
3. Critical PR Tags: Aggregates all unique (Project, Header, Package) combinations in the whole system and syncs them to the 'Critical PR Tags' dashboard documents.
4. Strict Rollback Guard: Prints a detailed summary of successful, skipped, and unmapped PRs. If even a **single PR** failed to map to a tag, it crashes deliberately to trigger a full database rollback, preventing partial data corruption. 
"""
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

    unmapped_details = []
    additional_charges_skipped = []
    category_migrated_prs = []

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
        failure_reason = ""
        
        # 2. Standardization & Multi-Fallback Smart Tagging
        if current_wp not in ["Normal", "Custom"]:
            if current_wp: # Legacy value existed (Standardize to Normal)
                if current_wp in pkg_to_header:
                    if current_wp not in existing_pkgs:
                        _add_tag(pr_info.name, pkg_to_header[current_wp], current_wp)
                        migration_results["main_wp_migrated"] += 1
                    tag_added = True
                else:
                    failure_reason = f"Legacy value '{current_wp}' not found in PR Tag Headers setup"
                
                frappe.db.set_value("Procurement Requests", pr_info.name, "work_package", "Normal", update_modified=False)
            else: # Empty field -> Fallback steps
                # Step 1 & 2: Item-based mapping
                items = frappe.get_all("Procurement Request Item Detail", 
                                      filters={"parent": pr_info.name}, 
                                      fields=["procurement_package", "category"],
                                      order_by="idx asc", limit=1)
                
                if items:
                    item = items[0]
                    pkg = item.get("procurement_package")
                    cat = item.get("category")
                    if cat == "Additional Charges":
                        tag_added = True # Avoid failure logging
                        additional_charges_skipped.append(f"{pr_info.name} ({cat})")
                        frappe.db.set_value("Procurement Requests", pr_info.name, "work_package", "Custom", update_modified=False)
                        continue
                        
                    if cat == "DX System":
                        if "HVAC System" not in existing_pkgs:
                            _add_tag(pr_info.name, "HVAC VRF/DX", "HVAC System")
                            migration_results["item_wp_migrated"] += 1
                        tag_added = True
                    elif cat == "HVAC Hardware & Accessories":
                        if "HVAC System" not in existing_pkgs:
                            _add_tag(pr_info.name, "HVAC Ancillary Work", "HVAC System")
                            migration_results["item_wp_migrated"] += 1
                        tag_added = True
                    elif pkg and pkg in pkg_to_header:
                        if pkg not in existing_pkgs:
                            _add_tag(pr_info.name, pkg_to_header[pkg], pkg)
                            migration_results["item_wp_migrated"] += 1
                        tag_added = True
                    else:
                        # Fallback to category mapping using the item's category
                        if cat:
                            if pr_info.project not in project_mappings:
                                project_mappings[pr_info.project] = {}
                                mappings = frappe.get_all("Project Work Package Category Make",
                                                         filters={"parent": pr_info.project},
                                                         fields=["category", "procurement_package"])
                                for m in mappings:
                                    project_mappings[pr_info.project][m.category] = m.procurement_package
                                    
                            cat_pkg = project_mappings.get(pr_info.project, {}).get(cat)
                            
                            if cat_pkg and cat_pkg in pkg_to_header:
                                if cat_pkg not in existing_pkgs:
                                    _add_tag(pr_info.name, pkg_to_header[cat_pkg], cat_pkg)
                                    migration_results["category_wp_migrated"] += 1
                                category_migrated_prs.append(f"{pr_info.name} (via Category: {cat} -> {cat_pkg})")
                                tag_added = True
                            else:
                                failure_reason = f"Item Category '{cat}' mapped to '{cat_pkg}' but not found in setup"
                        else:
                            failure_reason = "First item had no category and no procurement_package"
                else:
                    failure_reason = "No items found in PR"
                
                frappe.db.set_value("Procurement Requests", pr_info.name, "work_package", "Custom", update_modified=False)
        
        if existing_tags and not tag_added:
            migration_results["already_tagged_skipped"] += 1
        elif not tag_added and current_wp not in ["Normal", "Custom"]:
            migration_results["no_mapping_found"] += 1
            unmapped_details.append({
                "pr": pr_info.name,
                "reason": failure_reason
            })

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
    
    if additional_charges_skipped:
        print("\n--- Skipped PRs (Expected to not have tags) ---")
        for pr in additional_charges_skipped:
            print(f"PR: {pr}")
        print("--------------------------------\n")
        
    if category_migrated_prs:
        print("\n--- Migrated via Category Fallback ---")
        for pr in category_migrated_prs:
            print(f"PR: {pr}")
        print("--------------------------------\n")
        
    if unmapped_details:
        print("\n--- Failed PR Tag Mappings ---")
        for detail in unmapped_details:
            print(f"PR: {detail['pr']} | Reason: {detail['reason']}")
        print("--------------------------------\n")
        
        error_msg = (
            f"Migration stopped! Found {len(unmapped_details)} PRs that could not be automatically mapped to tags. "
            "All changes have been rolled back. Please check the terminal for the list of failed PRs, "
            "manually add the missing PR Tag Headers, and then run the migration again."
        )
        frappe.throw(error_msg)

    # Only commit if absolutely everything successfully mapped
    frappe.db.commit()

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

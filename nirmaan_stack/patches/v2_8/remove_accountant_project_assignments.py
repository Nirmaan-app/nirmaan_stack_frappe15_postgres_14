import frappe


def execute():
    """
    Patch to remove all project assignments from Accountant users.

    This patch:
    1. Finds all users with role_profile == "Nirmaan Accountant Profile"
    2. Removes all User Permission entries (Frappe's built-in) for Projects
    3. Removes all Nirmaan User Permissions entries for Projects
    4. Sets has_project = "false" for all affected Accountant users

    Reason: Accountants need access to all projects for financial operations
    without being restricted to specific project assignments.
    """
    print("\n" + "=" * 60)
    print("PATCH: Remove Project Assignments from Accountant Users")
    print("=" * 60)

    try:
        # Step 1: Get all accountant users
        accountant_users = frappe.get_all(
            "Nirmaan Users",
            fields=["name", "full_name", "has_project", "role_profile"],
            filters={"role_profile": "Nirmaan Accountant Profile"},
            limit=0
        )

        total_accountants = len(accountant_users)
        print(f"\nFound {total_accountants} Accountant user(s)")

        if total_accountants == 0:
            print("No Accountant users found. Nothing to do.")
            return

        # Statistics tracking
        stats = {
            "user_permissions_deleted": 0,
            "nirmaan_permissions_deleted": 0,
            "users_updated": 0,
            "errors": []
        }

        for user_record in accountant_users:
            user_name = user_record.name
            print(f"\nProcessing: {user_name} ({user_record.full_name})")

            try:
                # Step 2: Delete User Permissions (Frappe's built-in) for Projects
                frappe_permissions = frappe.get_all(
                    "User Permission",
                    filters={"user": user_name, "allow": "Projects"},
                    fields=["name", "for_value"]
                )

                for perm in frappe_permissions:
                    frappe.delete_doc(
                        "User Permission",
                        perm.name,
                        ignore_permissions=True,
                        force=True
                    )
                    stats["user_permissions_deleted"] += 1
                    print(f"  - Deleted User Permission: {perm.for_value}")

                # Step 3: Delete Nirmaan User Permissions for Projects
                nirmaan_permissions = frappe.get_all(
                    "Nirmaan User Permissions",
                    filters={"user": user_name, "allow": "Projects"},
                    fields=["name", "for_value"]
                )

                for perm in nirmaan_permissions:
                    frappe.delete_doc(
                        "Nirmaan User Permissions",
                        perm.name,
                        ignore_permissions=True,
                        force=True
                    )
                    stats["nirmaan_permissions_deleted"] += 1
                    print(f"  - Deleted Nirmaan User Permission: {perm.for_value}")

                # Step 4: Always set has_project to "false" for all Accountants
                frappe.db.set_value(
                    "Nirmaan Users",
                    user_name,
                    "has_project",
                    "false",
                    update_modified=False
                )
                stats["users_updated"] += 1
                print(f"  - Set has_project = 'false'")

            except Exception as e:
                error_msg = f"Error processing {user_name}: {str(e)}"
                print(f"  - ERROR: {error_msg}")
                stats["errors"].append(error_msg)

        # Commit changes
        frappe.db.commit()

        # Print summary
        print("\n" + "-" * 60)
        print("PATCH SUMMARY")
        print("-" * 60)
        print(f"Total Accountant Users Processed: {total_accountants}")
        print(f"User Permissions Deleted: {stats['user_permissions_deleted']}")
        print(f"Nirmaan User Permissions Deleted: {stats['nirmaan_permissions_deleted']}")
        print(f"Users Updated (has_project cleared): {stats['users_updated']}")

        if stats["errors"]:
            print(f"\nErrors Encountered: {len(stats['errors'])}")
            for error in stats["errors"]:
                print(f"  - {error}")

        print("\nPatch completed successfully.")
        print("=" * 60 + "\n")

    except Exception as e:
        print(f"\nCRITICAL ERROR during patch execution: {e}")
        frappe.db.rollback()
        raise

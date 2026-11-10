"""Seed for `walk_link_fields.py` (#1680). Writes to the env DB only; safe to run again. Prints one JSON line.

    devenv.sh script <task> .claude/skills/verify/bin/link_fields_seed.py billing <billing executive email>
    devenv.sh script <task> .claude/skills/verify/bin/link_fields_seed.py design <design executive email>
    devenv.sh script <task> .claude/skills/verify/bin/link_fields_seed.py commission <link>

billing     makes the user a manager of the env's first billing package (Add Bill shows only on a package the user
            manages); prints the tracker, its project and the project's name.
design      picks a Submitted task assigned to the user, on a WIP or Handover project's tracker with one task of
            that name; prints the tracker, its project name, the task name and phase. Writes nothing.
commission  no screen writes a commission task's report link, and the one screen that shows it is a handover
            document's Sources (HOD Tracker). So: on a project with a handover document, pick a commission task of
            that document's system with no signed copy and no filled report, store <link> as its report link and
            set it Client Accepted (Sources offers only finished tasks, and shows the link only when the task has
            nothing better). Prints the project name and the task name.
"""

import json
import sys

import frappe

kind, arg = sys.argv[1], sys.argv[2]

if kind == "billing":
    tracker = frappe.get_all("Project Billing Tracker", fields=["name"], order_by="creation", limit=1)
    if not tracker:
        sys.exit("link_fields_seed: no Project Billing Tracker on this env")
    doc = frappe.get_doc("Project Billing Tracker", tracker[0].name)
    if arg not in {row.manager for row in doc.billing_managers}:
        doc.append("billing_managers", {"manager": arg})
        doc.save(ignore_permissions=True)
        frappe.db.commit()
    out = {"tracker": doc.name, "project": doc.project, "package": doc.package}
    out["project_name"] = frappe.db.get_value("Projects", doc.project, "project_name")

elif kind == "design":
    rows = frappe.db.sql(
        """
        select t.parent, p.project_name, t.task_name, t.task_phase
        from "tabDesign Tracker Task Child Table" t join "tabProject Design Tracker" p on p.name = t.parent
        where t.assigned_designers::text like %(user)s and t.task_status in ('Submitted', 'Revision Submitted')
          and coalesce(p.hide_design_tracker, 0) = 0
          -- a non-admin's list shows only WIP and Handover projects
          and p.project in (select name from "tabProjects" where status in ('WIP', 'Handover'))
          and (select count(*) from "tabDesign Tracker Task Child Table" o
               where o.parent = t.parent and o.task_name = t.task_name) = 1
        order by p.project_name, t.idx
        limit 1
        """,
        {"user": f'%"{arg}"%'},
        as_dict=True,
    )
    if not rows:
        sys.exit(f"link_fields_seed: no Submitted task assigned to {arg}")
    out = {k: rows[0][k] for k in ("project_name", "task_name", "task_phase")} | {"tracker": rows[0].parent}

elif kind == "commission":
    rows = frappe.db.sql(
        """
        select t.name, t.parent, pr.project_name, t.task_name
        from "tabCommission Report Task Child Table" t
        join "tabProject Commission Report" p on p.name = t.parent
        join "tabProjects" pr on pr.name = p.project
        join "tabCommission Report Category" c on c.name = t.commission_category
        where coalesce(t.approval_proof, '') = ''
          and coalesce(t.response_data::text, '') in ('', 'null', '{}')
          and exists (select 1 from "tabProject HOD Document" d join "tabHOD System" s on s.name = d.hod_system
                      where d.project = p.project and s.work_package = c.work_package)
          and (select count(*) from "tabCommission Report Task Child Table" o
               where o.parent = t.parent and o.task_name = t.task_name) = 1
        order by (t.file_link = %(link)s) desc nulls last, pr.project_name, t.idx
        limit 1
        """,
        {"link": arg},
        as_dict=True,
    )
    if not rows:
        sys.exit("link_fields_seed: no commission task of a handover document's system without a report")
    doc = frappe.get_doc("Project Commission Report", rows[0].parent)
    for task in doc.commission_report_task:
        if task.name == rows[0].name:
            task.file_link = arg
            task.task_status = "Client Accepted"
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    out = {"project_name": rows[0].project_name, "task_name": rows[0].task_name}

else:
    sys.exit(f"link_fields_seed: unknown kind {kind!r}")

print(json.dumps(out, default=str))

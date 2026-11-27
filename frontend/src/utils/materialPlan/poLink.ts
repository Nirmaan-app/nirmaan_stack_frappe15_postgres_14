// "Link PO" (a New PO plan whose PO now exists) and "Change PO" (an Existing PO plan on the wrong PO) in the
// Material Plan Edit form. Pure, so the rules are testable without React (F4); `EditMaterialPlanForm` wires them.
//
// Rules (owner, 27 Nov 2026):
// - The plan becomes "Existing PO" on the picked PO, and its items are the picked PO items the user ticked. The
//   old items (a New PO plan's typed-in names, or the old PO's items) are dropped: a plan holds one PO's items.
// - Category / task / sub-category follow the same rule as Add Material Plan: from the picked PO's Critical PO
//   task when it has one (the plan's own task first, if the PO is linked to it), else the plan keeps its own.
// - Delivery date, status and remarks are not touched here.

/** A PO as `get_all_project_pos` returns it (only the fields these rules read). */
export interface ProjectPO {
  name: string;
  vendor?: string | null;
  vendor_name?: string | null;
  status?: string | null;
  items?: POItem[];
  associated_tasks?: POTask[];
}

/** One PO item row (`Purchase Order Item`). */
export interface POItem {
  name: string;
  item_id?: string | null;
  item_name: string;
  procurement_package?: string | null;
  category?: string | null;
}

/** A Critical PO Task a PO is linked to. */
export interface POTask {
  task_name?: string | null;
  item_name?: string | null;
  category?: string | null;
  sub_category?: string | null;
}

/** The plan's Critical PO fields. */
export interface PlanCriticalFields {
  critical_po_category?: string | null;
  critical_po_task?: string | null;
  critical_po_sub_category?: string | null;
}

/** Whether the PO is linked to the plan's own Critical PO task (same task name, and same category when known). */
export function isLinkedToPlanTask(po: ProjectPO, plan: PlanCriticalFields): boolean {
  if (!plan.critical_po_task) return false;
  return (po.associated_tasks ?? []).some(
    (t) =>
      t.item_name === plan.critical_po_task &&
      (!plan.critical_po_category || t.category === plan.critical_po_category),
  );
}

/** The project's POs for the picker: those linked to the plan's task first, otherwise in the order given. */
export function sortPOsForPlan(pos: ProjectPO[] | undefined, plan: PlanCriticalFields): ProjectPO[] {
  const list = pos ?? [];
  const linked = list.filter((po) => isLinkedToPlanTask(po, plan));
  const others = list.filter((po) => !isLinkedToPlanTask(po, plan));
  return [...linked, ...others];
}

/**
 * The POs the picker lists. Like Add Material Plan: by default only the POs linked to the plan's task; with
 * `showAll` ("See all project POs") every active project PO, the task's own first.
 */
export function posForPicker(pos: ProjectPO[] | undefined, plan: PlanCriticalFields, showAll: boolean): ProjectPO[] {
  const sorted = sortPOsForPlan(pos, plan);
  return showAll ? sorted : sorted.filter((po) => isLinkedToPlanTask(po, plan));
}

/** Which task(s) a PO belongs to, for the "all project POs" list: "Duct Supporting Material, GI Sheet" or "no task". */
export function poTaskLabel(po: ProjectPO): string {
  const names = [...new Set((po.associated_tasks ?? []).map((t) => t.item_name).filter(Boolean))];
  return names.length ? names.join(", ") : "no task";
}

/**
 * A PO's line in the picker: "PO/105/… · Vendor · 4 items"; in the all-POs list a PO of another task also names
 * that task ("· task: Duct Supporting Material"), so a wrong pick is obvious.
 */
export function poOptionLabel(po: ProjectPO, plan: PlanCriticalFields, showAll: boolean): string {
  const count = po.items?.length ?? 0;
  return [
    po.name,
    po.vendor_name,
    `${count} item${count === 1 ? "" : "s"}`,
    showAll && !isLinkedToPlanTask(po, plan) ? `task: ${poTaskLabel(po)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The plan's Critical PO fields after it moves onto `po` (the Add Material Plan rule). */
export function criticalFieldsForPO(po: ProjectPO, plan: PlanCriticalFields): Required<PlanCriticalFields> {
  const tasks = po.associated_tasks ?? [];
  const own = tasks.find(
    (t) =>
      t.item_name === plan.critical_po_task &&
      (!plan.critical_po_category || t.category === plan.critical_po_category),
  );
  const task = own ?? tasks[0];
  if (task) {
    return {
      critical_po_category: task.category || null,
      critical_po_task: task.item_name || null,
      critical_po_sub_category: task.sub_category || null,
    };
  }
  return {
    critical_po_category: plan.critical_po_category || null,
    critical_po_task: plan.critical_po_task || null,
    critical_po_sub_category: plan.critical_po_sub_category || null,
  };
}

/** The plan's item list from the ticked PO items, in the PO's order, with the fields a plan stores. */
export function planItemsFromPO(items: POItem[] | undefined, isTicked: (rowName: string) => boolean) {
  return (items ?? [])
    .filter((item) => isTicked(item.name))
    .map((item) => ({
      name: item.name,
      item_id: item.item_id,
      item_name: item.item_name,
      procurement_package: item.procurement_package,
      category: item.category,
    }));
}

/** The fields an Edit save writes when the plan is moved onto `po` (Link PO or Change PO). */
export function poLinkUpdate(po: ProjectPO, isTicked: (rowName: string) => boolean, plan: PlanCriticalFields) {
  return {
    po_type: "Existing PO",
    po_link: po.name,
    mp_items: JSON.stringify({ list: planItemsFromPO(po.items, isTicked) }),
    ...criticalFieldsForPO(po, plan),
  };
}

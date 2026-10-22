/**
 * boqSelection.ts -- the Won project's BoQ split (ADR-0037), as pure rules (ADR-0010 F4).
 *
 * A Won project's BoQs are shown in two tables: **Selected BoQs** (status `Selected`) and
 * **Other BoQs** (every other status -- Draft, and the unused Approved / Superseded). An Admin moves
 * BoQs between them in bulk; the server rule is `controllers/boqs.change_boq_selection`.
 *
 * The word "selected" means the STATUS here. A ticked box in either table is "checked", never
 * "selected" (GLOSSARY.md, Selected BoQ).
 */

/** The status an Admin action moves BoQs TO: "Mark as Selected" or "Move to Draft". */
export type BoqSelectionTarget = "Selected" | "Draft";

export const SELECTED_STATUS = "Selected";

/** Split a Won project's BoQs into the Selected table and the Other table, keeping their order. */
export function splitWonProjectBoqs<T extends { status?: string | null }>(
  rows: T[],
): { selected: T[]; other: T[] } {
  const selected: T[] = [];
  const other: T[] = [];
  for (const row of rows) (row.status === SELECTED_STATUS ? selected : other).push(row);
  return { selected, other };
}

/** True when the action would leave the project with no Selected BoQ -- the warning case (D7). */
export function leavesNoSelectedBoq(
  target: BoqSelectionTarget,
  checkedCount: number,
  selectedCount: number,
): boolean {
  return target === "Draft" && checkedCount > 0 && checkedCount >= selectedCount;
}

/** The action button's label for a table: Other BoQs mark, Selected BoQs move back. */
export function selectionActionLabel(target: BoqSelectionTarget): string {
  return target === "Selected" ? "Mark as Selected" : "Move to Draft";
}

/** The confirm dialog's title and body for an action on `count` checked BoQs. */
export function selectionConfirmCopy(
  target: BoqSelectionTarget,
  count: number,
  emptiesSelected: boolean,
): { title: string; description: string } {
  const noun = `${count} BoQ${count === 1 ? "" : "s"}`;
  if (target === "Selected") {
    return {
      title: `Move ${noun} to Selected?`,
      description: "Users with BoQ access will be able to edit them.",
    };
  }
  if (emptiesSelected) {
    return {
      title: `Move ${noun} to Draft and leave no Selected BoQ?`,
      description:
        "This leaves the project with no Selected BoQ. Only an Admin will be able to edit its " +
        "BoQs until one is selected again.",
    };
  }
  return {
    title: `Move ${noun} to Draft?`,
    description: "They move to Other BoQs, where only an Admin can edit them.",
  };
}

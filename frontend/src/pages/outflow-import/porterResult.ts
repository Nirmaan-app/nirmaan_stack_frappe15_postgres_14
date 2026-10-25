// src/pages/outflow-import/porterResult.ts
//
// The Porter import's result after Create (#1561, spec #1554 stories 47-52), as pure data. No React, no fetch.
// `PorterResult` renders it under the import's summary: each order Create could not create, named with the
// reason Create stored and its fix on the same row, then links to the created expenses and to Move.

/**
 * How a failed order is fixed: placed on a Won project again (its project is no longer Won), or Create run
 * again as it stands. The server decides it from the line as it stands now (`porter_records.failed_lines`).
 */
export type FailedLineFix = "re-place" | "retry";

/** One line Create could not create, as `get_porter_status` / `get_porter_review` return it (`failed_lines`). */
export interface PorterFailedLine {
    /** The Outflow Import Row: what a placement is saved on. */
    name: string;
    /** Its Porter Order. */
    crn: string;
    /** The sentence Create stored on the line. */
    note: string | null;
    fix: FailedLineFix;
    project: string | null;
    project_name: string | null;
}

export interface FailedRow {
    name: string;
    crn: string;
    why: string;
    fix: FailedLineFix;
    /** The fix button's words. */
    action: string;
}

export interface PorterResultView {
    /** "N orders couldn't be created" or "All N expenses created."; null when neither is true yet. */
    heading: string | null;
    failed: FailedRow[];
    /** Null until an expense exists. */
    expensesLabel: string | null;
    /** Null until an expense exists, and for anyone who may not move an order. */
    moveLabel: string | null;
}

const FIX_ACTION: Record<FailedLineFix, string> = { "re-place": "Choose project", retry: "Try again" };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What the result shows once Create has run, or null: before Create has started, and while its job is queued
 * or running (the progress bar says "Creating" then).
 */
export const porterResult = (
    status:
        | {
              state: string;
              created: number;
              create_running: boolean;
              failed_lines?: PorterFailedLine[];
          }
        | null
        | undefined,
    { canMove }: { canMove: boolean },
): PorterResultView | null => {
    if (!status || status.create_running) return null;
    if (status.state !== "Creating" && status.state !== "Created") return null;
    const failed = (status.failed_lines ?? []).map((line) => ({
        name: line.name,
        crn: line.crn,
        why: line.note || "Create could not create this order.",
        fix: line.fix,
        action: FIX_ACTION[line.fix],
    }));
    const heading =
        status.state === "Created"
            ? `All ${plural(status.created, "expense", "expenses")} created.`
            : failed.length > 0
              ? `${plural(failed.length, "order", "orders")} couldn't be created`
              : null;
    const created = status.created > 0;
    return {
        heading,
        failed,
        expensesLabel: created ? `View the ${plural(status.created, "expense", "expenses")}` : null,
        // Move (Rectify) is Admin and Accountant Lead only, as the lines' Move button is (`canUndoOutflow`).
        moveLabel: created && canMove ? "Move an order to another project" : null,
    };
};

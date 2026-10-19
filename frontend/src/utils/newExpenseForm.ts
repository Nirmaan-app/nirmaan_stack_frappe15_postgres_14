/**
 * Which fields the New Expense form asks, driven by the expense type (spec #1494, ticket #1501).
 * Pure, so the rule tests without React; `NewExpenseRequestDialog` renders what it returns.
 *
 * The order on screen is Type, Amount, Project, Vendor, Who gets paid, then the details: the type's
 * own questions when it has a form, otherwise Description (required) and Comment (optional).
 * Who gets paid has its own rule (`utils/payees/expensePayee`).
 */

import type { RequestCatalogType } from "@/types/NirmaanStack/ExpenseRequest";

/** The Project field: absent on a non-project type, required on a project-only type. */
export type ProjectField = "hidden" | "optional" | "required";

/** What the form asks after Who gets paid: the type's own questions, or a Description. */
export type DetailsField = "none" | "loading" | "form" | "description";

export interface NewExpenseFieldsInput {
    /** The picked type's catalog entry; undefined until a type is picked. */
    type: Pick<RequestCatalogType, "project_allowed" | "project_required" | "has_format"> | undefined;
    /** A project is chosen on the form. */
    projectChosen: boolean;
    /** The type's form is still being fetched. */
    formatLoading: boolean;
    /** The type's form was fetched and parsed. */
    formatReady: boolean;
}

export interface NewExpenseFields {
    project: ProjectField;
    /** The optional Vendor picker. */
    vendor: boolean;
    details: DetailsField;
}

/**
 * The fields to show for the picked type.
 *
 * The Vendor shows only once a project is chosen: `Non Project Expenses` has no vendor column, and
 * the server refuses a vendor without a project (`create.guard_vendor_scope`). A type whose form is
 * switched off, or cannot be parsed, asks for a Description, which the server then requires
 * (`create.guard_request_form`). While a form is loading neither is shown, so the Description never
 * flashes up and vanishes.
 */
export const newExpenseFields = ({
    type, projectChosen, formatLoading, formatReady,
}: NewExpenseFieldsInput): NewExpenseFields => {
    if (!type) return { project: "hidden", vendor: false, details: "none" };
    const project: ProjectField = !type.project_allowed
        ? "hidden"
        : type.project_required ? "required" : "optional";
    const details: DetailsField = formatReady
        ? "form"
        : type.has_format && formatLoading ? "loading" : "description";
    return { project, vendor: project !== "hidden" && projectChosen, details };
};

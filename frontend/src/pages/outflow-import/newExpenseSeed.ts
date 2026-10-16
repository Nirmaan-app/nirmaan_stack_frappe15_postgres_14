// src/pages/outflow-import/newExpenseSeed.ts
//
// What the decision dialog's "Create a new expense" form opens with (#1314, owner Q6). Pure: no React,
// no fetch. `DecisionDialog` renders it; `newExpenseSeed.test.ts` pins it.

import type { RowDecision } from "./outflowTableModel";
import { SPENDER_NAMED_SOURCES } from "./outflowImportStatus";

const PROJECT_EXPENSE = "Project Expenses";
const NON_PROJECT_EXPENSE = "Non Project Expenses";

type NewExpense = NonNullable<RowDecision["newExpense"]>;

interface SeedRow {
    suggested_doctype?: string | null;
    suggested_expense_type?: string | null;
    resolved_project?: string | null;
}

/**
 * The longest comment the Create form accepts. The server stores it as `<typed> · Imported from
 * <batch>` in a 140-character field (`import_comment.COMMENT_MAX_LENGTH`), and a batch name is fixed
 * at 12 characters, so 100 always fits; `commentCapParity.test.ts` checks that against the server's text.
 */
export const NEW_EXPENSE_COMMENT_MAX = 100;

/**
 * The form's starting values: a project expense with an EMPTY description -- or, on a line
 * that carries a Cashbook PLAN, that plan's ledger, expense type and project (a reopened Cashbook line,
 * #1314). The person can change every one of them.
 *
 * ⚠️ THE PLAN IS RECOGNISED BY ITS EXPENSE TYPE, NEVER BY `suggested_doctype` ALONE. On every other
 * source `suggested_doctype` is the ledger of a record the MATCHER suggested, which says nothing about
 * what a NEW expense should be; only the Cashbook import writes `suggested_expense_type`.
 */
export const newExpenseSeed = (row: SeedRow): NewExpense => {
    // ⚠️ EMPTY, NOT THE STATEMENT'S REMARK (owner ruling). On a bank statement the remark is already
    // the expense's Payment reference, so a prefill wrote it twice. Left empty, the server fills
    // "payee - remark" (`_default_description`) -- the same sentence the Cashbook job writes, so a
    // reopened Cashbook line created here still matches the ones the job created.
    const description = "";
    const doctype = (row.suggested_doctype ?? "").trim();
    const expenseType = (row.suggested_expense_type ?? "").trim();
    if (!expenseType || (doctype !== PROJECT_EXPENSE && doctype !== NON_PROJECT_EXPENSE)) {
        return { doctype: PROJECT_EXPENSE, description };
    }
    return {
        doctype,
        expenseType,
        project: doctype === PROJECT_EXPENSE ? (row.resolved_project ?? "").trim() || null : null,
        description,
    };
};

/**
 * Who the server will write as the new expense's Paid by, when the statement names them -- the
 * Cashbook `From` column (`expenses._statement_spender`, #1314 trap 4) -- else `null`, when the server
 * writes the person recording it. The form shows it read-only, like the amount and date.
 */
export const statementSpender = (row: { source?: string | null; added_by_raw?: string | null }): string | null =>
    SPENDER_NAMED_SOURCES.has((row.source ?? "").trim()) ? (row.added_by_raw ?? "").trim() || null : null;

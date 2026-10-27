export interface ExpenseType {
    name: string
    creation: string
    modified: string
    owner: string
    modified_by: string
    docstatus: 0 | 1 | 2
    parent?: string
    parentfield?: string
    parenttype?: string
    idx?: number
    /**	Project Type Name : Data	*/
    expense_name: string
    project?: boolean
    non_project?: boolean
    /** Optional JSON form format for Expense Requests of this type. Empty is normal. */
    source_format?: string | null
    /** "Enable Source": on => the request dialog shows `source_format`; off => the standard
     *  fields. Cannot be on without a format. */
    source_format_enabled?: 0 | 1 | boolean
    /** Who gets paid on a request of this type: Required / Optional / Not asked (the default).
     *  See `utils/payees/expensePayee`. */
    payee_rule?: string | null
    /** "Confirmed as Expense Request": a label only, changed by Admin alone (spec #1494). */
    confirmed_as_request?: 0 | 1 | boolean
}
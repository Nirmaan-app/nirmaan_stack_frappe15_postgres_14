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
    /** Groups this type. Kept on the master but no longer shown in the app. */
    expense_category?: string | null
    /** Optional JSON form format for Expense Requests of this type. Empty is normal. */
    source_format?: string | null
}
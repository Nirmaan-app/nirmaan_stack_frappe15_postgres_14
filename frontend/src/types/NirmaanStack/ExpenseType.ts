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
}
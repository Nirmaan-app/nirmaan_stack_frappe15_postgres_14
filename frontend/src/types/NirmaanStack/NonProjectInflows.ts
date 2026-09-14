/** Non Project Inflows -- money the company receives that belongs to no project and no customer. */
export interface NonProjectInflows {
	name: string
	creation: string
	modified: string
	owner: string
	modified_by: string
	/**	Inflow Type : Select - Interest Payouts / FD Closures / Loan Received / Others	*/
	inflow_type: string
	/**	Description : Text - required when the type is Others	*/
	description?: string | null
	/**	UTR : Text	*/
	utr?: string | null
	/**	Inflow Attachment : Attach	*/
	inflow_attachment?: string | null
	/**	Amount : Currency	*/
	amount: number
	/**	Payment Date : Date	*/
	payment_date?: string | null
}

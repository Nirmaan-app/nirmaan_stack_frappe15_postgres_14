# ADR 0045 — Expense bills live apart from Vendor Invoices, for now

**Status:** Accepted · 2026-11-07 (owner grilling) · Spec #1637

A wallet spend's or card spend's bill now gets a Bill check and an approval, as a PO or WO Vendor Invoice does.
We decided to keep these **expense bills** in a record of their own, one row per bill for both expense ledgers,
and not as rows of `Vendor Invoices`. About 32 places read `Vendor Invoices` and assume a Purchase Order or a
Work Order behind each row (the invoiced total, invoice quantities, the WO badge and links, the attachment
record), so an expense row there would be mis-summed or mis-shown. Fields on the two expense records were
rejected too: the same ten fields twice, two tables for one approval queue, and a replaced bill would erase
the old one.

The owner's goal is one place for every invoice: PO, WO, Cashbook, Credit Card and Porter. The new record
therefore uses the Vendor Invoice's field names and statuses (`invoice_no`, `invoice_date`, `invoice_amount`,
`uploaded_by`, `status` Pending / Approved / Rejected, `approved_by`, `approved_on`, `rejection_reason`,
`auto_approved`), so that joining them later moves rows and redesigns nothing. Two fields are the expense
bill's own, with no Vendor Invoice counterpart: `rejected_by` and `rejected_on`, since a Vendor Invoice records
no rejecter and the spec asks that every decision be traceable (story 35). A reader who finds two invoice
records side by side should know it is a step on that road, not the end of it.

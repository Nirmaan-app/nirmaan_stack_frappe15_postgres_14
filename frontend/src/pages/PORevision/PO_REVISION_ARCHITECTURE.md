# PO Revision Architecture Documentation

This document outlines the architecture and workflows associated with the PO Revision feature.

## 1. PO Revision Warning Logic

The PO Revision Warning is a critical UI component that prevents concurrent modifications to a Procurement Order (PO) when a revision is already in progress.

### Frontend Component
* **Component Name:** `PORevisionWarning` (`frontend/src/pages/PORevision/PORevisionWarning.tsx`)
* **Usage:** Imported and used in `frontend/src/pages/ProcurementOrders/purchase-order/PurchaseOrder.tsx`
* **Purpose:** Displays a red alert banner at the top of the Purchase Order detail page if the PO is locked. It informs the user why it's locked and provides a quick link to view the pending revision.
* **Mechanism:** 
  * It accepts the `poId` as a prop.
  * On mount or when `poId` changes, it makes a POST request to the backend API.
  * If the response indicates the PO `is_locked`, it renders the alert with the specific `role` (Original or Target) and a link to the `revision_id`.

### Backend API
* **API Endpoint:** `nirmaan_stack.api.po_revisions.revision_po_check.check_po_in_pending_revisions`
* **File Location:** `nirmaan_stack/api/po_revisions/revision_po_check.py`
* **Logic:**
  The backend performs two specific checks to determine if a PO is locked:
  
  1. **Check 1: As Original PO (`_check_pending_as_original`)**
     * It queries the `PO Revisions` doctype to see if there is any document with `status = "Pending"` where the `revised_po` field matches the given `po_id`.
     * **Reasoning:** If a PO is currently being revised, we cannot allow other users to make standard payments or amendments to it until the draft revision is resolved (Approved/Rejected), as it would cause financial desynchronization.

  2. **Check 2: As Target PO (`_check_pending_as_target`)**
     * It iterates through all `Pending` PO Revisions and inspects their JSON payload (`payment_return_details`).
     * It looks specifically for a "Negative Flow" refund adjustment where the `return_type` is `"Against-po"`.
     * It parses the JSON to see if the given `po_id` is listed in the `target_pos` array.
     * **Reasoning:** Even if a PO isn't the one being actively revised, it might be slated to receive transferred credit from *another* PO's revision. If so, it must be locked to prevent users from accidentally paying off terms that are about to be covered by the incoming credit transfer once the revision is approved.

===============================================================================================
===============================================================================================

## 2. Revise PO Button Logic

The "Revise PO" button initiates the PO Revision workflow from the Procurement Orders module.

### Frontend Component
* **Component Name:** `PODetails` (`frontend/src/pages/ProcurementOrders/purchase-order/components/PODetails.tsx`)
* **Location in UI:** Rendered within the "Invoices" section of the main PODetails card (around line 705).
* **Visibility Conditions:**
  The "Revise PO" button is highly conditional and only appears if **ALL** of the following base constraints are met:
  1. **Valid Status:** The PO's status must be `"Dispatched"`, `"Partially Delivered"`, or `"Delivered"`.
  2. **Not Locked:** The PO must *not* currently be locked by an existing pending revision (`isLocked === false`).

  If the base constraints are met, the button renders if there is a discrepancy between the PO amount and uploaded invoices:

  **The Red Warning Banner 🔴 (When Amounts Don't Match)**
  * **When it shows:** If the total amount of all Invoices uploaded for this PO is different from the actual PO's total amount (by more than ₹1).
  * **Why it shows this way:** This serves as a prominent alert to the user. Since the invoices they've received are charging a different amount than what the PO says, they likely *need* to revise the PO to match the new charged amount.
  * **What it looks like:** A red alert box saying: *"Total PO Amount and Total Invoice Amount is not matching. Revise the PO to handle this amount change? [Revise PO]"*

### Example Scenarios

To make it perfectly clear when and how the Revise PO button appears, here are 4 real-world examples:

**Example 1: The Invoice Overcharge (Shows Red Warning Banner)**
* **Scenario:** A PO is *"Partially Delivered"*, not locked. The total PO amount was approved at ₹10,000. However, the vendor sent invoices totaling ₹12,000.
* **Result:** Because of the ₹2,000 mismatch (>₹1 difference), the system displays the prominent red warning banner: **"Total PO Amount and Total Invoice Amount is not matching"**. A revision is heavily encouraged to fix the discrepancy.

**Example 2: Locked by Another Revision (Hidden Completely)**
* **Scenario:** A PO is *"Delivered"*. A manager clicked "Revise PO" yesterday and submitted a revision request which is still pending approval from the CEO.
* **Result:** The PO is now locked (`isLocked = true`). The Revise PO button **completely disappears** until that pending revision is either approved or rejected, to prevent conflicting revisions.

**Example 3: Too Early to Revise (Hidden Completely)**
* **Scenario:** A PO has just been *"PO Approved"* but nothing has been shipped or dispatched yet.
* **Result:** Because the status is not Dispatched, Partially Delivered, or Delivered, the Revise PO button is **completely hidden**. (Revisions shouldn't happen before goods begin moving).

**Example 4: Locked as a Target for Credit (Hidden Completely)**
* **Scenario:** A PO is *"Dispatched"* and seems perfectly fine. *However*, another PO for the exact same vendor is currently being revised downward, and the user chose to transfer the resulting credit/refund into *this* PO.
* **Result:** Because this PO is flagged as a "Target PO" in a pending negative revision, it is locked (`isLocked = true`). The Revise PO button **completely disappears** to protect the impending financial credit transfer.

===============================================================================================
===============================================================================================

## 3. PO Revision Dialog Workflow

The `PORevisionDialog` (`PORevisionDialog.tsx`) is a multi-step modal form that handles the entire process of drafting and submitting a PO Revision. 

### Frontend Components Used
The dialog orchestrates several sub-components to handle the complex state of a revision:
* **`usePORevision.ts` (Custom Hook):** Acts as the "brain" of the dialog. It handles all state management (items, justification, payment terms, refund adjustments), calculations (before/after amounts, difference), and backend API communications.
* **`RevisionHeader` & `RevisionFooter`:** Manages the stepper UI indicating progress (Items -> Adjustment -> Summary) and the action buttons (Cancel, Next, Submit).
* **`Step1ReviseItems`:** The interface for adding, editing, or deleting items from the PO. It calculates the financial impact of these changes.
* **`Step2PositiveFlow`:** Shown only if the revised PO amount is *higher* than the original. It forces the user to allocate the extra cost into new or modified Payment Terms.
* **`Step2NegativeFlow`:** Shown only if the revised PO amount is *lower* than the original. It forces the user to define how the vendor will refund the difference (e.g., Transfer to "Another PO", "Adhoc" expense, or "Refunded" with proof attached).
* **`Step3Summary`:** A final confirmation screen showing the net impact and chosen allocation before submission.

### Backend APIs & Data Fetching
The dialog relies heavily on Frappe React SDK hooks (`useFrappeGetDocList`, `useFrappeGetDoc`, `useFrappePostCall`, `useFrappeFileUpload`) to fetch necessary context and submit the draft:

1. **Context Fetching (Dropdowns & Validation):**
   * `Procurement Requests`: Fetches the PR to determine the Work Package.
   * `Category`, `Items`, & `Category Makelist`: Fetches valid categories, items, taxes, and makes allowed for this specific Work Package to populate the "Add/Edit Item" dropdowns.
   * `Vendor Invoices`: Fetches all invoices linked to the PO to help the user reference them while revising.
   * `Procurement Orders` (Candidate POs): Fetches all other "Approved" POs for this specific vendor. This is used in Step 2 (Negative Flow) to allow the user to select a target PO to transfer credit to.
2. **File Uploads:**
   * Uses the `upload()` function to attach proof/receipt documents if the user selects the "Refunded" method in Step 2.
3. **Submission Endpoint:**
   * **Endpoint:** `nirmaan_stack.api.po_revisions.revision_logic.make_po_revisions`
   * **What it does:** It takes the drafted changes from the frontend and creates a new document in the `PO Revisions` doctype with a status of "Pending". It does **not** modify the original PO yet. The original PO remains locked while this draft is pending manager approval.
   * **Payload Structure:** 
     Sends `po_id`, `justification`, `total_amount_difference`, and two heavily structured JSON strings:
     
     **1. `revision_items` Payload:**
     An array documenting the delta of every item line.
     ```json
     [
       {
         "item_type": "Original | New | Revised | Replace | Deleted",
         "original_row_id": "string (if modifying/deleting existing)",
         
         // New/Revised Details
         "item_id": "string", "item_name": "string", "make": "string",
         "quantity": 10, "unit": "Nos", "quote": 150.0,
         "amount": 1500.0, "tax": 18,
         
         // Snapshot of Original Details (for diff comparison)
         "original_item_id": "string", "original_qty": 5,
         "original_received_qty": 2, // Used to enforce received locks// only for frontend , we don't need this in while creation Revison POs 
         "original_rate": 100.0, "original_tax": 18
       }
     ]
     ```

     **2. `payment_return_details` Payload:**
     Dictates the financial flow change.

     *Positive Flow (Difference > 0):*
     ```json
     {
       "list": {
         "type": "Payment Terms",
         "Details": [{
           "return_type": "Payment-terms",
           "status": "Pending",
           "amount": 5000.0,
           "terms": [
             { "label": "Milestone 1", "amount": 2500.0 },
             { "label": "Milestone 2", "amount": 2500.0 }
           ]
         }]
       }
     }
     ```

     *Negative Flow (Difference < 0):*
     ```json
     {
       "list": {
         "type": "Refund Adjustment",
         "Details": [{
           "status": "Pending",
           "amount": 2000.0,
           "return_type": "Against-po" | "Ad-hoc" | "Vendor-has-refund",
           
           // If Against-po:
           "target_pos": [{ "po_number": "PO-002", "amount": 2000.0 }],
           
           // If Ad-hoc:
           "ad-hoc_tyep": "expense", "ad-hoc_dexription": "reason",
           
           // If Vendor-has-refund
           "refund_date": "2026-02-27", "refund_attachment": "/files/receipt.pdf"
         }]
       }
     }
     ```

### Step-by-Step Logic
1. **Step 1 (Items & Justification):**
   * The user opens the dialog. Original PO items are loaded into state.
   * The user modifies quantities, rates, or adds/removes items.
   * **Received Quantity Constraints:** If an original PO item has already been partially or fully received (`received_quantity > 0`), strict locks are applied to prevent data corruption:
     * The **Item Name** cannot be changed.
     * The **Unit** cannot be changed.
     * The **Delete Icon** is disabled.
     * The **Quantity** cannot be reduced below the already `received_quantity` (e.g., if 7 items were received, the user can revise the quantity to 8 or 10, but not 6).
   * **Validation:** To proceed to Step 2, the user *must* provide a text `justification`.
2. **Step 2 (Financial Adjustment):**
   * **Validation (Positive Flow):** If the amount increased, the sum of all newly allocated Payment Terms *must* exactly equal the difference amount to proceed (`Math.abs(totalAllocated - Math.abs(difference.inclGst)) < 1`).
   * **Validation (Negative Flow):** If the amount decreased and "Another PO" is selected, the total refund allocated to target POs *must* exactly equal the refund amount.
3. **Step 3 (Summary & Submit):**
   * Displays the Before/After totals.
   * Clicking Submit triggers `handleSave()`.
   * `handleSave()` prepares the complex JSON payloads and calls the backend `make_po_revisions` API.
   * Displays a success toast with the newly created Revision ID (e.g., `REV-PO-0001`) and closes the dialog.

===============================================================================================
===============================================================================================

## 4. Backend Logic: Making a PO Revision

When the frontend submits the revision request, it hits the `make_po_revisions` Python function in `revision_logic.py`. This function serves as the safe "drafting" mechanism.

### API Endpoint details:
* **Method:** `POST`
* **Endpoint:** `nirmaan_stack.api.po_revisions.revision_logic.make_po_revisions`

### What it Receives (Parameters):
1. `po_id` (string): The Original Procurement Order ID.
2. `justification` (string): The reason for the revision.
3. `revision_items` (JSON string): The array of all items with their structural changes.
4. `total_amount_difference` (float): The net financial impact (+ or -).
5. `payment_return_details` (JSON string): The allocation of the difference.

### How it works behind the scenes (Step-by-Step):

1. **Original PO Safety Check:**
   It starts by fetching the original `Procurement Orders` document using the provided `po_id`. *Crucially, it only reads this document to extract the Project and Vendor names. It does not modify or save the original PO at this stage.*

2. **Draft Document Creation:**
   It initiates a completely new, blank document in the `PO Revisions` doctype (`frappe.new_doc("PO Revisions")`). 
   It links this new draft back to the original PO by setting `revised_po_id = po_id`.
   It copies over the `project` and `vendor` fields from the original PO to ensure the draft is categorized correctly in lists and reports.
   It sets the status of this draft firmly to **`"Pending"`**.

3. **Item Parsing & Transformation:**
   It iterates through the received `revision_items` JSON array. For every single item, it creates a new row in the `revision_items` child table of the draft document.
   * **If the item is "Original" or "Deleted":** It copies over only the `original_` fields (e.g., `original_qty`, `original_rate`) to establish a baseline. It leaves the revision fields blank.
   * **If the item is "New":** It skips the original fields and only populates the `revision_` fields.
   * **If the item is "Revised" or "Replace":** It populates *both* the `original_` fields and the `revision_` fields side-by-side. This allows the system to later calculate exactly what changed on a row-by-row basis.

4. **Financial Storage:**
   The `payment_return_details` JSON payload is taken exactly as-is and saved into a Text field on the draft document. No actual Project Payments or Payment Terms are created yet.

5. **Insertion (`ignore_permissions=True`):**
   Finally, it calls `.insert(ignore_permissions=True)` on the new draft object.
   * **What it does:** This forces Frappe to save the document directly to the database, bypassing standard user role-based access checks (like checking if the specific user has "Create" rights on the `PO Revisions` doctype).
   * **Why we need it here:** By design, any user who can *view* a Purchase Order (like a site engineer receiving invoices) should be able to *request* a revision. However, we intentionally strict-lock the `PO Revisions` doctype in Frappe's role settings so that only central Managers/Finance can finalize them. `ignore_permissions=True` allows a low-permission user to successfully submit the "Pending" draft request via the API without being blocked by Frappe's strict backend role checks.

   This commits the "Pending" revision to the database, generates a new Revision ID (e.g., `REV-PO-0005`), and returns that ID to the frontend to show the succcess toast.

**Summary:** This function acts purely as a staging ground. By creating a separate "Pending" document, it allows managers to review the proposed Item changes and Financial changes side-by-side against the original snapshot, all without corrupting or editing the live, approved Purchase Order until it is approved.

===============================================================================================
===============================================================================================

## 5. Backend Logic: Approving a PO Revision--

Once a Manager reviews the "Pending" `PO Revisions` document and decides to approve it, the system triggers the `on_approval_revision` Python function. This is the mechanism that commits the drafted changes to the live system.

### API Endpoint details:
* **Method:** `POST` (or triggered via Document Hook)
* **Endpoint:** `nirmaan_stack.api.po_revisions.revision_logic.on_approval_revision`

### What it Receives (Parameters):
1. `revision_name` (string): The ID of the `PO Revisions` document (e.g., `REV-PO-0005`) that is being approved.

### How it works behind the scenes (Step-by-Step):

1. **Transaction Initialization:**
   The very first thing it does is call `frappe.db.begin()`. This starts a SQL database transaction. If any step fails below, the entire database state can be rolled back to protect data integrity.

2. **Step 1: Syncing Items (`sync_original_po_items`)**
   It reads the `revision_items` table from the draft and applies the delta to the Original Purchase Order.
   * It deletes old rows, adds new rows, and updates changed rows.
   * *Crucially*, when saving the Original PO in this step, it temporarily sets `original_po.flags.ignore_validate_update_after_submit = True` and calls `.save(ignore_permissions=True)`. Because a standard Frappe PO is "Submitted" (locked), Frappe normally blocks all edits. These flags force Frappe to skip the standard "update after submit" validation hooks, allowing our controlled API to edit the locked document.

3. **Step 2: Handling Financial Flow**
   It checks `total_amount_difference`.
   * **If > 0 (Positive Flow):** It calls `process_positive_increase`. This function handles cost increases by strictly manipulating the Payment Terms table on the Original PO:
     1. **Recalculate Totals:** It re-fetches the Original PO and calls `.calculate_totals_from_items()` to get the new `Grand Total` including the synced items.
     2. **Update/Append Terms:** It parses the `payment_return_details` JSON from the draft.
        * If an submitted term ID matches an existing term on the PO, it updates that term's `amount` and `description`.
        * If it is a completely new term, it first scans existing PO payment terms for one with `"Created"` status (unpaid). If found, it intelligently *merges* the new amount into that existing term (and smartly combines their descriptions).
        * If no `"Created"` term exists, it instead appends a brand new row to the PO's `payment_terms` table, carefully inheriting the `payment_type` from existing terms and setting status to `"Created"`. If the inherited payment type is `"Credit"`, it additionally sets the `due_date` of this new term to `today + 2 days`.
     3. **Percentage Rebalancing:** Because the PO's total has increased, it loops through *all* payment terms (old and new) and forcefully recalculates their `percentage` field (`(amount / new_total) * 100`) so they precisely sum to 100%.
     4. **Save Draft Changes:** Finally, it updates the JSON payload in the draft to reflect the newly calculated percentages, and saves the Original PO (again, using `ignore_validate_update_after_submit = True`).
   * **If < 0 (Negative Flow):** It calls `process_negative_returns`. This either generates a new Ad-hoc Expense Payment, logs a Vendor Refund, or creates a contra Target PO Payment row.

4. **Step 3: Finalizing the Draft**
   It changes the `PO Revisions` document status to `"Approved"` and calls `.save(ignore_permissions=True)` to confirm the draft is executed.

5. **Commit Configuration:**
   If all steps succeed, it calls `frappe.db.commit()` to permanently save all database changes simultaneously.

### Rollback & Error Handling (`except Exception:`)
If any piece of code fails (e.g., a validation error while creating a Project Payment), the system immediately jumps to the `except` block:
1. **`frappe.db.rollback()`**: This violently undoes all database changes made since `frappe.db.begin()`. The Original PO's items revert to normal, and the draft goes back to "Pending".
2. **Stray Document Cleanup**: While `rollback()` reverts database rows attached to the current transaction, certain standalone Frappe documents (like freshly minted `Project Payments`) might persist in extreme edge cases or if they bypassed the transaction. The error handler implements a targeted cleanup sweep:
   * It parses the `payment_return_details` JSON to find target POs.
   * It queries the database for any `Project Payments` created strictly within the last `1 minute` linked to those POs.
   * It forcefully deletes them (`force=1`, `ignore_permissions=True`) to guarantee no phantom financial records are left behind from a failed approval attempt.

**Summary:** The Approval function is a highly controlled, high-stakes database transaction. It uses specific Frappe flags to bypass standard document locks, applies the drafted changes, and relies on aggressive rollback procedures to ensure the system is never left in a partially-updated, corrupt state.

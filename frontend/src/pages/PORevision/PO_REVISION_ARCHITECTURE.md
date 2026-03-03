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
  * Uses `usePOLockCheck(poId)` from the centralized data layer (`data/usePORevisionQueries.ts`), which wraps a POST call + SWR cache with Sentry error logging.
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
           "ad-hoc_type": "expense", "ad-hoc_description": "reason",
           
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

1. **Concurrency Lock (`for_update=True`):**
   The revision document is fetched with `for_update=True`, which acquires a row-level database lock. This prevents two managers from simultaneously approving/rejecting the same revision.

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


   * **If < 0 (Negative Flow):** It calls `process_negative_returns`. This function is strictly responsible for routing the "excess" money that the vendor now owes us back onto the books. It parses `payment_return_details` for `"Refund Adjustment"`. Depending on the `return_type` selected on the frontend, it executes one of three paths:
     1. **`Vendor-has-refund` (Direct Refund):** 
        * It creates a real `"Paid"` `Project Payments` document against the current PO for a *negative* amount (representing cash coming back).
        * It appends a tracking row to the Original PO's `payment_terms` table with the negative amount, and explicitly sets its status to **`"Return"`**. It labels this row `"Return - Vendor Refund"` to visibly track this on the PO level.
     2. **`Ad-hoc` (Expense Offset):** 
        * Similar to a refund, it creates a `"Paid"` `Project Payment` against the current PO for the negative amount.
        * It also instantiates a new `"Project Expenses"` document tracking this exact expense amount, attributing it to the original Vendor, current Project, and associating the user-selected `Expense Type` and description.
        * Finally, it appends a tracking term labeled `"Return - Adhoc [description]"` with a negative amount and status **`"Return"`**.
     3. **`Against-po` (Contra Credit Transfer):** 
        This is the most complex flow. It moves the negative credit from the revised PO to effectively "pay off" future milestones on a completely different open PO for the exact same vendor.
        
        * **What happens to the ORIGINAL PO (The one being revised):**
          * It generates a real `Project Payment` record for a *negative* amount against this Original PO to represent the credit note out.
          * It appends a tracking term to the Original PO's `payment_terms` table labeled `"Return - Against PO [Target PO ID]"`. Its amount is negative and its status is **`"Return"`**. This visibly closes the loop on the Original PO UI to show exactly where the credit went.
          
        * **What happens to the TARGET PO (The one receiving the credit):**
          * It generates a real, positive `"Paid"` `Project Payment` assigned directly to this Target PO to represent the credit "arriving".
          * **Target PO Payment Term Split (`_split_target_po_term`):** It physically opens the Target PO document and actively applies the credit to its future milestones:
             1. It loops through the Target PO's `payment_terms` from top to bottom.
             2. It targets terms where `term_status == "Created"` (unpaid future milestones).
             3. When it finds one, it **reduces** that term's `amount` by the credit limit.
             4. Immediately beneath it, it **inserts a new row** labeled `"[Original Label] (Credit from PO [Source Original PO])"`. It sets this new row's status strictly to **`"Paid"`** and permanently links it to the positive Project Payment. This effectively "reserves" and pays off that chunk of the milestone early, so a future Goods Receipt doesn't try to bill for it again.
             5. If there is still credit leftover, it cascades down the list to the next `"Created"` term and repeats the split.
             6. Finally, it forcefully recalculates the percentages on the Target PO so they gracefully sum back to 100%, and saves the Target PO to the database.
             
      **Final Negative Step — LIFO Reduction & Amount Paid Recalculation:**
      After routing the return money, the API does two things:
      1. Executes a Last-In, First-Out (LIFO) reduction (`_reduce_payment_terms_lifo`) on the Original PO's unpaid `"Created"` payment terms starting from the bottom, shrinking them until they perfectly account for the new, cheaper Grand Total.
      2. Calls `_recalculate_amount_paid()` on both the original PO and all affected target POs. This manually sums all `"Paid"` Project Payments for each PO and updates their `amount_paid` field. This is necessary because the normal `project_payments.py` hooks that do this automatically are intentionally skipped during the revision flow (see Section 10).

4. **Step 3: Finalizing the Draft**
   It changes the `PO Revisions` document status to `"Approved"` and calls `.save(ignore_permissions=True)` to confirm the draft is executed.

5. **Automatic Commit:**
   There is no explicit `frappe.db.commit()`. Frappe automatically commits the transaction at the end of a successful HTTP request.

### Rollback & Error Handling (`except Exception:`)
If any step fails (e.g., a validation error, character length overflow, or a Target PO being locked), the system immediately jumps to the `except` block:

1. **`frappe.db.rollback()`**: This performs a **full transaction rollback** that undoes *all* database changes made during the entire HTTP request. This includes:
   * All newly created `Project Payments` records
   * All `Project Expenses` records
   * Modified payment terms on both Original and Target POs
   * Item changes synced to the Original PO
   * The revision status change itself
   
2. **Error Logging**: `frappe.log_error()` captures the full traceback for debugging.

3. **User-Facing Error**: `frappe.throw()` sends a clear error message to the frontend.

> **Note:** The `from_revision` flag (see Section 10) is critical for this rollback to work. Without it, the `Project Payments` hooks would call `frappe.db.commit()` mid-transaction, permanently committing payments and making rollback impossible.

**Summary:** The Approval function is a highly controlled, high-stakes database transaction. It uses the `from_revision` flag to prevent mid-transaction commits, specific Frappe flags to bypass standard document locks, and relies on Frappe's full transaction rollback to ensure the system is never left in a partially-updated, corrupt state.

===============================================================================================
===============================================================================================

## 6. Backend API: PO Revision History

Provides a single consolidated API to fetch all PO Revision history data for a given PO, eliminating the need for multiple separate frontend API calls.

### API Endpoint Details
* **Method:** `POST`
* **Endpoint:** `nirmaan_stack.api.po_revisions.revision_history.get_po_revision_history`
* **File Location:** `nirmaan_stack/api/po_revisions/revision_history.py`

### What it Receives (Parameters):
1. `po_id` (string): The Procurement Order ID to fetch revision history for.

### What it Returns:
A list of revision objects, ordered newest-first, each containing:

| Field | Type | Description |
|---|---|---|
| `name` | string | Revision document ID (e.g., `REV-PO-0005`) |
| `creation` | datetime | When the revision was created |
| `status` | string | `"Pending"`, `"Approved"`, or `"Rejected"` |
| `total_amount_difference` | float | Net financial impact (+/-) |
| `revision_justification` | string | User-provided reason for revision |
| `payment_return_details` | object/null | **Pre-parsed** JSON (not a string) — the financial allocation details |
| `revision_items` | array | Full child table rows from `PO Revisions Items` |
| `original_total_incl_tax` | float | Computed total of original items including GST (rounded to 2 decimals) |
| `revised_total_incl_tax` | float | Computed total of revised items including GST (rounded to 2 decimals) |

### How it Works (Step-by-Step):

1. **Fetch All Revisions:**
   Queries `PO Revisions` doctype filtered by `revised_po = po_id`, ordered by `creation desc` to show most recent first.

2. **Parse Payment JSON:**
   For each revision, if `payment_return_details` exists and is a JSON string, it auto-parses it into a Python dict. This means the frontend receives a ready-to-use object instead of needing to call `JSON.parse()`.

3. **Fetch Child Items:**
   For each revision, queries all rows from the `PO Revisions Items` child table (filtered by `parent = revision.name`, ordered by `idx asc`). Returns the full item detail including `item_type`, original fields, and revision fields.

4. **Compute Totals Including Tax:**
   The API pre-computes two financial totals from the child items:
   * **`original_total_incl_tax`:** Sum of `original_amount × (1 + original_tax/100)` for all items except `"New"` items (which didn't exist originally).
   * **`revised_total_incl_tax`:** Sum of revised amounts with tax for all items except `"Deleted"` items. For `"Original"` (unchanged) items, it uses the original amount; for `"Revised"`/`"Replace"`/`"New"` items, it uses the revision amount with the revision tax rate.

### Why This API Exists:
* **Performance:** Replaces 2+ frontend API calls (`useFrappeGetDocList` for the list + `useFrappeGetDoc` per card expansion) with a single call that returns everything.
* **Pre-computation:** Tax-inclusive totals are computed server-side with proper floating-point handling, avoiding JavaScript precision issues.
* **Pre-parsing:** Payment JSON is parsed server-side, so the frontend doesn't need try/catch blocks for JSON parsing.

===============================================================================================
===============================================================================================

## 7. Frontend Component: PO Revision History

A premium, timeline-based UI component that displays the full revision history for a Purchase Order. It uses a two-level collapsible pattern: the entire section collapses, and each revision card within it also collapses independently.

### Frontend Component
* **Component Name:** `PORevisionHistory` (`frontend/src/pages/PORevision/components/PORevisionHistory.tsx`)
* **Usage:** Imported and rendered in `PODetails.tsx` (Purchase Orders detail page), placed after the `PORevisionDialog` component.
* **Props:** `poId: string` — the Procurement Order ID.

### Data Fetching
* Uses `useRevisionHistory(poId)` from the centralized data layer (`data/usePORevisionQueries.ts`).
* SWR cache key: `["po-revision", "history", poId]` via `poRevisionKeys.revisionHistory(poId)`.
* Includes automatic Sentry error logging via `useApiErrorLogger`.
* The component returns `null` (renders nothing) if loading, no data, or no revisions exist.

### UI Structure

#### Level 1: Section Collapsible (Outer)
* **Collapsed state (default):** A gradient header bar showing:
  * History icon (clock) in a red-tinted badge
  * "Revision History" title
  * Count badge (number of revisions)
  * Chevron indicator with rotation animation
* **Expanded state:** Reveals a timeline layout with a vertical gradient line on the left side.

#### Level 2: Revision Cards (Inner - one per revision)
Each revision renders as a card along the timeline:

* **Timeline Dot:** A colored circle on the left timeline, color-coded by status:
  * 🟢 Emerald = Approved
  * 🟡 Amber = Pending
  * 🔴 Rose = Rejected

* **Card Header (always visible):**
  * Chevron with smooth 90° rotation
  * Revision ID + Status badge (color-coded)
  * Creation date
  * Net difference amount with trend icon (↗ green for increase, ↘ red for decrease)

* **Card Body (expanded):**
  1. **Amount Summary (3-column grid):**
     * "Before" — Original total including tax (from API `original_total_incl_tax`)
     * "After" — Revised total including tax (from API `revised_total_incl_tax`)
     * "Impact" — Net difference with color coding (green/red bg)

  2. **Reason for Revision:**
     * Icon-prefixed section (MessageSquareText icon)
     * Displays `revision_justification` text

  3. **Items Changed:**
     * Icon-prefixed section (ArrowUpDown icon)
     * Shows count of changed items (excludes `"Original"` type)
     * Scrollable table with `max-h-[200px]` to prevent excessive height
     * Columns: Type badge, Item name, Qty Change (shown as `10 → 8` with arrow), Amount diff
     * Type badges are color-coded: Green (New), Red (Deleted), Blue (Revised/Replace)
     * Deleted items show strikethrough qty, New items show plain qty

  4. **Payment Rectification:**
     * Icon-prefixed section (Wallet icon)
     * Reuses the existing `PORevisionPaymentRectification` component
     * Payment data is already parsed by the backend API (no JSON.parse needed)

### Design Highlights
* **Timeline pattern:** Vertical line with status-colored dots creates a visual chronology
* **Tabular numbers:** All financial figures use `tabular-nums` for perfect digit alignment
* **Gradient backgrounds:** Subtle `from-white to-slate-50/50` gradient on expanded cards
* **Shadow transitions:** Cards lift on hover with smooth shadow animation
* **Line clamp:** Long item names are truncated with CSS `line-clamp-1`
* **Sticky table header:** Item changes table header stays visible during scroll

===============================================================================================
===============================================================================================

## 8. Centralized Data Layer & Sentry Integration

The PO Revision module uses a centralized data layer pattern (modeled after the Vendor module) to standardize API calls, SWR cache management, and Sentry error observability.

### Folder Structure

```
PORevision/
├── data/                              ← Centralized data layer
│   ├── poRevision.constants.ts        ← Cache keys, doctype constants, API endpoints
│   ├── usePORevisionQueries.ts        ← All read hooks with Sentry logging
│   └── usePORevisionMutations.ts      ← All write hooks with cache invalidation
├── hooks/                             ← Business logic hooks (use data/ imports)
│   ├── usePORevision.ts
│   └── usePORevisionsApprovalDetail.ts
└── ...
```

### Cache Key Factory — `poRevisionKeys`
**File:** `data/poRevision.constants.ts`

All SWR cache keys are generated from a single `poRevisionKeys` factory object, ensuring predictable invalidation:

| Key | Factory | Used By |
|-----|---------|--------|
| Revision Doc | `revisionDoc(id)` | Approval Detail |
| Revision History | `revisionHistory(poId)` | PORevisionHistory component |
| Procurement Request | `procurementRequest(prId)` | Revision Dialog |
| Categories | `categories(wp)` | Revision Dialog |
| Items | `items(wp)` | Revision Dialog |
| Category Makelist | `categoryMakelist(wp)` | Revision Dialog |
| Vendor Invoices | `vendorInvoices(poId)` | Revision Dialog |
| Candidate POs | `candidatePOs(vendor)` | Negative Flow (Step 2) |
| Original PO | `originalPO(poId)` | Approval Detail |
| Lock Check | `lockCheck(poId)` | PORevisionWarning |

### API Endpoint Constants — `PO_REVISION_APIS`

All backend API endpoint strings are centralized:

```typescript
export const PO_REVISION_APIS = {
  makeRevision:    "nirmaan_stack.api.po_revisions.revision_logic.make_po_revisions",
  approveRevision: "nirmaan_stack.api.po_revisions.revision_logic.on_approval_revision",
  checkLock:       "nirmaan_stack.api.po_revisions.revision_po_check.check_po_in_pending_revisions",
  getHistory:      "nirmaan_stack.api.po_revisions.revision_history.get_po_revision_history",
};
```

### Centralized Queries — `usePORevisionQueries.ts`

10 query hooks, each wrapping a Frappe SDK call with:
- **Standardized SWR cache key** from `poRevisionKeys`
- **Automatic Sentry error logging** via `useApiErrorLogger` with `feature: "po-revision"`

| Hook | Doctype/API | Consumer |
|------|-------------|----------|
| `useRevisionDoc(id)` | PO Revisions GetDoc | Approval Detail |
| `useOriginalPO(poId)` | Procurement Orders GetDoc | Approval Detail |
| `useProcurementRequestForRevision(prId)` | Procurement Requests GetDoc | Dialog |
| `useRevisionCategories(wp)` | Category DocList | Dialog |
| `useRevisionItems(wp, cats)` | Items DocList | Dialog |
| `useRevisionCategoryMakelist(wp, cats)` | Category Makelist DocList | Dialog |
| `useRevisionVendorInvoices(poId, enabled)` | Vendor Invoices DocList | Dialog |
| `useApprovalInvoices(poId)` | Vendor Invoices DocList | Approval Detail |
| `useCandidatePOs(vendor, enabled)` | Procurement Orders DocList | Dialog (Negative Flow) |
| `usePOLockCheck(poId)` | Custom API (PostCall + SWR) | PORevisionWarning, Approval Detail (`PODetails.tsx`) |
| `useRevisionHistory(poId)` | Custom API (PostCall + SWR) | PORevisionHistory |

### Centralized Mutations — `usePORevisionMutations.ts`

3 mutation hooks with automatic SWR cache invalidation after success:

| Hook | API | Invalidates |
|------|-----|------------|
| `useCreateRevision()` | `make_po_revisions` | `lockCheck(poId)` |
| `useApproveRevision()` | `on_approval_revision` | `revisionDoc`, `originalPO`, `revisionHistory`, `lockCheck` |
| `useRejectRevision()` | `updateDoc` (status → Rejected) | `revisionDoc`, `lockCheck` |

### Sentry Error Logging Pattern

Every query hook follows this pattern:

```typescript
export const useRevisionDoc = (revisionId?: string) => {
  const response = useFrappeGetDoc(...);
  useApiErrorLogger(response.error, {
    hook: "useRevisionDoc",        // Which hook failed
    api: "PO Revisions GetDoc",    // What API endpoint
    feature: "po-revision",        // Feature area for grouping in Sentry
    doctype: PO_REVISION_DOCTYPE,  // Frappe doctype
    entity_id: revisionId,         // Specific entity for context
  });
  return response;
};
```

When an API error occurs, `useApiErrorLogger` calls `captureApiError()` which sends to Sentry with:
- **Custom fingerprinting:** `[feature, hook, api, httpStatus]` — groups errors uniquely per API call
- **Searchable tags:** `layer:api`, `feature:po-revision`, `hook:useRevisionDoc`
- **Full context:** HTTP status, backend messages, original error object

===============================================================================================
===============================================================================================

## 9. External Functions Used by PO Revision Approval

The PO Revision approval flow (`revision_logic.py`) relies on two key functions from other modules. These are **not** defined within the PO Revision module — they are imported from the Procurement Orders doctype and the Delivery Notes API respectively.

### `calculate_totals_from_items()` — From Procurement Orders Doctype

* **Defined in:** `nirmaan_stack/doctype/procurement_orders/procurement_orders.py` (Line 21)
* **Type:** Instance method on the `ProcurementOrders` Document class
* **Called as:** `original_po.calculate_totals_from_items()`

**What it does:**
Iterates over all child items in the PO and recalculates three parent-level fields:

| Field Set | Source |
|-----------|--------|
| `self.amount` | Sum of all `item_row.amount` (excl. tax) |
| `self.tax_amount` | Sum of all `item_row.tax_amount` |
| `self.total_amount` | Sum of all `item_row.total_amount` (incl. tax — the grand total) |

**Where used in PO Revision:**
1. **`sync_original_po_items()`** — After adding/modifying/deleting items, recalculates the PO's grand total before save.
2. **`process_positive_increase()`** — After syncing, recalculates to get `new_total` for rebalancing payment term percentages.
3. **`process_negative_returns()`** — After syncing, recalculates `new_total` for LIFO term reduction.

**Why it's important for revisions:**
When a revision changes item quantities, rates, or adds/deletes items, the PO's `amount`, `tax_amount`, and `total_amount` would be stale. This function ensures they reflect the new item reality before financial operations (payment term adjustments) rely on them.

---

### `calculate_order_status()` — From Delivery Notes API

* **Defined in:** `nirmaan_stack/api/delivery_notes/update_delivery_note.py` (Line 159)
* **Type:** Standalone function (imported at top of `revision_logic.py`)
* **Called as:** `calculate_order_status(updated_items)`

**What it does:**
Determines whether a PO should be `"Delivered"` or `"Partially Delivered"` by checking each item:

| Quantity Type | Condition for "Delivered" |
|---------------|--------------------------|
| **Integer** | `quantity <= received_quantity` |
| **Float** | `(quantity - 2.5% tolerance) <= received_quantity` |

If **all** items pass → `"Delivered"`. Otherwise → `"Partially Delivered"`.

**Where used in PO Revision:**
* **`sync_original_po_items()`** — After item sync, if the PO was `"Partially Delivered"` or `"Delivered"`, re-evaluates the delivery status based on the new (revised) item quantities vs existing `received_quantity`.

**Why it's important for revisions:**
A revision can **reduce** an item's ordered quantity (e.g., from 10 → 5). If 5 units were already received, the item now satisfies `quantity <= received_quantity`. If all items in the PO pass this check after revision, the status should automatically update from `"Partially Delivered"` → `"Delivered"` — without requiring a separate delivery note update.

**Example scenario:**
```
Before revision:
  Item A: qty=10, received=10 ✓
  Item B: qty=10, received=5  ✗  →  Status: "Partially Delivered"

Revision reduces Item B: qty=10 → qty=5

After revision approval + status recalculation:
  Item A: qty=10, received=10 ✓
  Item B: qty=5,  received=5  ✓  →  Status: "Delivered" ✅
```

===============================================================================================
===============================================================================================

## 10. Transaction Safety: The `from_revision` Flag Architecture

The PO Revision approval flow creates multiple `Project Payments` during the negative flow. If any subsequent step fails (e.g., payment term split crashes), ALL previously-created payments must be rolled back. This section documents the architecture that ensures this atomicity.

### The Problem

When a `Project Payment` is created via `pay.save()`, Frappe triggers a chain of hooks across **three separate files**:

| Order | File | Hook | What it does | Danger |
|-------|------|------|-------------|--------|
| 1 | `doctype/project_payments/project_payments.py` | `before_insert` | Validates that total payments don't exceed PO amount | Blocks negative payments |
| 2 | `doctype/project_payments/project_payments.py` | `on_update` | Calls `update_parent_amount_paid()` → `frappe.db.commit()` | **Permanently commits the payment** |
| 3 | `integrations/controllers/project_payments.py` | `after_insert` | Creates `Nirmaan Notifications` + sends Firebase push → `frappe.db.commit()` inside loop | **Permanently commits the payment** |
| 4 | `integrations/controllers/project_payments.py` | `on_update` | Syncs payment term status + sends notifications → `frappe.db.commit()` | **Permanently commits the payment** |

The `frappe.db.commit()` calls in hooks #2, #3, and #4 are **destructive** during the revision flow. They permanently write the payment to the database mid-transaction. If a later step fails and `frappe.db.rollback()` is called, it can only undo changes made *after* the last commit — the payment survives as an orphan.

### The Solution: `from_revision` Flag

When `_create_project_payment()` in `revision_logic.py` creates a payment, it sets:

```python
pay.flags.from_revision = True
```

All four hook entry points check for this flag and **return early** if present:

```python
# In both doctype/project_payments.py and integrations/controllers/project_payments.py:
def before_insert(self) / after_insert(doc, method) / on_update(...):
    if self.flags.from_revision:  # or doc.flags.from_revision
        return  # Skip validation, notifications, and the destructive commit()
```

### Manual Recalculation: `_recalculate_amount_paid()`

Since `on_update` is skipped (which normally recalculates `amount_paid` on the parent PO), the revision flow manually handles this at the end via `_recalculate_amount_paid(po_id)`:

```python
def _recalculate_amount_paid(po_id):
    paid_payments = frappe.get_all("Project Payments", ...)
    total_paid = sum(flt(p.amount) for p in paid_payments)
    frappe.db.set_value("Procurement Orders", po_id, "amount_paid", total_paid)
```

This is called:
1. For all **target POs** — before `original_po.save()`
2. For the **original PO** — after `original_po.save()` (to avoid `TimestampMismatchError`, since `set_value` updates the `modified` timestamp)

### Full Rollback Guarantee

With all hooks skipped, **zero `frappe.db.commit()` calls execute** during the revision flow. The entire approval runs in a single database transaction. If anything fails:

```python
except Exception as e:
    frappe.db.rollback()  # Undoes EVERYTHING — payments, expenses, PO edits, all of it
    frappe.throw(_("Approval failed: {0}").format(str(e)))
```

### Files Modified for This Architecture

| File | Changes |
|------|---------|
| `revision_logic.py` → `_create_project_payment()` | Sets `pay.flags.from_revision = True` |
| `revision_logic.py` → `on_approval_revision()` | Uses `frappe.db.rollback()` (full) instead of savepoints |
| `revision_logic.py` → `_recalculate_amount_paid()` | New helper function for manual `amount_paid` calculation |
| `doctype/project_payments/project_payments.py` | `from_revision` check in `before_insert` and `on_update` |
| `integrations/controllers/project_payments.py` | `from_revision` check in `after_insert` and `on_update` |

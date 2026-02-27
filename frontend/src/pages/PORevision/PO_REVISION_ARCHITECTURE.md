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
   * **Payload:** Sends the `po_id`, text `justification`, JSON string of `revision_items` (containing both original and new state), `total_amount_difference`, and JSON string of `payment_return_details` (Step 2 allocations).

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

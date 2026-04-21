# TDS Item Selection & Approval Architecture

This document explains the technical flow between the **Master Repository Management** and the **Project-Level Request Flow**.

## 1. The Two Creation Flows

There are two primary ways items are managed in the system:

### A. Master Repository Flow (`AddTDSItemDialog.tsx`)
- **Location**: TDS Repository Master page.
- **Action**: Directly creates/updates records in the `TDS Repository` DocType.
- **Purpose**: Global administration and pre-populating the master list.

### B. Project Request Flow (`RequestTdsItemDialog.tsx`)
- **Location**: Project-level TDS Request form.
- **Action**: Adds items to a frontend cart, which are then saved to the `Project TDS Item List` DocType upon submission.
- **Purpose**: Allowing project users to select from the repo OR request new items.

---

## 2. The "New Item" Logic

In the Project Request Flow, we distinguish between existing items and new requests using the `is_new_request` flag.

| Selection Scenario | `is_new_request` | Resulting `tds_status` |
| :--- | :--- | :--- |
| **Standard Item** (Existing Repo Item selected) | `false` | `Pending` |
| **Custom Item** (New Name entered via dialog) | `true` | `New` |
| **New Make** (Standard Item selected + "+ Others" Make) | `true` | `New` |

---

## 3. The Approval & Promotion Flow

When an administrator reviews the project requests in `TDSApprovalDetail.tsx`, the system handles them differently based on their status:

### Standard Items (`tds_status: "Pending"`)
1.  Admin clicks **Approve**.
2.  The system updates the project record to `Approved`.
3.  The link to the existing `TDS Repository` item remains as-is.

### New Requests (`tds_status: "New"`)
This is the automated "Promotion" logic:
1.  Admin clicks **Approve**.
2.  **Step 1**: The system creates a NEW record in the global `TDS Repository` using the details provided by the user (Name, Make, Category, Description, etc.).
3.  **Step 2**: The system updates the project record status to `Approved`.
4.  **Step 3**: The system automatically links the project record to the newly created master item by setting `tds_item_id = [New Repo Name]`.

---

## 4. Why this is implementation is Correct

1.  **Data Integrity**: Users cannot mess up the master repository directly. Every new item must be vetted by an admin during the approval process.
2.  **Consistency**: Once a "New" item is approved, it immediately becomes a "Standard" item for everyone else to use in the future.
3.  **Unified UI**: By mirroring the selection logic between both dialogs, users have a familiar experience while the backend maintains strict separation of concerns.

> [!TIP]
> This structure prevents duplicate entries in the master repository because administrators can see the \"New Item\" badge and verify if a similar item already exists before approving and thus promoting it.

/**
 * What a Finalized Work Order locks (#1539, GLOSSARY "Finalized (Work Order)"). The server refuses a locked
 * save or delete with this same text: `services/work_order_lifecycle.FINALIZED_REFUSAL`. A pure Python test
 * (`services/test_work_order_lifecycle`) checks this file still carries it word for word.
 */
export const FINALIZED_LOCK_MESSAGE =
  "This Work Order is Finalized: it can't be amended or deleted, and its items, total, vendor, GST and terms are locked. Payments, invoices and remarks stay open. Revert Finalization unlocks it.";

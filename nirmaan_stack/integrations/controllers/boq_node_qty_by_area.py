# Capture-only (Phase 5 Slice 2.5): child rows persist their given qty / rate / amount
# VERBATIM. The former write-chain compute -- _apply_rate_fallback (a blank child rate
# inheriting the parent's) and _compute_child_amounts (child amount = rate x qty) -- was
# REMOVED; those calculations move to the future tendering phase.
#
# The last remaining validation (old #21 -- a soft per-row combined_rate consistency
# msgprint, dispatched from boq_nodes.validate) has been DELETED outright: it carried no
# value at commit time (capture-only; rate reconciliation is tendering's job) and the user
# never saw the msgprint during an async commit. boq_nodes no longer imports or dispatches
# into this module, so this child doctype has no controller-side validation. (No doc_events
# hook is wired for "BOQ Node Qty By Area"; child rows validate through their parent.)

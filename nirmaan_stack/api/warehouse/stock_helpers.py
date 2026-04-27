"""
Thin re-export of the warehouse-stock availability helper.

The canonical implementation lives on the ITR controller
(`internal_transfer_request.warehouse_available_quantity`) and is keyed by
(item_id, make). This wrapper exists so callers can import it from the
warehouse-API namespace without reaching into the controller module.
"""

from nirmaan_stack.integrations.controllers.internal_transfer_request import (
    warehouse_available_quantity,
)


__all__ = ["warehouse_available_quantity"]

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  ROUTE_PATHS,
  STATUS_BADGE_VARIANT,
  encodeFrappeId,
} from "../../constants";
import { formatDate } from "@/utils/FormatDate";
import { PivotTableMetadataBarProps } from "./types";

export function PivotTableMetadataBar({
  po,
  dnCount,
  showNavLinks = false,
}: PivotTableMetadataBarProps) {
  const navigate = useNavigate();

  const badgeVariant =
    STATUS_BADGE_VARIANT[po.status] || STATUS_BADGE_VARIANT["default"];

  const deliveryContact = useMemo(() => {
    if (!po.delivery_contact?.includes(":"))
      return { name: null, mobile: null };
    const parts = po.delivery_contact.split(":");
    return {
      name: parts[0]?.trim() || null,
      mobile: parts[1]?.trim() || null,
    };
  }, [po.delivery_contact]);

  return (
    <div className="border rounded-lg p-3 bg-card space-y-2">
      {/* Primary row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {showNavLinks ? (
          <>
            <span
              className="font-medium text-primary cursor-pointer hover:underline"
              onClick={() => {
                if (po.procurement_request && po.name) {
                  navigate(
                    ROUTE_PATHS.PROCUREMENT_ORDER_DETAILS(
                      po.procurement_request,
                      encodeFrappeId(po.name)
                    )
                  );
                }
              }}
            >
              {po.name}
            </span>
            <span className="text-muted-foreground">&rarr;</span>
            <span
              className="text-primary cursor-pointer hover:underline"
              onClick={() => {
                if (po.procurement_request) {
                  navigate(
                    ROUTE_PATHS.PROCUREMENT_REQUEST_DETAILS(
                      po.procurement_request
                    )
                  );
                }
              }}
            >
              {po.procurement_request}
            </span>
          </>
        ) : (
          <span className="font-medium">{po.name}</span>
        )}

        <span className="text-muted-foreground">{po.vendor_name}</span>
        <span className="text-muted-foreground">{po.project_name}</span>
        <Badge variant={badgeVariant}>{po.status}</Badge>
      </div>

      {/* Secondary row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {po.dispatch_date && (
          <span>Dispatched: {formatDate(po.dispatch_date)}</span>
        )}
        {po.latest_delivery_date && (
          <span>Latest DN: {formatDate(po.latest_delivery_date)}</span>
        )}
        <span>
          {dnCount} delivery note{dnCount !== 1 ? "s" : ""}
        </span>
        {deliveryContact.name && (
          <span>
            Contact: {deliveryContact.name}
            {deliveryContact.mobile && ` (${deliveryContact.mobile})`}
          </span>
        )}
      </div>
    </div>
  );
}

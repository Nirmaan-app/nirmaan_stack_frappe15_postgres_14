import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Package,
  Store,
  FolderOpen,
  CalendarClock,
  CalendarCheck,
  ClipboardList,
  User,
  Phone,
} from "lucide-react";
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <div className="flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
        </div>

        <Separator orientation="vertical" className="h-4 hidden sm:block" />

        <div className="flex items-center gap-1.5">
          <Store className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">{po.vendor_name}</span>
        </div>

        <Separator orientation="vertical" className="h-4 hidden sm:block" />

        <div className="flex items-center gap-1.5">
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">{po.project_name}</span>
        </div>

        <Badge variant={badgeVariant}>{po.status}</Badge>
      </div>

      {/* Secondary row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {po.dispatch_date && (
          <div className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Dispatched:</span>
            <span>{formatDate(po.dispatch_date)}</span>
          </div>
        )}

        {po.latest_delivery_date && (
          <>
            <Separator orientation="vertical" className="h-3.5 hidden sm:block" />
            <div className="flex items-center gap-1">
              <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Latest DN:</span>
              <span>{formatDate(po.latest_delivery_date)}</span>
            </div>
          </>
        )}

        <Separator orientation="vertical" className="h-3.5 hidden sm:block" />

        <div className="flex items-center gap-1">
          <ClipboardList className="h-3.5 w-3.5 shrink-0" />
          <span>
            {dnCount}
            <span className="hidden sm:inline">
              {" "}delivery note{dnCount !== 1 ? "s" : ""}
            </span>
          </span>
        </div>

        {deliveryContact.name && (
          <>
            <Separator orientation="vertical" className="h-3.5 hidden sm:block" />
            <div className="flex items-center gap-1">
              <User className="h-3.5 w-3.5 shrink-0" />
              <span>{deliveryContact.name}</span>
              {deliveryContact.mobile && (
                <span className="hidden sm:inline-flex items-center gap-0.5">
                  <Phone className="h-3 w-3 shrink-0" />
                  {deliveryContact.mobile}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

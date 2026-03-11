import { TailSpin } from "react-loader-spinner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import { useDeliveryNoteData } from "./hooks/useDeliveryNoteData";
import { DeliveryPivotTable, PivotTableMetadataBar, DELIVERY_EDIT_ROLES } from "./components/pivot-table";
import { usePOLockCheck } from "@/pages/PORevision/data/usePORevisionQueries";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MessageCircleWarning } from "lucide-react";
import { DOCUMENT_PREFIX, formatDisplayId } from "./constants";

export default function DeliveryNote() {
  const {
    deliveryNoteId,
    poId,
    data,
    dnRecords,
    isLoading,
    error,
    mutate,
    refetchDNs,
  } = useDeliveryNoteData();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewMode = searchParams.get("mode") === "create"
    ? "create" as const
    : searchParams.get("mode") === "view"
      ? "view-only" as const
      : "full" as const;

  const userData = useUserData();
  const isProjectManager = userData?.role === "Nirmaan Project Manager Profile";
  const { isCEOHold } = useCEOHoldGuard(data?.project ?? undefined);

  const { data: lockData } = usePOLockCheck(poId ?? undefined);
  const isLocked = lockData?.is_locked || false;

  const displayPoId = formatDisplayId(poId ?? undefined, DOCUMENT_PREFIX.PURCHASE_ORDER);

  const canEdit =
    !!data &&
    !!userData?.role &&
    (DELIVERY_EDIT_ROLES as readonly string[]).includes(userData.role) &&
    ["Dispatched", "Partially Delivered", "Delivered"].includes(data.status);

  const pageTitle = viewMode === "create"
    ? `New Delivery Note - ${displayPoId}`
    : viewMode === "view-only"
      ? `Delivery History - ${displayPoId}`
      : displayPoId;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <TailSpin height={50} width={50} color="red" />
        <span className="ml-2 text-gray-600">Loading Delivery Note...</span>
      </div>
    );
  }

  if (error || !deliveryNoteId || !poId) {
    return (
      <div className="flex items-center justify-center h-[80vh] text-red-600">
        Error: {error?.message || "Failed to load Delivery Note data."}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[80vh] text-orange-600">
        Delivery Note not found for ID: {deliveryNoteId}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-4 max-w-6xl space-y-4">
      <h1 className="text-xl font-bold text-foreground">{pageTitle}</h1>

      {isLocked && (
        <Alert variant="destructive" className="bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200">
          <MessageCircleWarning className="h-4 w-4 !text-red-600 dark:!text-red-400" />
          <AlertTitle className="text-red-800 dark:text-red-200">PO is Locked</AlertTitle>
          <AlertDescription>
            This Purchase Order is currently locked (e.g., due to a pending revision).
            You cannot add new delivery updates or return items at this time.
          </AlertDescription>
        </Alert>
      )}

      {isCEOHold && <CEOHoldBanner className="mb-2" />}

      <PivotTableMetadataBar
        po={data}
        dnCount={dnRecords.length}
        returnCount={dnRecords.filter(dn => dn.is_return === 1).length}
        showNavLinks
      />

      {viewMode === "create" && dnRecords.length === 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          No delivery updates recorded yet. Enter quantities below to create the first delivery note.
        </div>
      )}

      <DeliveryPivotTable
        po={data}
        dnRecords={dnRecords}
        onPoMutate={mutate}
        onDnRefetch={refetchDNs}
        canEdit={canEdit}
        isProjectManager={isProjectManager}
        viewMode={viewMode}
        isLocked={isLocked}
        onAfterCreate={viewMode === "create" ? () => navigate("/prs&milestones/delivery-notes?view=create") : undefined}
      />
    </div>
  );
}

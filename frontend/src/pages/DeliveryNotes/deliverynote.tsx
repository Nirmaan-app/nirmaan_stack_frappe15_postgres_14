import { TailSpin } from "react-loader-spinner";
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import { useDeliveryNoteData } from "./hooks/useDeliveryNoteData";
import { DeliveryPivotTable, PivotTableMetadataBar, DELIVERY_EDIT_ROLES } from "./components/pivot-table";
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

  const userData = useUserData();
  const isProjectManager = userData?.role === "Nirmaan Project Manager Profile";
  const { isCEOHold } = useCEOHoldGuard(data?.project ?? undefined);

  const displayDnId = formatDisplayId(deliveryNoteId ?? undefined, DOCUMENT_PREFIX.DELIVERY_NOTE);

  const canEdit =
    !!data &&
    !!userData?.role &&
    (DELIVERY_EDIT_ROLES as readonly string[]).includes(userData.role) &&
    !isCEOHold &&
    ["Dispatched", "Partially Delivered"].includes(data.status);

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
      <h1 className="text-xl font-bold text-foreground">{`${displayDnId}/M`}</h1>

      {isCEOHold && <CEOHoldBanner className="mb-2" />}

      <PivotTableMetadataBar
        po={data}
        dnCount={dnRecords.length}
        showNavLinks
      />

      <DeliveryPivotTable
        po={data}
        dnRecords={dnRecords}
        onPoMutate={mutate}
        onDnRefetch={refetchDNs}
        canEdit={canEdit}
        isProjectManager={isProjectManager}
      />
    </div>
  );
}

/**
 * DCSteps / MIRSteps — Delivery Challan and Material Inspection Report selection tables.
 *
 * The two differ only in their columns and wording, so they are one component with two exports.
 */
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { BulkSelectTable } from "./BulkSelectTable";
import { dcColumns, mirColumns } from "./bulkTableColumns";
import { PODeliveryDocuments } from "../useBulkDownloadWizard";

interface DeliveryDocStepsProps {
    items: PODeliveryDocuments[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectAll: (ids: string[]) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
}

interface DeliveryDocKind {
    title: string;
    short: string;
    columns: ColumnDef<PODeliveryDocuments, any>[];
}

const DeliveryDocStep = ({
    kind: { title, short, columns },
    items, isLoading, selectedIds, onSelectAll, onBack, onDownload, loading,
}: DeliveryDocStepsProps & { kind: DeliveryDocKind }) => (
    <div className="flex flex-col gap-4">
        <div>
            <h2 className="text-xl font-bold">Select {title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
                Choose {short}s to include in your download
            </p>
        </div>

        <BulkSelectTable
            data={items}
            columns={columns}
            isLoading={isLoading}
            selectedIds={selectedIds}
            onSelectedIdsChange={onSelectAll}
            facetColumns={{ vendor: "Vendor" }}
            dateFilterColumns={["dc_date", "creation"]}
            searchPlaceholder={`Search by ${short} No., PO or Vendor`}
            emptyMessage={`No ${title} with attachments found for this project.`}
        />

        <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" onClick={onBack} disabled={loading}>
                <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
            <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                {loading ? "Generating..." : selectedIds.length === 0 ? `Select ${short}s to download` : `Download ${selectedIds.length} ${short}${selectedIds.length !== 1 ? "s" : ""}`}
            </Button>
        </div>
    </div>
);

const DC_KIND: DeliveryDocKind = { title: "Delivery Challans", short: "DC", columns: dcColumns };
const MIR_KIND: DeliveryDocKind = { title: "Material Inspection Reports", short: "MIR", columns: mirColumns };

export const DCSteps = (props: DeliveryDocStepsProps) => <DeliveryDocStep kind={DC_KIND} {...props} />;
export const MIRSteps = (props: DeliveryDocStepsProps) => <DeliveryDocStep kind={MIR_KIND} {...props} />;

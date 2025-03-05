import { useSearchParams } from "react-router-dom";
import { ProcurementOrder } from "./procurement-vendor";
import { ProcurementProgress } from "./ProcurementProgress";
import { VendorsSelectionSummary } from "./VendorsSelectionSummary";

export const RenderProcurementRequest = () => {

    const [searchParams] = useSearchParams();

   const tab = searchParams.get("tab") || "New PR Request"

   const mode = searchParams.get("mode") || "edit"

    if(tab === "New PR Request") {
        return <ProcurementOrder />
    } 
    // else if(tab === "Update Quote") {
    //     return <UpdateQuote />
    // } else if(tab === "Choose Vendor") {
    //     return <SelectVendors />
    // }
    else if(tab === "In Progress"  && mode === "review") {
        return <VendorsSelectionSummary />
    } else {
        return <ProcurementProgress />
    }
}
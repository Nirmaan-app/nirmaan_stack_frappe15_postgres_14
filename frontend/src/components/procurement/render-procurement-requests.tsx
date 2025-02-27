import { useSearchParams } from "react-router-dom";
import { ProcurementOrder } from "./procurement-vendor";
import { ProcurementProgress } from "./ProcurementProgress";

export const RenderProcurementRequest = () => {

    const [searchParams] = useSearchParams();

   const tab = searchParams.get("tab") || "New PR Request"

    if(tab === "New PR Request") {
        return <ProcurementOrder />
    } 
    // else if(tab === "Update Quote") {
    //     return <UpdateQuote />
    // } else if(tab === "Choose Vendor") {
    //     return <SelectVendors />
    // }
    else if(tab === "In Progress") {
        return <ProcurementProgress />
    }
}
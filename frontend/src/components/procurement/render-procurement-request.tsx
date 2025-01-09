import { useSearchParams } from "react-router-dom"
import { ProcurementOrder } from "./procurement-vendor";
import { UpdateQuote } from "./update-quote";
import { SelectVendors } from "./select-vendors";

export const RenderProcurementRequest = () => {

    const [searchParams] = useSearchParams();

   const tab = searchParams.get("tab")

    if(tab === "New PR Request") {
        return <ProcurementOrder />
    } else if(tab === "Update Quote") {
        return <UpdateQuote />
    } else if(tab === "Choose Vendor") {
        return <SelectVendors />
    }
}
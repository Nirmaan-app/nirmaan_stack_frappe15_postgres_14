import { useFrappeGetDoc } from "frappe-react-sdk"

export const usePincode = (pincode: any) => {
    if(pincode==="") return {city: "Enter Pincode", state: "Enter Pincode"}

    const {data, isLoading, error} = useFrappeGetDoc("Pincodes", pincode);
    if(isLoading) return {city: "Loading", state: ":Loading"};
    if(error || !data) return {city: "Error", state: "Error"}
    return {
         city: data?.city,
         state: data?.state
    }
}
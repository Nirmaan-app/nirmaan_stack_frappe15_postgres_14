import { useFrappeGetDoc } from "frappe-react-sdk"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card"
import { AddressView } from "../address-view"
import { useNavigate } from "react-router-dom"

export const VendorHoverCard = ({ vendor_id }) => {
    const { data: vendorData } = useFrappeGetDoc("Vendors", vendor_id, vendor_id ? `Vendors ${vendor_id}` : null)

    const navigate = useNavigate()
    return (
        <HoverCard>
            <HoverCardTrigger>
                <span className="underline">{vendorData?.vendor_name}</span>
            </HoverCardTrigger>
            <HoverCardContent className="p-4 shadow-lg rounded-lg bg-white w-72 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Vendor Details</h3>
            <div className="flex flex-col space-y-2">
              <div>
                <span className="text-sm text-gray-500">Vendor ID:</span>
                <p onClick={() => navigate(`/vendors/${vendorData?.name}`)} className="text-base font-medium text-blue-500 underline cursor-pointer">{vendorData?.name}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Vendor Type:</span>
                <p className="text-base font-medium text-black">{vendorData?.vendor_type}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Email:</span>
                <p className="text-base font-medium text-black">{vendorData?.vendor_email || "N/A"}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Mobile Number:</span>
                <p className="text-base font-medium text-black">{vendorData?.vendor_mobile || "N/A"}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">GST:</span>
                <p className="text-base font-medium text-black">{vendorData?.vendor_gst || "N/A"}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Vendor Address: </span>
                {/* <p className="text-base font-medium text-black">{userData?.role_profile}</p> */}
                <AddressView id={vendorData?.vendor_address}/>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
    )
}
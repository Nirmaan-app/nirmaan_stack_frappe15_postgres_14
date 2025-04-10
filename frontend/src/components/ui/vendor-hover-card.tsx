import { Vendors } from "@/types/NirmaanStack/Vendors"
import { useFrappeGetDoc } from "frappe-react-sdk"
import { useNavigate } from "react-router-dom"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card"

export const VendorHoverCard: React.FC<{vendor_id?: string}> = ({ vendor_id }) => {
    const { data: vendorData } = useFrappeGetDoc<Vendors>("Vendors", vendor_id, vendor_id ? `Vendors ${vendor_id}` : null)

    const navigate = useNavigate()
    return (
        <HoverCard>
            <HoverCardTrigger>
                <span className="underline">{vendorData?.vendor_name}</span>
            </HoverCardTrigger>
            <HoverCardContent className="text-xs p-4 shadow-lg rounded-lg bg-white w-72 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Vendor Details</h3>
            <div className="flex flex-col space-y-2">
              <div>
                <span className=" text-gray-500">Vendor ID:</span>
                <p onClick={() => navigate(`/vendors/${vendorData?.name}`)} className=" font-medium text-blue-500 underline cursor-pointer">{vendorData?.name}</p>
              </div>
              <div>
                <span className=" text-gray-500">Vendor Type:</span>
                <p className=" font-medium text-black">{vendorData?.vendor_type}</p>
              </div>
              <div>
                <span className=" text-gray-500">Contact Person Name:</span>
                <p className={`${!vendorData?.vendor_contact_person_name ? "text-primary font-bold" : "font-medium text-black"}`}>{vendorData?.vendor_contact_person_name || "N/A"}</p>
              </div>
              <div>
                <span className=" text-gray-500">Mobile Number:</span>
                <p className={`${!vendorData?.vendor_mobile ? "text-primary font-bold" : "font-medium text-black"}`}>{vendorData?.vendor_mobile || "N/A"}</p>
              </div>
              <div>
                <span className=" text-gray-500">Email:</span>
                <p className=" font-medium text-black">{vendorData?.vendor_email || "N/A"}</p>
              </div>
              <div>
                <span className=" text-gray-500">GST:</span>
                <p className=" font-medium text-black">{vendorData?.vendor_gst || "N/A"}</p>
              </div>
              <div>
                <span className=" text-gray-500">Vendor Address: </span>
                {/* <p className="text-base font-medium text-black">{userData?.role_profile}</p> */}
                {/* <AddressView id={vendorData?.vendor_address}/> */}
                <span>{vendorData?.vendor_city}, {vendorData?.vendor_state}</span>
              </div>
              <h3 className="text-sm font-semibold text-gray-800 mt-2">Bank Details</h3>
              <div>
                <span className=" text-gray-500">Account No.: </span>
                <p className=" font-medium text-black">{vendorData?.ifsc || "N/A"}</p>
              </div>
              <div>
                <span className=" text-gray-500">IFSC: </span>
                <p className=" font-medium text-black">{vendorData?.account_number || "N/A"}</p>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
    )
}
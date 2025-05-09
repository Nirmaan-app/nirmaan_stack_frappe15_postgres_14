import { formatDate } from "@/utils/FormatDate"
import { useFrappeGetDoc } from "frappe-react-sdk"
import { useEffect, useState } from "react"
import { Card } from "../ui/card"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card"

interface ProcurementHeaderCardProps {
  orderData?: any
  sentBack?: boolean
  sr?: boolean
  customPr?: boolean
}

export const ProcurementHeaderCard = ({ orderData = undefined, sentBack = false, sr = false, customPr = false }: ProcurementHeaderCardProps) => {
  const [creatorId, setCreatorId] = useState<string | undefined>("")
  const [approverId, setApproverId] = useState<string | undefined>("")

  const { data: creatorData } = useFrappeGetDoc("Nirmaan Users", creatorId, (creatorId && creatorId !== "Administrator") ? `Nirmaan Users ${creatorId}` : null);

  const { data: approverData } = useFrappeGetDoc("Nirmaan Users", approverId, (approverId && approverId !== "Administrator") ? `Nirmaan Users ${approverId}` : null);


  useEffect(() => {
    if (orderData) {
      setCreatorId(orderData.owner);
      setApproverId(orderData.modified_by);
    }
  }, [orderData]);

  return (
    <Card className="flex flex-wrap md:grid md:grid-cols-4 justify-around border border-gray-100 rounded-lg p-4 max-sm:justify-start max-sm:gap-4">
      {/* Date Section */}
      <div className="border-0 flex flex-col">
        <p className="text-left py-1 font-light text-sm text-red-700">Date:</p>
        <p className="text-left font-bold py-1 text-base text-black">
          {customPr ? formatDate(new Date()) : formatDate(orderData?.creation?.split(" ")[0])}
        </p>
      </div>
      {!sentBack && (
        <div className="border-0 flex flex-col">
          <p className="text-left py-1 font-light text-sm text-red-700">Package</p>
          <p className="text-left font-bold py-1 text-base text-black">{sr ? "Services" : customPr ? "Custom" : orderData?.work_package}</p>
        </div>
      )}
      {sentBack && (
        <div className="border-0 flex flex-col">
          <p className="text-left py-1 font-light text-sm text-red-700">PR ID:</p>
          <p className="text-left font-bold py-1 text-base text-black">{orderData?.procurement_request?.slice(-4)}</p>
        </div>
      )}
      {!sentBack && (
        <div className="border-0 flex flex-col">
          <p className="text-left py-1 font-light text-sm text-red-700">Approved By</p>
          <p className="text-left font-bold py-1 text-base text-black">
            {approverData?.full_name || (orderData?.modified_by === "Administrator" ? "Administrator" : orderData?.modified_by)}
          </p>
        </div>
      )}
      {sentBack && (
        <div className="border-0 flex flex-col">
          <p className="text-left py-1 font-light text-sm text-red-700">{orderData?.type} By</p>
          <p className="text-left font-bold py-1 text-base text-black">
            {approverData?.full_name || (orderData?.modified_by === "Administrator" ? "Administrator" : orderData?.modified_by)}
          </p>
        </div>
      )}

      {!sentBack && creatorId == "Administrator" && (
        <div className="border-0 flex flex-col">
          <p className="text-left py-1 font-light text-sm text-red-700">Creator</p>
          <p className="text-left font-bold py-1 text-base text-black">
            Administrator
          </p>
        </div>
      )}

      {/* HoverCard Section for Creator Details (Only if not Administrator) */}
      {!sentBack && creatorId !== "Administrator" && (
        <div className="border-0 flex flex-col max-sm:hidden">
          <p className="text-left py-1 font-light text-sm text-red-700">{sentBack ? `${orderData?.type} By` : "Creator"}</p>
          <HoverCard>
            <HoverCardTrigger>
              <p className="text-left font-bold py-1 text-base text-black underline cursor-pointer truncate">
                {creatorData?.full_name || orderData?.owner}
              </p>
            </HoverCardTrigger>
            <HoverCardContent className="p-4 shadow-lg rounded-lg bg-white w-72 border border-gray-200">
              {/* User Details UI */}
              <h3 className="text-lg font-semibold text-gray-800 mb-2">User Information</h3>
              <div className="flex flex-col space-y-2">
                <div>
                  <span className="text-sm text-gray-500">Full Name:</span>
                  <p className="text-base font-medium text-black">{creatorData?.full_name}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Email:</span>
                  <p className="text-base font-medium text-blue-500">{creatorData?.email}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Mobile Number:</span>
                  <p className="text-base font-medium text-black">{creatorData?.mobile_no || "N/A"}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Role:</span>
                  <p className="text-base font-medium text-black">{creatorData?.role_profile}</p>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>
      )}
    </Card>
  )
}

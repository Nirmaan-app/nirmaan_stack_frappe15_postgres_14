import { formatDate } from "@/utils/FormatDate"
import { useFrappeGetDoc } from "frappe-react-sdk"
import { useEffect, useState } from "react"
import { Card } from "./card"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card"

interface ProcurementHeaderCardProps {
  orderData?: any
  sentBack?: boolean
  sr?: boolean
}

export const ProcurementHeaderCard = ({ orderData = undefined, sentBack = false, sr = false }: ProcurementHeaderCardProps) => {
  const [projectName, setProjectName] = useState<string | undefined>("")
  const [userName, setUserName] = useState<string | undefined>("")

  const { data: projectData } = useFrappeGetDoc("Projects", projectName, projectName ? `Projects ${projectName}` : null)
  const { data: userData } = useFrappeGetDoc("Nirmaan Users", userName, (userName !== "Administrator") ? `Nirmaan Users ${userName}` : null)

  function capitalizeFirstLetter(string: string) {
    return string?.charAt(0).toUpperCase() + string?.slice(1).toLowerCase();
  }

  useEffect(() => {
    if (orderData) {
      setProjectName(orderData.project)
      setUserName(orderData.owner)
    }
  }, [orderData])

  return (
    <Card className="flex flex-wrap md:grid md:grid-cols-4 justify-around border border-gray-100 rounded-lg p-4 max-sm:justify-start max-sm:gap-4">
      <div className="border-0 flex flex-col max-sm:hidden">
        <p className="text-left py-1 font-light text-sm text-red-700">Date:</p>
        <p className="text-left font-bold py-1 text-base text-black">
          {formatDate(orderData?.creation?.split(" ")[0])}
        </p>
      </div>
      <div className="border-0 flex flex-col">
        <p className="text-left py-1 font-light text-sm text-red-700">Project</p>
        <HoverCard>
          <HoverCardTrigger>
            <p className="text-left font-bold py-1 text-base text-black underline cursor-pointer">
              {projectData?.project_name}
            </p>
          </HoverCardTrigger>
          <HoverCardContent className="p-4 shadow-lg rounded-lg bg-white w-96 border border-gray-200">
            {/* Project Details UI */}
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Project Overview</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="text-sm text-gray-500">Project Id:</span>
                <p className="text-base font-medium tracking-tight text-black">{projectData?.name}</p>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-gray-500">Customer:</span>
                <p className="text-base font-medium tracking-tight text-black">{projectData?.customer || "N/A"}</p>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-gray-500">Start Date:</span>
                <p className="text-base font-medium tracking-tight text-black">
                  {formatDate(projectData?.project_start_date)}
                </p>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-gray-500">End Date:</span>
                <p className="text-base font-medium tracking-tight text-black">
                  {formatDate(projectData?.project_end_date)}
                </p>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-gray-500">Location:</span>
                <p className="text-base font-medium tracking-tight text-black">
                  {capitalizeFirstLetter(projectData?.project_city)}, {capitalizeFirstLetter(projectData?.project_state)}
                </p>
              </div>
              {/* <div className="flex flex-col">
                <span className="text-sm text-gray-500">Estimated Area:</span>
                <p className="text-base font-medium tracking-tight text-black">
                  {projectData?.estimated_area || "N/A"} Sqft
                </p>
              </div> */}
            </div>
            <div className="mt-4">
              <h4 className="text-md font-semibold text-gray-700 mb-1">Work Packages</h4>
              <div className="flex gap-2 flex-wrap">
                {JSON.parse(projectData?.project_work_packages || "[]").work_packages?.map((item, index) => (
                  <span key={index} className="text-sm font-medium tracking-tight text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    {item.work_package_name}
                  </span>
                ))}
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>
      {!sentBack && (
        <div className="border-0 flex flex-col">
          <p className="text-left py-1 font-light text-sm text-red-700">Package</p>
          <p className="text-left font-bold py-1 text-base text-black">{sr ? "Services" : orderData?.work_package}</p>
        </div>
      )}
      {sentBack && (
        <div className="border-0 flex flex-col">
          <p className="text-left py-1 font-light text-sm text-red-700">PR ID:</p>
          <p className="text-left font-bold py-1 text-base text-black">{orderData?.procurement_request?.slice(-4)}</p>
        </div>
      )}
      <div className="border-0 flex flex-col max-sm:hidden">
        <p className="text-left py-1 font-light text-sm text-red-700">{sentBack ? `${orderData?.type} By` : "Project Lead"}</p>
        {/* <p className="text-left font-bold py-1 text-base text-black underline">{orderData?.owner}</p> */}
        <HoverCard>
          <HoverCardTrigger>
            <p className="text-left font-bold py-1 text-base text-black underline cursor-pointer">
              {orderData?.owner}
            </p>
          </HoverCardTrigger>
          <HoverCardContent className="p-4 shadow-lg rounded-lg bg-white w-72 border border-gray-200">
            {/* User Details UI */}
            <h3 className="text-lg font-semibold text-gray-800 mb-2">User Information</h3>
            <div className="flex flex-col space-y-2">
              <div>
                <span className="text-sm text-gray-500">Full Name:</span>
                <p className="text-base font-medium text-black">{userData?.full_name}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Email:</span>
                <p className="text-base font-medium text-blue-500">{userData?.email}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Mobile Number:</span>
                <p className="text-base font-medium text-black">{userData?.mobile_no || "N/A"}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Role:</span>
                <p className="text-base font-medium text-black">{userData?.role_profile}</p>
              </div>
              {/* <div>
                <span className="text-sm text-gray-500">Has Projects:</span>
                <p className="text-base font-medium text-black">{userData?.has_project === "true" ? "Yes" : "No"}</p>
              </div> */}
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>
    </Card>
  )
}

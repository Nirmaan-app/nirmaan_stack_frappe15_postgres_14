import {
  Card,
  CardContent,
  CardDescription
} from "@/components/ui/card";
import { Customers } from "@/types/NirmaanStack/Customers";
import { Radio } from "antd";
import { useFrappeGetDoc } from "frappe-react-sdk";
import React, { Suspense, useMemo } from "react";
import { TailSpin } from "react-loader-spinner";

interface CustomerOverviewProps {
  data?: Customers,
  customerId?: string
  tab: string
  onClick: (value: string) => void
}

const Projects = React.lazy(() => import("../projects/projects"));
const InFlowPayments = React.lazy(() => import("../projects/InFlowPayments"));

export const CustomerOverview : React.FC<CustomerOverviewProps> = ({data, customerId, tab, onClick}) => {

  const { data: customerAddress, isLoading: customerAddressLoading, error: customerAddressError } = useFrappeGetDoc("Address",
      data?.company_address,
      data?.company_address ? `Address ${data?.company_address}` : null,
      {
        revalidateIfStale: false,
      }
    );

  const overviewTabs = useMemo(() => [
        {
          label: "Projects",
          value: "projects"
        },
        {
          label: "Payments Inflow",
          value: "payments-inflow"
        },
      ], [])
  return (
    <>
        <Card>
          <CardContent className="flex max-lg:flex-col max-lg:gap-10 mt-6">
            <div className="space-y-4 lg:w-[50%]">
              <CardDescription className="space-y-2">
                <span>Company Id</span>
                <p className="font-bold text-black">{data?.name}</p>
              </CardDescription>

              <CardDescription className="space-y-2">
                <span>Contact Person</span>
                <p className="font-bold text-black">
                  {data?.company_contact_person || "N/A"}
                </p>
              </CardDescription>

              <CardDescription className="space-y-2">
                <span>Contact Number</span>
                <p className="font-bold text-black">
                  {data?.company_phone || "N/A"}
                </p>
              </CardDescription>
              <CardDescription className="space-y-2">
                <span>Email Address</span>
                <p className="font-bold text-black">
                  {data?.company_email || "N/A"}
                </p>
              </CardDescription>
              <CardDescription className="space-y-2">
                <span>GST Number</span>
                <p className="font-bold text-black">{data?.company_gst || "N/A"}</p>
              </CardDescription>
            </div>

            <div className="space-y-4">
              <CardDescription className="space-y-2">
                <span>Address</span>
                <p className="font-bold text-black">
                  {customerAddress?.address_line1},{" "}
                  {customerAddress?.address_line2}, {customerAddress?.city},{" "}
                  {customerAddress?.state}, {customerAddress?.pincode}
                </p>
              </CardDescription>

              <CardDescription className="space-y-2">
                <span>City</span>
                <p className="font-bold text-black">
                  {customerAddress?.city || "N/A"}
                </p>
              </CardDescription>

              <CardDescription className="space-y-2">
                <span>State</span>
                <p className="font-bold text-black">
                  {customerAddress?.state || "N/A"}
                </p>
              </CardDescription>

              <CardDescription className="space-y-2">
                <span>Country</span>
                <p className="font-bold text-black">
                  {customerAddress?.country}
                </p>
              </CardDescription>
            </div>
          </CardContent>
        </Card>
        {overviewTabs && (
              <Radio.Group
                  options={overviewTabs}
                  defaultValue="projects"
                  optionType="button"
                  buttonStyle="solid"
                  value={tab}
                  onChange={(e) => onClick(e.target.value)}
              />
        )}

          <Suspense fallback={<div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>}>
            {tab === "projects" && (
              <Projects customersView customerId={customerId} />
            )}

            {tab === "payments-inflow" && (
              <InFlowPayments customerId={customerId} />
            )}
          </Suspense>
    </>
  )
}

export default CustomerOverview;
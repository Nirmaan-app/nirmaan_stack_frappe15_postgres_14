"use client";

import {
  Card,
  CardContent,
  CardDescription
} from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton";
// import { fetchDoc } from "@/reactQuery/customFunctions";
// import { useQuery } from "@tanstack/react-query";
import { Customers } from "@/types/NirmaanStack/Customers";
import { Radio } from "antd";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { FilePenLine } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { InFlowPayments } from "../projects/InFlowPayments";
import Projects from "../projects/projects";
import EditCustomer from "./edit-customer";

const Customer : React.FC = () => {
  const { customerId } = useParams<{ customerId: string }>();

  return <div>{customerId && <CustomerView customerId={customerId} />}</div>;
};

export const Component = Customer;

const CustomerView : React.FC<{ customerId: string }> = ({ customerId }) => {
  const [searchParams] = useSearchParams(); 
  const [tab, setTab] = useState<string>(searchParams.get("tab") || "Projects")

  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const toggleEditSheet = () => {
    setEditSheetOpen((prevState) => !prevState);
  };

  const { data, isLoading, error } = useFrappeGetDoc<Customers>(
    "Customers",
    customerId,
    `Customers ${customerId}`,
    {
      revalidateIfStale: false,
    }
  );

  const customerAddressID = useMemo(() => data?.company_address, [data])

  const {
    data: customerAddress,
    isLoading: customerAddressLoading,
    error: customerAddressError,
  } = useFrappeGetDoc(
    "Address",
    customerAddressID,
    `${customerAddressID ? `Address ${customerAddressID}` : ""}`,
    {
      revalidateIfStale: false,
    }
  );

  const updateURL = useCallback(
      (params: Record<string, string>) => {
      const url = new URL(window.location.href);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
      window.history.pushState({}, '', url);
    }, []);

  const tabs = useMemo(() => [
        {
          label: "Projects",
          value: "Projects"
        },
        {
          label: "Payments Inflow",
          value: "Payments Inflow"
        },
      ], [])

  const onClick = useCallback(
      (value : string) => {
        if (tab === value) return;
        setTab(value);
        updateURL({ tab: tab });
      }
      , [tab, updateURL]);


  if (error || customerAddressError)
    return (
      <h1 className="text-red-700">
        There is an Error while fetching the account
      </h1>
    );

  return (
    <div className="flex-1 md:space-y-4">
      <div className="flex items-center gap-1 max-md:mb-2">
        {isLoading ? (
          <Skeleton className="h-10 w-1/3 bg-gray-300" />
        ) : (
          <h2 className="text-xl md:text-3xl font-bold tracking-tight ml-2">
            {data?.company_name}
          </h2>
        )}
        <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet}>
          <SheetTrigger>
            <FilePenLine className="text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
          </SheetTrigger>
          <SheetContent className="overflow-auto">
            <EditCustomer toggleEditSheet={toggleEditSheet} />
          </SheetContent>
        </Sheet>
      </div>
      {isLoading || customerAddressLoading ? (
        <OverviewSkeleton />
      ) : (
        <>
          <Card>
            <CardContent className="flex max-lg:flex-col max-lg:gap-10 mt-6">
              {/* <Card className="bg-[#F9FAFB]">
                  <CardHeader>
                    <CardContent className="flex max-lg:flex-col max-lg:gap-10"> */}
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

          {tabs && (
                <Radio.Group
                    options={tabs}
                    defaultValue="Projects"
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                />
            )}

            {tab === "Projects" && (
              <Projects customersView customerId={customerId} />
            )}

            {tab === "Payments Inflow" && (
              <InFlowPayments customerId={customerId} />
            )}
          </>
      )}
    </div>
  );
};
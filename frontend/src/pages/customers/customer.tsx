import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ConfigProvider, Menu, MenuProps } from "antd";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { FilePenLine } from "lucide-react";
import React, { Suspense, useCallback, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useParams, useSearchParams } from "react-router-dom";
import EditCustomer from "./edit-customer";
import { useStateSyncedWithParams } from "@/hooks/useSearchParamsManager";

const CustomerOverview = React.lazy(() => import("./CustomerOverview"));
const CustomerFinancials = React.lazy(() => import("./CustomerFinancials"));

export const Customer : React.FC = () => {

  const { customerId } = useParams<{ customerId: string }>();
  // const [searchParams] = useSearchParams(); 

  const [mainTab, setMainTab] = useStateSyncedWithParams<string>("main", "overview") // Default to overview if not specified
  // const [mainTab, setMainTab] = useState<string>(searchParams.get("main") || "overview")

  const [tab, setTab] = useStateSyncedWithParams<string>("tab", mainTab === "financials" ? "All Payments" : "projects") // Default to All Payments if not specified
  // const [tab, setTab] = useState<string>(searchParams.get("tab") || mainTab === "financials" ? "All Payments" : "projects")

  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const toggleEditSheet = useCallback(() => {
    setEditSheetOpen((prevState) => !prevState);
  }, [setEditSheetOpen]);

  const { data, isLoading, error } = useFrappeGetDoc<Customers>("Customers", customerId,`Customers ${customerId}`,
    {
      revalidateIfStale: false,
    }
  );

  // const updateURL = useCallback(
  //     (params: Record<string, string>, removeParams: string[] = []) => {
  //     const url = new URL(window.location.href);
  //     Object.entries(params).forEach(([key, value]) => {
  //       url.searchParams.set(key, value);
  //     });
  //     removeParams.forEach((key) => {
  //       url.searchParams.delete(key);
  //     });
  //     window.history.pushState({}, '', url);
  //   }, []);

  type MenuItem = Required<MenuProps>["items"][number];
    
  const mainTabs: MenuItem[] = useMemo(() => [
    {
      label: "Overview",
      key: "overview"
    },
    {
      label: "Financials",
      key: "financials"
    },
  ], [])

    const mainTabClick: MenuProps['onClick'] = useCallback(
        (e) => {
          if (mainTab === e.key) return;
          
          const newTab = e.key;
          // setTab(subTab);
          setMainTab(newTab, ["tab"]);
          // updateURL({ main: newTab, tab: subTab });
        }, [mainTab]);

  const onClick = useCallback(
      (value : string) => {
        if (tab === value) return;
        setTab(value);
        // updateURL({ tab: value });
      }
      , [tab]);


  if (error)
    return (
      <h1 className="text-red-700">
        There is an Error while fetching the account
      </h1>
    );

  return (
    <div className="flex-1 space-y-4">
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

       <div className="w-full">
                <ConfigProvider
                  theme={{
                    components: {
                      Menu: {
                        horizontalItemSelectedColor: "#D03B45",
                        itemSelectedBg: "#FFD3CC",
                        itemSelectedColor: "#D03B45",
                      },
                    },
                  }}
                >
                  <Menu
                    selectedKeys={[mainTab]}
                    onClick={mainTabClick}
                    mode="horizontal"
                    items={mainTabs}
                  />
                </ConfigProvider>
          </div>

         <Suspense fallback={<div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>}>
                {mainTab === "overview" && (
                   isLoading ? (
                        <OverviewSkeleton />
                      ) : (
                      <CustomerOverview data={data} customerId={customerId} tab={tab} onClick={onClick} />
                      )
                )}
    
                {mainTab === "financials" && (
                  <CustomerFinancials tab={tab} customerId={customerId} onClick={onClick} />
                )}
          </Suspense>

    </div>
  );
};

export default Customer;
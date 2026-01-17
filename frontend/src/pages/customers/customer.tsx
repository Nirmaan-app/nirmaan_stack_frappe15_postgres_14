import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Customers } from "@/types/NirmaanStack/Customers";
import { useFrappeDocumentEventListener, useFrappeGetDoc } from "frappe-react-sdk";
import { FilePenLine, LayoutDashboard, Receipt } from "lucide-react";
import React, { Suspense, useCallback, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useParams } from "react-router-dom";
import EditCustomer from "./edit-customer";
import { useStateSyncedWithParams } from "@/hooks/useSearchParamsManager";
import { toast } from "@/components/ui/use-toast";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

const CustomerOverview = React.lazy(() => import("./CustomerOverview"));
const CustomerFinancials = React.lazy(() => import("./CustomerFinancials"));

export const Customer : React.FC = () => {

  const { customerId } = useParams<{ customerId: string }>();
  if(!customerId) return <div>No Customer ID Provided</div>
  // const [searchParams] = useSearchParams(); 

  const [mainTab, setMainTab] = useStateSyncedWithParams<string>("main", "overview") // Default to overview if not specified
  // const [mainTab, setMainTab] = useState<string>(searchParams.get("main") || "overview")

  const [tab, setTab] = useStateSyncedWithParams<string>("tab", mainTab === "financials" ? "All Payments" : "projects") // Default to All Payments if not specified
  // const [tab, setTab] = useState<string>(searchParams.get("tab") || mainTab === "financials" ? "All Payments" : "projects")

  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const toggleEditSheet = useCallback(() => {
    setEditSheetOpen((prevState) => !prevState);
  }, [setEditSheetOpen]);

  const { data, isLoading, error, mutate } = useFrappeGetDoc<Customers>("Customers", customerId,`Customers ${customerId}`,
    {
      revalidateIfStale: false,
    }
  );

  useFrappeDocumentEventListener("Customers", customerId, (event) => {
          console.log("Customers document updated (real-time):", event);
          toast({
              title: "Document Updated",
              description: `Customers ${event.name} has been modified.`,
          });
          mutate(); // Re-fetch this specific document
        },
        true // emitOpenCloseEventsOnMount (default)
        )

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

  const handleMainTabChange = useCallback(
    (value: string) => {
      if (mainTab === value) return;
      setMainTab(value, ["tab"]);
    },
    [mainTab, setMainTab]
  );

  const handleSubTabChange = useCallback(
    (value: string) => {
      if (tab === value) return;
      setTab(value);
    },
    [tab, setTab]
  );


  if (error)
    return (
      <AlertDestructive error={error} />
    );

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center gap-1 max-md:mb-2">
        {isLoading ? (
          <Skeleton className="h-10 w-1/3 bg-gray-300" />
        ) : (
          <div className="flex items-baseline gap-2 ml-2">
            <h2 className="text-xl md:text-3xl font-bold tracking-tight text-primary">
              {data?.customer_nickname || data?.company_name}
            </h2>
            {data?.customer_nickname && (
              <span className="text-sm md:text-base text-muted-foreground">
                ({data?.company_name})
              </span>
            )}
          </div>
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

      <Tabs value={mainTab} onValueChange={handleMainTabChange} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="overview" className="gap-2">
            <LayoutDashboard className="h-4 w-4" />
            <span>Overview</span>
          </TabsTrigger>
          <TabsTrigger value="financials" className="gap-2">
            <Receipt className="h-4 w-4" />
            <span>Financials</span>
          </TabsTrigger>
        </TabsList>

        <Suspense fallback={<div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /></div>}>
          <TabsContent value="overview">
            {isLoading ? (
              <OverviewSkeleton />
            ) : (
              <CustomerOverview
                data={data}
                customerId={customerId}
                tab={tab}
                onClick={handleSubTabChange}
              />
            )}
          </TabsContent>

          <TabsContent value="financials">
            <CustomerFinancials
              tab={tab}
              customerId={customerId}
              onClick={handleSubTabChange}
            />
          </TabsContent>
        </Suspense>
      </Tabs>

    </div>
  );
};

export default Customer;
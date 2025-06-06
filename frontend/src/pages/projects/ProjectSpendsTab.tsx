import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectEstimates } from "@/types/NirmaanStack/ProjectEstimates";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { parseNumber } from "@/utils/parseNumber";
import { urlStateManager } from "@/utils/urlStateManager";
import { Radio } from "antd";
import { useFrappeGetDocList } from "frappe-react-sdk";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { v4 as uuidv4 } from "uuid";


interface ProjectSpendsTabProps {
  options: { label: string; value: string }[];
  // updateURL: (params: Record<string, string>, removeParams?: string[]) => void;
  categorizedData: {
    [workPackage: string]: {
      [category: string]: any[];
    };
  };
  po_data?: ProcurementOrder[];
  getTotalAmountPaid: {
    poAmount: number;
    srAmount: number;
    totalAmount: number;
  };
  workPackageTotalAmounts: { [key: string]: any }
  totalServiceOrdersAmt: number;
  projectId: string
}

export const ProjectSpendsTab: React.FC<ProjectSpendsTabProps> = ({ options, categorizedData, po_data, getTotalAmountPaid, workPackageTotalAmounts, totalServiceOrdersAmt, projectId }) => {

  const initialTab = useMemo(() => {
    return getUrlStringParam("tab", "All");
  }, []); // Calculate once
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // // Effect to sync tab state TO URL
  useEffect(() => {
    // Only update URL if the state `tab` is different from the URL's current 'tab' param
    if (urlStateManager.getParam("tab") !== activeTab) {
      urlStateManager.updateParam("tab", activeTab);
    }
  }, [activeTab]);

  // // Effect to sync URL state TO tab state (for popstate/direct URL load)
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
      // Update state only if the new URL value is different from current state
      const newTab = value || initialTab; // Fallback to initial if param removed
      if (activeTab !== newTab) {
        setActiveTab(newTab);
      }
    });
    return unsubscribe; // Cleanup subscription
  }, [initialTab]); // Depend on `tab` to avoid stale closures

  const { data: project_estimates, isLoading: project_estimates_loading } = useFrappeGetDocList<ProjectEstimates>("Project Estimates", {
    fields: ["quantity_estimate", "rate_estimate", "category", "name", "work_package", "item", "item_name"],
    filters: [["project", "=", projectId]],
    limit: 0,
  },
    projectId ? undefined : null
  );

  const { data: approvedServiceRequestsData, isLoading: approvedServiceRequestsDataLoading } = useFrappeGetDocList<ServiceRequests>("Service Requests", {
    fields: ["service_order_list", "name"],
    filters: [
      ["status", "=", "Approved"],
      ["project", "=", projectId],
    ],
    limit: 0,
  },
    projectId ? undefined : null
  );

  const segregatedServiceOrderData = useMemo(() => {
    if (!approvedServiceRequestsData) return [];

    const result: { [category: string]: { key: string; unit: string; quantity: number; amount: number; children: any[]; estimate_total: number } }[] = [];

    const servicesEstimates = project_estimates?.filter(
      (p) => p?.work_package === "Services"
    );

    approvedServiceRequestsData?.forEach((serviceRequest) => {
      serviceRequest.service_order_list.list?.forEach((item) => {
        const { category, uom, quantity, rate } = item;
        const amount = (parseNumber(quantity) || 1) * parseNumber(rate);

        const existingCategory = result.find((entry) => entry[category]);

        const estimateItem = servicesEstimates?.filter(
          (i) => i?.category === category
        );

        const estimate_total = estimateItem?.reduce(
          (acc, i) => acc + (parseNumber(i?.quantity_estimate) * parseNumber(i?.rate_estimate)),
          0
        ) || 0;

        if (existingCategory) {
          existingCategory[category].quantity += parseNumber(quantity);
          existingCategory[category].amount += amount;
          existingCategory[category].children.push({ ...item, amount: amount });
        } else {
          result.push({
            [category]: {
              key: uuidv4(),
              unit: uom,
              quantity: parseNumber(quantity),
              amount: amount,
              children: [{ ...item, amount: amount }],
              estimate_total: estimate_total,
            },
          });
        }
      });
    });

    return result;
  }, [approvedServiceRequestsData, project_estimates]);

  const finalOptions = useMemo(() => {
    if (!options) return [];

    const existingValues = options.map(opt => opt.value);

    const newOptions = [...options];

    if (!existingValues.includes("Custom")) {
      newOptions.push({ label: "Custom", value: "Custom" });
    }

    // Sort so "All" comes first, "Services" second, and "Custom" last
    return newOptions.sort((a, b) => {
      const priority = {
        "All": -3,
        "Services": -2,
        "Custom": 2
      };
      return (priority[a.value] ?? 0) - (priority[b.value] ?? 0);
    });

  }, [options]);


  const setProjectSpendsTab = useCallback(
    (tab: string) => {
      if (activeTab !== tab) {
        setActiveTab(tab);
        // updateURL({ tab });
      }
    }, [activeTab]);

  const ServiceRequestsAccordion = React.lazy(() => import("./ServiceRequestsAccordion"));
  const CategoryAccordion = React.lazy(() => import("./CategoryAccordion"));
  const AllTab = React.lazy(() => import("./AllTab"));

  if (project_estimates_loading || approvedServiceRequestsDataLoading) {
    return <div className="flex items-center h-[40vh] w-full justify-center">
      <TailSpin color={"red"} />
    </div>
  }
  return (
    <>
      {finalOptions && (
        <Radio.Group
          options={finalOptions}
          defaultValue="All"
          optionType="button"
          buttonStyle="solid"
          value={activeTab}
          onChange={(e) => setProjectSpendsTab(e.target.value)}
        />
      )}

      {activeTab && !["All", "Services"].includes(activeTab) && (
        <Suspense fallback={
          <div className="flex items-center h-[40vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
          </div>
        }>
          <CategoryAccordion
            categorizedData={categorizedData}
            selectedPackage={activeTab}
            projectEstimates={
              project_estimates?.filter((i) => {
                if (activeTab === "Custom") return false;  // ❗️ Don't show anything from estimates
                return i?.work_package === activeTab;
              }) || []
            }
            po_data={po_data}
          />
        </Suspense>
      )}

      {activeTab === "All" && (
        <Suspense fallback={
          <div className="flex items-center h-[40vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
          </div>
        }>
          <AllTab workPackageTotalAmounts={workPackageTotalAmounts} setProjectSpendsTab={setProjectSpendsTab} segregatedServiceOrderData={segregatedServiceOrderData} totalServiceOrdersAmt={totalServiceOrdersAmt} getTotalAmountPaid={getTotalAmountPaid} />
        </Suspense>
      )}

      {activeTab === "Services" && (
        <Suspense fallback={
          <div className="flex items-center h-[40vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
          </div>
        }>
          <ServiceRequestsAccordion
            segregatedData={segregatedServiceOrderData}
          />
        </Suspense>
      )}

    </>
  )
}

export default ProjectSpendsTab;
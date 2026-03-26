import { useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes";
import { Address } from "@/types/NirmaanStack/Address";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { ProjectQueryKeys } from "@/pages/projects/queries";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";

const editProjectFormKeys = {
  procurementPackages: () => ["project-tab", "edit-form", "procurement-packages"] as const,
  customers: () => ["project-tab", "edit-form", "customers"] as const,
  projectTypes: () => ["project-tab", "edit-form", "project-types"] as const,
  address: (addressId?: string) => ["project-tab", "edit-form", "address", addressId] as const,
  pincode: (pincode: string) => ["project-tab", "edit-form", "pincode", pincode] as const,
  categories: () => ["project-tab", "edit-form", "categories"] as const,
};

export const useEditProjectFormApi = (projectId?: string) => {
  const projectResponse = useFrappeGetDoc<ProjectsType>(
    "Projects",
    projectId,
    projectId ? ProjectQueryKeys.project(projectId) : null
  );

  const procurementPackagesResponse = useFrappeGetDocList<ProcurementPackages>(
    "Procurement Packages",
    {
      fields: ["work_package_name"],
      filters: [["work_package_name", "not in", ["Tool & Equipments", "Services", "Additional Charges"]]],
      limit: 0,
    },
    editProjectFormKeys.procurementPackages()
  );

  const customersResponse = useFrappeGetDocList<Customers>(
    "Customers",
    {
      fields: ["name", "company_name"],
      limit: 0,
    },
    editProjectFormKeys.customers()
  );

  const projectTypesResponse = useFrappeGetDocList<ProjectTypes>(
    "Project Types",
    {
      fields: ["name", "project_type_name"],
      limit: 0,
    },
    editProjectFormKeys.projectTypes()
  );

  const projectAddressResponse = useFrappeGetDoc<Address>(
    "Address",
    projectResponse.data?.project_address,
    projectResponse.data?.project_address
      ? editProjectFormKeys.address(projectResponse.data.project_address)
      : null
  );

  const updateDocResponse = useFrappeUpdateDoc();

  const updateDoc = async (doctype: string, name: string, payload: Record<string, any>) => {
    try {
      return await updateDocResponse.updateDoc(doctype, name, payload);
    } catch (error) {
      captureApiError({
        hook: "useEditProjectFormApi",
        api: `Update ${doctype}`,
        feature: "projects-tab-edit-form",
        doctype,
        entity_id: name,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(projectResponse.error, {
    hook: "useEditProjectFormApi",
    api: "Projects Doc",
    feature: "projects-tab-edit-form",
    entity_id: projectId,
  });

  useApiErrorLogger(procurementPackagesResponse.error, {
    hook: "useEditProjectFormApi",
    api: "Procurement Packages List",
    feature: "projects-tab-edit-form",
  });

  useApiErrorLogger(customersResponse.error, {
    hook: "useEditProjectFormApi",
    api: "Customers List",
    feature: "projects-tab-edit-form",
  });

  useApiErrorLogger(projectTypesResponse.error, {
    hook: "useEditProjectFormApi",
    api: "Project Types List",
    feature: "projects-tab-edit-form",
  });

  useApiErrorLogger(projectAddressResponse.error, {
    hook: "useEditProjectFormApi",
    api: "Address Doc",
    feature: "projects-tab-edit-form",
    entity_id: projectResponse.data?.project_address,
  });

  useApiErrorLogger(updateDocResponse.error, {
    hook: "useEditProjectFormApi",
    api: "Update Doc",
    feature: "projects-tab-edit-form",
  });

  return {
    projectResponse,
    procurementPackagesResponse,
    customersResponse,
    projectTypesResponse,
    projectAddressResponse,
    updateDoc,
    loading: updateDocResponse.loading,
  };
};

export const useEditProjectFormPincode = (pincode: string) => {
  const response = useFrappeGetDoc(
    "Pincodes",
    pincode,
    pincode ? editProjectFormKeys.pincode(pincode) : null
  );

  useApiErrorLogger(response.error, {
    hook: "useEditProjectFormPincode",
    api: "Pincodes Doc",
    feature: "projects-tab-edit-form",
    entity_id: pincode,
  });

  return response;
};

export const useEditProjectFormCategories = () => {
  const response = useFrappeGetDocList(
    "Category",
    {
      fields: ["category_name", "work_package", "name"],
      filters: [["work_package", "not in", ["Tool & Equipments", "Services"]]],
      limit: 10000,
    },
    editProjectFormKeys.categories()
  );

  useApiErrorLogger(response.error, {
    hook: "useEditProjectFormCategories",
    api: "Category List",
    feature: "projects-tab-edit-form",
  });

  return response;
};

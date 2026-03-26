import {
  useFrappeFileUpload,
  useFrappeGetDoc,
  useFrappePostCall,
} from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";
import { ProjectQueryKeys } from "@/pages/projects/queries";

const CREATE_CUSTOMER_PO_METHOD =
  "nirmaan_stack.api.projects.add_customer_po.add_customer_po_with_validation";
const UPDATE_CUSTOMER_PO_METHOD =
  "nirmaan_stack.api.projects.add_customer_po.update_customer_po_with_validation";
const DELETE_CUSTOMER_PO_METHOD =
  "nirmaan_stack.api.projects.add_customer_po.delete_customer_po";

export interface CustomerPOPayload {
  customer_po_number: string;
  customer_po_value_inctax: number;
  customer_po_value_exctax: number;
  customer_po_link: string;
  customer_po_attachment: string;
  customer_po_payment_terms: string;
  customer_po_creation_date: string;
}

interface CustomerPOProjectsDoc {
  name: string;
  project_name?: string;
  customer_po_details?: any[];
}

export const useCustomerPOProjectDoc = (projectId?: string) => {
  const response = useFrappeGetDoc<CustomerPOProjectsDoc>(
    "Projects",
    projectId,
    projectId ? ProjectQueryKeys.project(projectId) : null
  );

  useApiErrorLogger(response.error, {
    hook: "useCustomerPOProjectDoc",
    api: "Projects Doc",
    feature: "projects-tab-financials",
    entity_id: projectId,
  });

  return response;
};

export const useCustomerPOActions = () => {
  const createResponse = useFrappePostCall<{ message: any }>(CREATE_CUSTOMER_PO_METHOD);
  const updateResponse = useFrappePostCall<{ message: any }>(UPDATE_CUSTOMER_PO_METHOD);
  const deleteResponse = useFrappePostCall<{ message: any }>(DELETE_CUSTOMER_PO_METHOD);
  const uploadResponse = useFrappeFileUpload();

  const createCustomerPO = async (projectName: string, newPoDetail: CustomerPOPayload) => {
    try {
      return await createResponse.call({
        project_name: projectName,
        new_po_detail: newPoDetail,
      });
    } catch (error) {
      captureApiError({
        hook: "useCustomerPOActions",
        api: CREATE_CUSTOMER_PO_METHOD,
        feature: "projects-tab-financials",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  const updateCustomerPO = async (
    projectName: string,
    updatedPoDetail: CustomerPOPayload & { name: string }
  ) => {
    try {
      return await updateResponse.call({
        project_name: projectName,
        updated_po_detail: updatedPoDetail,
      });
    } catch (error) {
      captureApiError({
        hook: "useCustomerPOActions",
        api: UPDATE_CUSTOMER_PO_METHOD,
        feature: "projects-tab-financials",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  const deleteCustomerPO = async (projectName: string, poDocName: string) => {
    try {
      return await deleteResponse.call({
        project_name: projectName,
        po_doc_name: poDocName,
      });
    } catch (error) {
      captureApiError({
        hook: "useCustomerPOActions",
        api: DELETE_CUSTOMER_PO_METHOD,
        feature: "projects-tab-financials",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  const uploadCustomerPOAttachment = async (projectName: string, file: File) => {
    try {
      return await uploadResponse.upload(file, {
        isPrivate: true,
        doctype: "Projects",
        docname: projectName,
        fieldname: "customer_po_attachment",
      });
    } catch (error) {
      captureApiError({
        hook: "useCustomerPOActions",
        api: "uploadCustomerPOAttachment",
        feature: "projects-tab-financials",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(createResponse.error, {
    hook: "useCustomerPOActions",
    api: CREATE_CUSTOMER_PO_METHOD,
    feature: "projects-tab-financials",
  });

  useApiErrorLogger(updateResponse.error, {
    hook: "useCustomerPOActions",
    api: UPDATE_CUSTOMER_PO_METHOD,
    feature: "projects-tab-financials",
  });

  useApiErrorLogger(deleteResponse.error, {
    hook: "useCustomerPOActions",
    api: DELETE_CUSTOMER_PO_METHOD,
    feature: "projects-tab-financials",
  });

  return {
    createCustomerPO,
    updateCustomerPO,
    deleteCustomerPO,
    uploadCustomerPOAttachment,
    createLoading: createResponse.loading,
    updateLoading: updateResponse.loading,
    deleteLoading: deleteResponse.loading,
    uploadLoading: uploadResponse.loading,
  };
};

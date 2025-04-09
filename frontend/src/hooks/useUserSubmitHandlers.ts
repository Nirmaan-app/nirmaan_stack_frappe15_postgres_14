import { toast } from "@/components/ui/use-toast";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeDeleteDoc, useSWRConfig } from "frappe-react-sdk";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { KeyedMutator } from "swr";
import { NirmaanUserPermissions } from "../types/NirmaanStack/NirmaanUserPermissions";

// Constants for reusable strings
const DOCUMENT_TYPES = {
  USER_PERMISSION: "User Permission",
  NIRMAAN_USERS: "Nirmaan Users",
  PROJECT: "Projects"
};

const TOAST_MESSAGES = {
  SUCCESS: "Success!",
  ERROR: "Error!",
  FAILED: "Failed!"
};

// Helper function for consistent toast notifications
const showToast = (
  toast: any,
  variant: "success" | "destructive",
  title: string,
  description: string
) => {
  toast({ title, description, variant });
};

// Unified error handler
const handleError = (error: unknown, toast: any, defaultMessage: string) => {
  console.error("Operation failed:", error);
  showToast(toast, "destructive", TOAST_MESSAGES.FAILED, defaultMessage);
};

export const useUserSubmitHandlers = (data: NirmaanUsers | undefined, permission_list_mutate: KeyedMutator<NirmaanUserPermissions[]>) => {
  const navigate = useNavigate()
  const { createDoc: createDoc, loading: create_loading } = useFrappeCreateDoc();
  const { deleteDoc: deleteDoc, loading: delete_loading } = useFrappeDeleteDoc();
  const { mutate } = useSWRConfig();
  const { call } = useContext(FrappeContext) as FrappeConfig;

  const handleSubmit = async (curProj: string, projectName: string, toggleAssignProjectDialog: () => void) => {
    try {
      if (!data?.name || !curProj) {
        throw new Error("Missing required parameters");
      }

      await createDoc(DOCUMENT_TYPES.USER_PERMISSION, {
        user: data?.name,
        allow: DOCUMENT_TYPES.PROJECT,
        for_value: curProj
      });

      showToast(
        toast,
        "success",
        TOAST_MESSAGES.SUCCESS,
        `Successfully assigned ${projectName}`
      );
      await permission_list_mutate();
      toggleAssignProjectDialog()
    } catch (error) {
      handleError(
        error,
        toast,
        `Failed to assign ${projectName}`
      );
    }
  };

  const handleDeleteUser = async (toggleDeleteUserDialog: () => void) => {
    try {
      if (!data?.email) {
        throw new Error("User email is missing");
      }

      await deleteDoc(DOCUMENT_TYPES.NIRMAAN_USERS, data.email);
      await mutate(DOCUMENT_TYPES.NIRMAAN_USERS);

      showToast(
        toast,
        "success",
        TOAST_MESSAGES.SUCCESS,
        `User: ${data?.full_name} deleted successfully!`
      );
      toggleDeleteUserDialog()
      navigate("/users");
    } catch (error) {
      handleError(
        error,
        toast,
        `Failed to delete User: ${data?.full_name}`
      );
    }
  };

  const handleDeleteProject = async (project: string, permission_list: NirmaanUserPermissions[] | undefined, toggleUnlinkProjectDialog: () => void) => {
    try {
      const permission = permission_list?.find(
        p => p.for_value === project
      );

      if (!permission) {
        throw new Error("Permission not found");
      }

      await deleteDoc(DOCUMENT_TYPES.USER_PERMISSION, permission.name);
      await permission_list_mutate();

      showToast(
        toast,
        "success",
        TOAST_MESSAGES.SUCCESS,
        `${project} unlinked for ${data?.name}`
      );

      toggleUnlinkProjectDialog()
    } catch (error) {
      handleError(
        error,
        toast,
        `Failed to unlink ${project} for ${data?.name}`
      );
    }
  };

  const handlePasswordReset = async (toggleResetPasswordDialog: () => void) => {
    try {
      await call.post("frappe.core.doctype.user.user.reset_password", {
        user: data?.name
      });
      showToast(
        toast,
        "success",
        TOAST_MESSAGES.SUCCESS,
        "Password reset email has been sent to the user"
      );
      toggleResetPasswordDialog()
    } catch (error) {
      handleError(
        error,
        toast,
        "Failed to send password reset email"
      );
    }
  };

  return {
    handleSubmit,
    handleDeleteUser,
    handleDeleteProject,
    handlePasswordReset,
    create_loading,
    delete_loading,
  };
};
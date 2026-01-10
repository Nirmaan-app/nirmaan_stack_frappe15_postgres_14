import { toast } from "@/components/ui/use-toast";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeDeleteDoc, useSWRConfig } from "frappe-react-sdk";
import { useContext, useState } from "react";
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
  const [rename_loading, setRenameLoading] = useState(false);

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
      const response = await call.post("nirmaan_stack.api.users.reset_password", {
        user: data?.name
      });
      const result = response.message;

      if (result?.success) {
        if (result.email_sent) {
          showToast(
            toast,
            "success",
            TOAST_MESSAGES.SUCCESS,
            result.message
          );
        } else {
          // Reset link generated but email failed - show warning
          showToast(
            toast,
            "destructive",
            "Email Not Sent",
            result.message
          );
        }
      } else {
        // API returned success: false (shouldn't happen with new logic)
        showToast(
          toast,
          "destructive",
          TOAST_MESSAGES.ERROR,
          result?.message || "Failed to reset password"
        );
      }
      toggleResetPasswordDialog();
    } catch (error) {
      handleError(
        error,
        toast,
        "Failed to send password reset email"
      );
    }
  };

  const handleRenameEmail = async (
    newEmail: string,
    toggleRenameEmailDialog: () => void
  ) => {
    try {
      if (!data?.email || !newEmail) {
        throw new Error("Email is missing");
      }

      setRenameLoading(true);

      await call.post(
        "nirmaan_stack.api.users.rename_user_email",
        {
          old_email: data.email,
          new_email: newEmail
        }
      );

      await mutate(DOCUMENT_TYPES.NIRMAAN_USERS);

      showToast(
        toast,
        "success",
        TOAST_MESSAGES.SUCCESS,
        `Email renamed to ${newEmail}. User has been logged out.`
      );

      toggleRenameEmailDialog();
      navigate(`/users/${newEmail}`);
    } catch (error) {
      handleError(error, toast, "Failed to rename email");
    } finally {
      setRenameLoading(false);
    }
  };

  return {
    handleSubmit,
    handleDeleteUser,
    handleDeleteProject,
    handlePasswordReset,
    handleRenameEmail,
    create_loading,
    delete_loading,
    rename_loading,
  };
};
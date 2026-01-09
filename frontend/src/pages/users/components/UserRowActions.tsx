import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeDeleteDoc, useFrappePostCall } from "frappe-react-sdk";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { MoreHorizontal, Eye, KeyRound, Trash2 } from "lucide-react";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { useUserData } from "@/hooks/useUserData";
import { mutate } from "swr";

interface UserRowActionsProps {
  user: NirmaanUsers;
}

export function UserRowActions({ user }: UserRowActionsProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role: currentUserRole } = useUserData();
  const isAdmin = currentUserRole === "Nirmaan Admin Profile";
  const isTargetAdmin = user.role_profile === "Nirmaan Admin Profile";

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const { deleteDoc } = useFrappeDeleteDoc();
  const { call: resetPassword } = useFrappePostCall("frappe.core.doctype.user.user.reset_password");

  const handleViewProfile = () => {
    navigate(`/users/${user.name}`);
  };

  const handleResetPassword = async () => {
    try {
      setIsResetting(true);
      await resetPassword({ user: user.name });
      toast({
        title: "Password Reset Email Sent",
        description: `A password reset email has been sent to ${user.email}`,
        variant: "success",
      });
      setResetPasswordDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to send reset password email",
        variant: "destructive",
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleDeleteUser = async () => {
    try {
      setIsDeleting(true);
      await deleteDoc("Nirmaan Users", user.name);
      toast({
        title: "User Deleted",
        description: `${user.full_name} has been deleted successfully`,
        variant: "success",
      });
      setDeleteDialogOpen(false);
      // Refresh the users list
      mutate((key) => typeof key === "string" && key.includes("Nirmaan Users"));
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to delete user",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleViewProfile} className="cursor-pointer">
            <Eye className="mr-2 h-4 w-4" />
            View Profile
          </DropdownMenuItem>

          {isAdmin && (
            <>
              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => setResetPasswordDialogOpen(true)}
                className="cursor-pointer"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                Reset Password
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => !isTargetAdmin && setDeleteDialogOpen(true)}
                className={`cursor-pointer ${isTargetAdmin ? "opacity-50 cursor-not-allowed" : "text-destructive focus:text-destructive"}`}
                disabled={isTargetAdmin}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete User
                {isTargetAdmin && <span className="ml-auto text-xs">(Admin)</span>}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reset Password Dialog */}
      <AlertDialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Password</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a password reset email to <strong>{user.email}</strong>.
              The user will need to set a new password using the link in the email.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetPassword} disabled={isResetting}>
              {isResetting ? "Sending..." : "Send Reset Email"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete User Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{user.full_name}</strong>?
              This action cannot be undone. All user permissions and notifications
              associated with this user will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

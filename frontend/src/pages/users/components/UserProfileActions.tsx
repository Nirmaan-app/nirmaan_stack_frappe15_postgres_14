import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TailSpin } from "react-loader-spinner";
import {
  Settings,
  ChevronDown,
  KeyRound,
  PenLine,
  Trash2,
  Undo2,
  ShieldAlert,
} from "lucide-react";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

interface UserProfileActionsProps {
  user: NirmaanUsers;
  onResetPassword: (toggleDialog: () => void) => void;
  onDeleteUser: (toggleDialog: () => void) => void;
  onRenameEmail: (newEmail: string, toggleDialog: () => void) => void;
  deleteLoading: boolean;
  renameLoading: boolean;
}

export function UserProfileActions({
  user,
  onResetPassword,
  onDeleteUser,
  onRenameEmail,
  deleteLoading,
  renameLoading,
}: UserProfileActionsProps) {
  const [resetPasswordDialog, setResetPasswordDialog] = useState(false);
  const [deleteUserDialog, setDeleteUserDialog] = useState(false);
  const [renameEmailDialog, setRenameEmailDialog] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  const isTargetAdmin = user.role_profile === "Nirmaan Admin Profile";

  const toggleResetPasswordDialog = () => setResetPasswordDialog((prev) => !prev);
  const toggleDeleteUserDialog = () => setDeleteUserDialog((prev) => !prev);
  const toggleRenameEmailDialog = () => {
    setRenameEmailDialog((prev) => !prev);
    if (!renameEmailDialog) {
      setNewEmail("");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Settings className="h-4 w-4" />
            <span className="max-sm:hidden">Actions</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Admin Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={toggleResetPasswordDialog}
            className="cursor-pointer"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Reset Password
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={toggleRenameEmailDialog}
            disabled={isTargetAdmin}
            className={`cursor-pointer ${isTargetAdmin ? "opacity-50" : ""}`}
          >
            <PenLine className="mr-2 h-4 w-4" />
            Rename Email
            {isTargetAdmin && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ShieldAlert className="ml-auto h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Cannot rename admin users</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => !isTargetAdmin && toggleDeleteUserDialog()}
            disabled={isTargetAdmin}
            className={`cursor-pointer text-destructive focus:text-destructive ${isTargetAdmin ? "opacity-50" : ""}`}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete User
            {isTargetAdmin && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ShieldAlert className="ml-auto h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Cannot delete admin users</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialog} onOpenChange={setResetPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {user.full_name}</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            This action will send a reset password email to this user.
            Are you sure you want to continue?
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="gap-1">
                <Undo2 className="h-4 w-4" />
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={() => onResetPassword(toggleResetPasswordDialog)}
              className="gap-1"
            >
              <KeyRound className="h-4 w-4" />
              Send Reset Email
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={deleteUserDialog} onOpenChange={setDeleteUserDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete User: <span className="text-primary">{user.full_name}</span>
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            This action will permanently delete the user from the system.
            All user permissions and notifications will also be removed.
            This cannot be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            {deleteLoading ? (
              <TailSpin color="red" height={40} width={40} />
            ) : (
              <>
                <DialogClose asChild>
                  <Button variant="secondary" className="gap-1">
                    <Undo2 className="h-4 w-4" />
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={() => onDeleteUser(toggleDeleteUserDialog)}
                  className="gap-1"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete User
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Email Dialog */}
      <Dialog open={renameEmailDialog} onOpenChange={setRenameEmailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Rename Email for <span className="text-primary">{user.full_name}</span>
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            This will change the user's login email. The user will be logged out
            and must login with the new email.
          </DialogDescription>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Current Email</label>
              <input
                type="email"
                value={user.email || ""}
                disabled
                className="w-full mt-1.5 px-3 py-2 border rounded-md bg-muted text-muted-foreground text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">New Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value.toLowerCase())}
                placeholder="new.email@example.com"
                className="w-full mt-1.5 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {renameLoading ? (
              <TailSpin color="red" height={40} width={40} />
            ) : (
              <>
                <DialogClose asChild>
                  <Button variant="secondary" className="gap-1">
                    <Undo2 className="h-4 w-4" />
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={!newEmail || newEmail === user.email}
                  onClick={() => onRenameEmail(newEmail, toggleRenameEmailDialog)}
                  className="gap-1"
                >
                  <PenLine className="h-4 w-4" />
                  Rename Email
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

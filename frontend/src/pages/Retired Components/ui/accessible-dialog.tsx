// Create a reusable accessible Dialog component
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Dialog, DialogContent, DialogTitle } from "../../../components/ui/dialog";

export const AccessibleDialog = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <Dialog>
    <DialogTitle>
      <VisuallyHidden>{title}</VisuallyHidden>
    </DialogTitle>
    <DialogContent aria-describedby={description ? "dialog-description" : undefined}>
      {description && (
        <div id="dialog-description" className="sr-only">
          {description}
        </div>
      )}
      {children}
    </DialogContent>
  </Dialog>
);
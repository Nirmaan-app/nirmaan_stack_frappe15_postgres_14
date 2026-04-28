import React from "react";
import { Badge } from "@/components/ui/badge";
import { PROJECT_STATUS_BADGE_CLASSES } from "./projectStatus";

interface ProjectStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export const ProjectStatusBadge: React.FC<ProjectStatusBadgeProps> = ({
  status,
  className,
}) => {
  if (!status) return null;
  const styleClass =
    PROJECT_STATUS_BADGE_CLASSES[status] ||
    "bg-gray-100 text-gray-800 border-gray-300";
  return (
    <Badge
      variant="outline"
      className={`shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-md border ${styleClass} ${
        className ?? ""
      }`}
    >
      {status}
    </Badge>
  );
};

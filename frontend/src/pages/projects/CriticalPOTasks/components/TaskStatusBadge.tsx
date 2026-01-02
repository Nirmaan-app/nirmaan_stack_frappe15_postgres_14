import React from "react";
import { Badge } from "@/components/ui/badge";

interface TaskStatusBadgeProps {
  status: "Not Released" | "Partially Released" | "Released" | "Not Applicable";
}

const statusConfig = {
  "Not Released": {
    color: "bg-red-100 text-red-700 hover:bg-red-100",
    label: "Not Released",
  },
  "Partially Released": {
    color: "bg-yellow-100 text-yellow-700 hover:bg-yellow-100",
    label: "Partially Released",
  },
  Released: {
    color: "bg-green-100 text-green-700 hover:bg-green-100",
    label: "Released",
  },
  "Not Applicable": {
    color: "bg-gray-100 text-gray-700 hover:bg-gray-100",
    label: "Not Applicable",
  },
};

export const TaskStatusBadge: React.FC<TaskStatusBadgeProps> = ({ status }) => {
  const config = statusConfig[status] || statusConfig["Not Released"];

  return (
    <Badge className={`${config.color} font-medium`}>
      {config.label}
    </Badge>
  );
};

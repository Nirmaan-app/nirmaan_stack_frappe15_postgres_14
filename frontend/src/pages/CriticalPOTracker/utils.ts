import { CriticalPOTaskStatus } from "./types";

/**
 * Get Tailwind CSS classes for status badge styling
 * Matches the existing TaskStatusBadge colors from CriticalPOTasks
 */
export const getStatusStyle = (status: CriticalPOTaskStatus | string): string => {
  switch (status) {
    case "Released":
      return "bg-green-100 text-green-700 border border-green-500";
    case "Partially Released":
      return "bg-yellow-100 text-yellow-700 border border-yellow-500";
    case "Not Released":
      return "bg-red-100 text-red-700 border border-red-500";
    case "Not Applicable":
      return "bg-gray-100 text-gray-700 border border-gray-300";
    default:
      return "bg-gray-100 text-gray-600 border border-gray-300";
  }
};

/**
 * Get progress circle color based on completion percentage
 */
export const getProgressColor = (percentage: number): string => {
  if (percentage === 100) return "text-green-600";
  if (percentage >= 76) return "text-green-600";
  if (percentage >= 26) return "text-yellow-500";
  return "text-red-600";
};

/**
 * Order for displaying status badges (most critical first)
 */
export const STATUS_DISPLAY_ORDER: CriticalPOTaskStatus[] = [
  "Not Released",
  "Partially Released",
  "Released",
];

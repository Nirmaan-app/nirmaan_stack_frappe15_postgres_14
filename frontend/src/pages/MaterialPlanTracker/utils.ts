/**
 * Material Plan status constants
 */
export const MATERIAL_PLAN_STATUSES = {
  DELIVERED: "Delivered",
  NOT_DELIVERED: "Not Delivered",
} as const;

/**
 * Get styling for a status badge/chip
 */
export const getStatusStyle = (status: string): { bg: string; text: string } => {
  switch (status) {
    case MATERIAL_PLAN_STATUSES.DELIVERED:
      return { bg: "bg-green-100", text: "text-green-700" };
    case MATERIAL_PLAN_STATUSES.NOT_DELIVERED:
      return { bg: "bg-yellow-100", text: "text-yellow-700" };
    default:
      return { bg: "bg-gray-100", text: "text-gray-700" };
  }
};

/**
 * Get progress circle color based on percentage
 */
export const getProgressColor = (progress: number): string => {
  if (progress >= 80) return "text-green-600";
  if (progress >= 50) return "text-blue-600";
  if (progress >= 20) return "text-yellow-600";
  return "text-gray-400";
};

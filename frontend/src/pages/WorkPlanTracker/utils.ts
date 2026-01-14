/**
 * Work Plan status values (must match the values used in ProjectManagerEditWorkPlanDialog)
 */
export const WORK_PLAN_STATUSES = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
} as const;

export type WorkPlanStatus = typeof WORK_PLAN_STATUSES[keyof typeof WORK_PLAN_STATUSES];

/**
 * Get styling classes for a work plan status
 */
export const getStatusStyle = (status: string): { bg: string; text: string; border: string } => {
  switch (status) {
    case WORK_PLAN_STATUSES.COMPLETED:
      return {
        bg: "bg-green-50",
        text: "text-green-700",
        border: "border-green-200",
      };
    case WORK_PLAN_STATUSES.IN_PROGRESS:
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        border: "border-blue-200",
      };
    case WORK_PLAN_STATUSES.ON_HOLD:
      return {
        bg: "bg-orange-50",
        text: "text-orange-700",
        border: "border-orange-200",
      };
    case WORK_PLAN_STATUSES.NOT_STARTED:
    default:
      return {
        bg: "bg-gray-50",
        text: "text-gray-700",
        border: "border-gray-200",
      };
  }
};

/**
 * Get color class for progress value
 */
export const getProgressColor = (value: number): string => {
  if (value === 0) return "text-gray-400";
  if (value < 50) return "text-red-600";
  if (value < 75) return "text-yellow-600";
  if (value < 100) return "text-green-600";
  return "text-green-500";
};

/**
 * Status display order for consistent UI
 */
export const STATUS_DISPLAY_ORDER: WorkPlanStatus[] = [
  WORK_PLAN_STATUSES.NOT_STARTED,
  WORK_PLAN_STATUSES.IN_PROGRESS,
  WORK_PLAN_STATUSES.ON_HOLD,
  WORK_PLAN_STATUSES.COMPLETED,
];

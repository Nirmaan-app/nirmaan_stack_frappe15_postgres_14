export type ProjectStatus =
  | "WIP"
  | "Completed"
  | "Created"
  | "Halted"
  | "CEO Hold"
  | "Handover";

export const PROJECT_STATUS_OPTIONS: ProjectStatus[] = [
  "Completed",
  "Created",
  "Halted",
  "Handover",
  "WIP",
  "CEO Hold",
];

export const DEFAULT_PROJECT_STATUS_FILTER: ProjectStatus[] = ["WIP"];

// Tailwind classes per project status — used for the badge inside tracker cards
export const PROJECT_STATUS_BADGE_CLASSES: Record<string, string> = {
  WIP: "bg-yellow-100 text-yellow-800 border-yellow-400",
  Completed: "bg-green-100 text-green-800 border-green-400",
  Halted: "bg-red-100 text-red-800 border-red-400",
  "CEO Hold": "bg-amber-100 text-amber-900 border-amber-500",
  Handover: "bg-blue-100 text-blue-800 border-blue-400",
  Created: "bg-indigo-100 text-indigo-800 border-indigo-400",
};

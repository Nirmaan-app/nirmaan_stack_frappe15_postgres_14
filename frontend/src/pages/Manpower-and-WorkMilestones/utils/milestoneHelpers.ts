import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import React from 'react';

// --- Constants ---
export const DELIMITER = "$#,,,"; // Custom delimiter for work plan points

// --- Date Helpers ---

/**
 * Format date for input type="date" (YYYY-MM-DD)
 */
export const formatDateForInput = (date: Date): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Check if a date is today
 */
export const isDateToday = (date: Date | null): boolean => {
  if (!date) return false;
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
};

// --- Work Plan Helpers ---

/**
 * Parse work plan string into array of points
 */
export const parseWorkPlan = (workPlanString?: string | null): string[] => {
  if (!workPlanString || typeof workPlanString !== 'string' || workPlanString.trim() === '') {
    return [""]; // Start with an empty point
  }
  // Split the string and filter out empty strings resulting from trailing/leading delimiters
  return workPlanString.split(DELIMITER).filter(p => p.trim() !== '');
};

/**
 * Serialize work plan points array into string
 */
export const serializeWorkPlan = (workPlanPoints: string[]): string => {
  // Filter out empty lines before joining
  return workPlanPoints.filter(p => p.trim() !== '').join(DELIMITER);
};

// --- Status Badge Helpers ---

/**
 * Get badge classes based on milestone status
 */
export const getStatusBadgeClasses = (status: string): string => {
  switch (status) {
    case "Completed":
      return "bg-green-100 text-green-800 hover:bg-green-200";
    case "WIP":
      return "bg-yellow-100 text-yellow-800 hover:bg-yellow-200";
    case "Not Started":
      return "bg-red-100 text-red-800 hover:bg-red-200";
    case "N/A":
      return "bg-gray-100 text-gray-800 hover:bg-gray-200";
    default:
      return "bg-blue-100 text-blue-800 hover:bg-blue-200";
  }
};

/**
 * Get zone status indicator icon and color
 */
export const getZoneStatusIndicator = (status: string | null): {
  icon: React.ReactElement;
  color: string;
} => {
  switch (status) {
    case "Completed":
      return {
        icon: React.createElement(CheckCircle2, { className: "w-3 h-3 text-green-700" }),
        color: "bg-green-100 text-green-700"
      };
    case "Draft":
      return {
        icon: React.createElement(Clock, { className: "w-3 h-3 text-yellow-700" }),
        color: "bg-yellow-100 text-yellow-700"
      };
    case null:
    default:
      return {
        icon: React.createElement(XCircle, { className: "w-3 h-3 text-red-700" }),
        color: "bg-red-100 text-red-700"
      };
  }
};

// --- Progress Circle Helpers ---

/**
 * Get color class for progress value
 */
export const getColorForProgress = (value: number): string => {
  const val = Math.round(value);
  if (isNaN(val)) {
    return 'text-gray-500';
  }
  if (val === 0) {
    return 'text-black-500';
  }
  if (val < 50) {
    return 'text-red-600';
  }
  if (val < 75) {
    return 'text-yellow-600';
  }
  if (val < 100) {
    return 'text-green-600';
  }
  return 'text-green-500';
};

// --- Types ---

export interface ProjectZoneEntry {
  name?: string;
  zone_name: string;
}

export interface ZoneProgressInfo {
  status: string;
  name: string;
}

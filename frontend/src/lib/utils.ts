import * as React from 'react'
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


import { format, isValid } from "date-fns";

export function getValidChildren(children: React.ReactNode) {
  return React.Children.toArray(children).filter((child) =>
    React.isValidElement(child)
  ) as React.ReactElement[];
}

export function safeFormatDate(date: string | Date | undefined | null, dateFormat: string = "dd/MM/yyyy"): string {
    if (!date) return "-";
    const d = new Date(date);
    return isValid(d) ? format(d, dateFormat) : "-";
}

export function safeFormatDateDD_MMM_YYYY(date: string | Date | undefined | null, dateFormat: string = "dd-MMM-yyyy"): string {
    if (!date) return "-";
    const d = new Date(date);
    return isValid(d) ? format(d, dateFormat) : "-";
}
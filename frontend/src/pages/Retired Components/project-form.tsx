/**
 * ============================================================================
 * RETIRED COMPONENT - DO NOT USE
 * ============================================================================
 *
 * This file has been retired and replaced by the modular project-form structure:
 * - src/pages/projects/project-form/index.tsx (main orchestrator)
 * - src/pages/projects/project-form/schema.ts (Zod schema + types)
 * - src/pages/projects/project-form/constants.ts (wizard config, GST options)
 * - src/pages/projects/project-form/hooks/useProjectFormData.ts (data fetching)
 * - src/pages/projects/project-form/steps/*.tsx (individual step components)
 *
 * Reason for retirement:
 * - Component was 1900+ lines - too large to maintain
 * - Refactored into modular structure for better maintainability
 * - Each step is now a separate component (~150-250 lines each)
 *
 * Date retired: 2026-01-10
 * ============================================================================
 */

/*
import { FormSkeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import NewCustomer from "@/pages/customers/add-new-customer"
import { zodResolver } from "@hookform/resolvers/zod"
import { format } from "date-fns"
import { useFrappeDocTypeEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk"
import { BadgeIndianRupee, Building2, CalendarIcon, CirclePlus, Info, ListChecks, MapPin, Package, Undo2, Users, Calendar as CalendarLucide, X } from "lucide-react"
import { WizardSteps, WizardStep } from "@/components/ui/wizard-steps"
import { ReviewSection, ReviewDetail, ReviewContainer } from "@/components/ui/review-section"
import { PackagesReviewGrid } from "@/components/ui/package-review-card"
import { FormActions } from "@/components/ui/form-field-row"
import { DraftIndicator, DraftHeader } from "@/components/ui/draft-indicator"
import { DraftCancelDialog } from "@/components/ui/draft-cancel-dialog"
import { DraftResumeDialog } from "@/components/ui/draft-resume-dialog"
import { useProjectDraftManager } from "@/hooks/useProjectDraftManager"
import React, { useCallback, useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import ReactSelect from "react-select"
import * as z from "zod"
import ProjectTypeForm from "../../components/project-type-form"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../components/ui/accordion"
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../../components/ui/alert-dialog"
import { Button } from "../../components/ui/button"
import { ButtonLoading } from "../../components/ui/button-loading"
import { Calendar } from "../../components/ui/calendar"
import { Checkbox } from "../../components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "../../components/ui/form"
import { Input } from "../../components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select"
import { Separator } from "../../components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "../../components/ui/sheet"
import { useToast } from "../../components/ui/use-toast"
import { Category } from "@/types/NirmaanStack/Category"
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist"
import { WorkPackage } from "@/types/NirmaanStack/Projects"
import { Customers } from "@/types/NirmaanStack/Customers"
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes"
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"

import {MultiSelect} from "./components/multi-select"


// Wizard steps configuration with short titles for responsive display
const wizardStepsConfig: WizardStep[] = [
    { key: "projectDetails", title: "Project Details", shortTitle: "Details", icon: Building2 },
    { key: "projectAddressDetails", title: "Project Address", shortTitle: "Address", icon: MapPin },
    { key: "projectTimeline", title: "Project Timeline", shortTitle: "Timeline", icon: CalendarLucide },
    { key: "projectAssignees", title: "Project Assignees", shortTitle: "Team", icon: Users },
    { key: "packageSelection", title: "Package Selection", shortTitle: "Packages", icon: Package },
    { key: "reviewDetails", title: "Review Details", shortTitle: "Review", icon: ListChecks },
];

// 1.a Create Form Schema accordingly
const projectFormSchema = z.object({
    project_name: z
        .string(
            {
                required_error: "Must Provide Project name"
            })
        .min(6, {
            message: "Employee Name must be at least 6 characters",
        }),
    customer: z
        .string({
            required_error: "Please select associated customer"
        })
        .min(1, {
            message: "Please select associated customer"
        }),
    project_type: z
        .string()
        .optional(),
    project_value: z
        .string()
        .optional(),
    project_value_gst: z
        .string()
        .optional(),
    address_line_1: z
        .string({
            required_error: "Address Line 1 Required"
        })
        .min(1, {
            message: "Address Line 1 Required"
        }),
    address_line_2: z
        .string({
            required_error: "Address Line 2 Required"
        })
        .min(1, {
            message: "Address Line 2 Required"
        }),
    project_city: z
        .string({
            required_error: "Must provide city"
        })
        .min(1, {
            message: "Must Provide City"
        }),
    project_state: z
        .string({
            required_error: "Must provide state"
        })
        .min(1, {
            message: "Must Provide State"
        }),
    pin: z
        .string({
            required_error: "Must provide pincode"
        })
        .max(6, { message: "Pincode must be of 6 digits" })
        .min(6, { message: "Pincode must be of 6 digits" })
        .or(z.number()),
    email: z.string().email().optional().or(z.literal('')),
    phone: z
        .string()
        .max(10, { message: "Mobile number must be of 10 digits" })
        .min(10, { message: "Mobile number must be of 10 digits" })
        .optional()
        .or(z.literal('')),
    project_start_date: z
        .date({
            required_error: "Project must have a start date"
        }),
    project_end_date: z
        .date()
        .optional(),
    project_lead: z
        .string()
        .optional(),
    project_manager: z
        .string()
        .optional(),
    design_lead: z
        .string()
        .optional(),
    procurement_lead: z
        .string()
        .optional(),
    estimates_exec: z
        .string()
        .optional(),
    accountant: z
        .string()
        .optional(),
    project_work_packages: z
        .object({
            work_packages: z.array(
                z.object({
                    work_package_name: z.string(),
                    category_list: z
                        .object({
                            list: z.array(
                                z.object({
                                    name: z.string(),
                                    makes: z.array(z.object({
                                        label: z.string(),
                                        value: z.string()
                                    }))
                                })
                            )
                        })
                })
            )
        }),
    project_scopes: z
        .object({
            scopes: z.array(
                z.object({
                    scope_of_work_name: z.string(),
                    work_package: z.string()
                })
            )
        }),
    project_gst_number: z.object({
        list: z.array(z.object({
            location: z.string(),
            gst: z.string(),
        })),
    }),
    carpet_area: z.coerce.number().nonnegative().optional(),
});

type ProjectFormValues = z.infer<typeof projectFormSchema>

interface SelectOption {
    label: string;
    value: string;
}
interface wpType {
    work_package_name: string;
}

const allGstOptions = [
  { location: "Bengaluru", gst: "29ABFCS9095N1Z9" },
  { location: "Gurugram", gst: "06ABFCS9095N1ZH" },
  { location: "Noida", gst: "09ABFCS9095N1ZB" },
];

const multiSelectGstOptions = allGstOptions.map(option => ({
  label: `${option.location} (${option.gst})`,
  value: option.location,
}));

export const ProjectForm = () => {
    // ... rest of the component code ...
    // This entire file has been commented out as it's retired
    return null;
}
*/

// Export nothing - this file is retired
export {};

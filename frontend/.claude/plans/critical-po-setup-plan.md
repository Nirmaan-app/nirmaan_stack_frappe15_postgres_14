# Critical PO Categories Setup - Implementation Plan

**Status: COMPLETED** ✓

## Overview

Add Critical PO Categories setup as the third optional setup in the project creation wizard (Phase 5 - PackageSelectionStep). This follows the established pattern of Daily Progress and Design Packages setups.

## Key Difference from Existing Setups

Unlike Daily Progress and Design Packages which require zone configuration, **Critical PO Categories setup is simpler**:
- No zone configuration needed (Critical PO Tasks are project-level, not zone-level)
- Only requires category selection
- Tasks are created based on items in selected categories with deadline calculation

---

## Files to Modify

### 1. Schema (`schema.ts`)

**Add new setup type:**
```typescript
critical_po_setup: z.object({
  enabled: z.boolean().default(false),
  selected_categories: z.array(z.string()).default([]),
}).optional()
```

**Add to default values:**
```typescript
critical_po_setup: {
  enabled: false,
  selected_categories: [],
}
```

**Add type export:**
```typescript
export type CriticalPOSetup = z.infer<typeof projectFormSchema>['critical_po_setup'];
```

---

### 2. Data Fetching Hook (`hooks/useProjectFormData.ts`)

**Add fetching of Critical PO Categories:**
```typescript
const { data: criticalPOCategories, isLoading: isCriticalPOCategoriesLoading } = useFrappeGetDocList<{
  name: string;
  category_name: string;
}>("Critical PO Category", {
  fields: ["name", "category_name"],
  limit: 0,
});
```

**Return in hook:**
```typescript
return {
  // ... existing
  criticalPOCategories,
  isCriticalPOCategoriesLoading,
};
```

---

### 3. PackageSelectionStep (`steps/PackageSelectionStep.tsx`)

**Add Section 4: Critical PO Categories Setup** (after Design Packages section)

**Structure:**
```
Section 4: Critical PO Categories
├── Enable/Disable Toggle (Checkbox)
└── (When enabled):
    └── Category Selection Grid
        ├── Grid layout (2-3 columns)
        ├── Each category as selectable card/button
        └── Toggle selection on click
```

**Handlers to add:**
- `handleCriticalPOEnabledChange(checked: boolean)` - Toggle setup
- `handleCriticalPOCategoryToggle(categoryName: string)` - Toggle category selection
- `isCriticalPOCategorySelected(categoryName: string)` - Check if selected

**Reset behavior when disabled:**
```typescript
if (!checked) {
  form.setValue("critical_po_setup.selected_categories", []);
}
```

---

### 4. ReviewStep (`steps/ReviewStep.tsx`)

**Add conditional display:**
```tsx
{/* Critical PO Categories Section (only show if enabled) */}
{form.getValues("critical_po_setup")?.enabled && (
  <div className="space-y-3">
    <h4 className="text-sm font-medium">Critical PO Categories</h4>
    <div className="flex flex-wrap gap-2">
      {form.getValues("critical_po_setup")?.selected_categories?.map((cat) => (
        <Badge key={cat} variant="secondary">{cat}</Badge>
      ))}
    </div>
  </div>
)}
```

---

### 5. Project Creation Dialog (`components/ui/project-creation-dialog.tsx`)

**Update CreationStage type:**
```typescript
export type CreationStage =
  | "idle"
  | "creating_project"
  | "assigning_users"
  | "setting_up_progress"
  | "setting_up_design_tracker"
  | "setting_up_critical_po"  // NEW
  | "complete"
  | "error";
```

**Add prop:**
```typescript
interface ProjectCreationDialogProps {
  // ... existing
  criticalPOSetupEnabled?: boolean;
}
```

**Add stage item (after design tracker):**
```tsx
{criticalPOSetupEnabled && (
  <StageItem
    icon={<ListChecks className="h-4 w-4" />}
    label="Setting up Critical PO Tasks"
    status={getStageStatus("setting_up_critical_po")}
  />
)}
```

---

### 6. ProjectForm Index (`index.tsx`)

**Add state:**
```typescript
const [criticalPOSetupEnabled, setCriticalPOSetupEnabled] = useState(false);
```

**Update handleSubmit - Add Step 5 (after design tracker setup):**

```typescript
// Step 5: Setup Critical PO Tasks (if enabled)
const criticalPOSetup = data.critical_po_setup;
if (criticalPOSetup?.enabled && criticalPOSetup.selected_categories.length > 0) {
  setCriticalPOSetupEnabled(true);
  setCreationStage("setting_up_critical_po");

  try {
    // Fetch items for selected categories
    const itemsResponse = await call({
      method: "frappe.client.get_list",
      params: {
        doctype: "Critical PO Items",
        filters: [["critical_po_category", "in", criticalPOSetup.selected_categories]],
        fields: ["name", "item_name", "sub_category", "critical_po_category", "release_timeline_offset"],
        limit_page_length: 0,
      },
    });

    const items = itemsResponse?.message || [];
    const projectStartDate = data.project_start_date;

    // Create Critical PO Task for each item
    for (const item of items) {
      const offsetDays = item.release_timeline_offset || 0;
      const startDate = new Date(projectStartDate);
      startDate.setDate(startDate.getDate() + offsetDays);
      const poReleaseDate = startDate.toISOString().split('T')[0];

      await createDoc("Critical PO Tasks", {
        project: projectName,
        project_name: projectName,
        critical_po_category: item.critical_po_category,
        item_name: item.item_name,
        sub_category: item.sub_category || "",
        po_release_date: poReleaseDate,
        status: "Not Released",
        associated_pos: JSON.stringify({ pos: [] }),
        revised_date: null,
        remarks: "",
      });
    }

    toast({
      title: "Critical PO Tasks Created",
      description: `Created ${items.length} Critical PO Tasks for the project.`,
    });
  } catch (criticalPOError) {
    console.error("Critical PO setup failed:", criticalPOError);
    toast({
      title: "Warning",
      description: "Project created but Critical PO setup failed. You can configure this later.",
      variant: "warning",
    });
  }
}
```

**Update dialog props:**
```tsx
<ProjectCreationDialog
  // ... existing props
  criticalPOSetupEnabled={criticalPOSetupEnabled}
/>
```

---

### 7. No Changes Needed

- **`useProjectDraftStore.ts`** - Automatically supports new form fields via existing `formValues` structure
- **`useProjectDraftManager.ts`** - Already handles form-to-draft conversion generically
- **`constants.ts`** - Steps remain the same (Critical PO is within PackageSelectionStep)

---

## UI Design

### PackageSelectionStep - Section 4

```
┌─────────────────────────────────────────────────────────────┐
│ ☑ Setup Critical PO Categories                              │
│   Track critical purchase order deadlines based on          │
│   project start date                                        │
└─────────────────────────────────────────────────────────────┘

(When enabled):
┌─────────────────────────────────────────────────────────────┐
│ Select Categories                                           │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │ Structural      │ │ MEP             │ │ Finishes        │ │
│ │ Steel           │ │                 │ │                 │ │
│ │ [Selected ✓]    │ │ [ ]             │ │ [Selected ✓]    │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │ HVAC            │ │ Electrical      │ │ Fire Safety     │ │
│ │ [ ]             │ │ [ ]             │ │ [ ]             │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│                                                             │
│ 2 categories selected                                       │
└─────────────────────────────────────────────────────────────┘
```

### ReviewStep Display

```
Critical PO Categories
├── Structural Steel
├── Finishes
└── (2 categories - tasks will be created with deadlines based on project start date)
```

### Creation Dialog Stage

```
✓ Creating project
✓ Assigning team members (5)
✓ Setting up Daily Progress
✓ Setting up Design Tracker
⟳ Setting up Critical PO Tasks    ← NEW
○ Complete
```

---

## Validation

### Before Enabling
- **Soft requirement**: Show info that project start date will be used to calculate PO release deadlines
- No blocking validation - if start date is missing, deadlines will be calculated when start date is set later

### On Submit
- Only create tasks if categories are selected (`selected_categories.length > 0`)
- Skip silently if no categories selected even if enabled=true

---

## Task Order in Submission Flow

1. `creating_project` - Create project + address
2. `assigning_users` - Create User Permissions
3. `setting_up_progress` - Update project with Daily Progress config
4. `setting_up_design_tracker` - Create Design Tracker document
5. `setting_up_critical_po` - Create Critical PO Tasks **← NEW**
6. `complete` - Success

---

## Error Handling

Following the established pattern:
- Non-fatal errors (project still created successfully)
- Toast warning if setup fails
- User can configure later from Critical PO Tasks tab

---

## Implementation Order

1. Update `schema.ts` - Add types and defaults
2. Update `useProjectFormData.ts` - Add data fetching
3. Update `PackageSelectionStep.tsx` - Add UI section
4. Update `ReviewStep.tsx` - Add conditional display
5. Update `project-creation-dialog.tsx` - Add stage
6. Update `index.tsx` - Add submission logic

---

## Testing Checklist

- [ ] Toggle Critical PO setup on/off
- [ ] Select/deselect categories
- [ ] Verify draft saves categories correctly
- [ ] Resume draft with Critical PO setup
- [ ] ReviewStep shows selected categories
- [ ] Creation dialog shows stage
- [ ] Tasks created with correct deadlines
- [ ] Verify tasks appear in Critical PO Tasks tab after creation
- [ ] Error handling when categories exist but no items
- [ ] Verify no duplicate task creation on retry

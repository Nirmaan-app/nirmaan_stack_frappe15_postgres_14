# Feature Development Examples

This document provides practical examples of how to add new features to the Nirmaan Stack. These examples demonstrate the recommended file structure and coding patterns for common development tasks.

## Table of Contents

1. [Adding a New Frontend Page](#adding-a-new-frontend-page)
2. [Creating a New DocType](#creating-a-new-doctype)
3. [Adding a New API Endpoint](#adding-a-new-api-endpoint)
4. [Implementing a New Workflow](#implementing-a-new-workflow)
5. [Adding a New Form Component](#adding-a-new-form-component)
6. [Creating a Custom Hook](#creating-a-custom-hook)
7. [Implementing a New Report](#implementing-a-new-report)

## Adding a New Frontend Page

This example demonstrates how to add a new page for managing equipment in the Nirmaan Stack frontend.

### Step 1: Create the Page Component

Create a new file at `frontend/src/pages/Equipment/equipment-list.tsx`:

```tsx
import React from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Equipment as EquipmentType } from '@/types/NirmaanStack/Equipment';

const EquipmentList: React.FC = () => {
  const navigate = useNavigate();
  
  const { data: equipmentList, isLoading, error } = useFrappeGetDocList<EquipmentType>('Equipment', {
    fields: ['*'],
    limit: 1000,
    orderBy: { field: 'creation', order: 'desc' }
  });
  
  const handleAddEquipment = () => {
    navigate('/equipment/new');
  };
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading equipment: {error.message}</div>;
  
  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Equipment</h2>
        <Button onClick={handleAddEquipment} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Equipment
        </Button>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Equipment List</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Last Maintenance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipmentList?.map((equipment) => (
                <TableRow 
                  key={equipment.name} 
                  className="cursor-pointer"
                  onClick={() => navigate(`/equipment/${equipment.name}`)}
                >
                  <TableCell>{equipment.equipment_name}</TableCell>
                  <TableCell>{equipment.equipment_type}</TableCell>
                  <TableCell>{equipment.status}</TableCell>
                  <TableCell>{equipment.location}</TableCell>
                  <TableCell>{equipment.last_maintenance_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default EquipmentList;
### Step 2: Create the Type Definition

Create a new file at `frontend/src/types/NirmaanStack/Equipment.ts`:

```typescript
export interface Equipment {
  name: string;
  equipment_name: string;
  equipment_type: string;
  status: 'Available' | 'In Use' | 'Under Maintenance' | 'Retired';
  location: string;
  last_maintenance_date: string;
  next_maintenance_date: string;
  purchase_date: string;
  purchase_cost: number;
  current_value: number;
  notes: string;
  project?: string;
  assigned_to?: string;
}
```

### Step 3: Add the Route

Update the router configuration in your main router file to include the new page:

```tsx
import EquipmentList from '@/pages/Equipment/equipment-list';
import EquipmentDetail from '@/pages/Equipment/equipment-detail';
import NewEquipment from '@/pages/Equipment/new-equipment';

// In your router configuration
{
  path: '/equipment',
  element: <EquipmentList />
},
{
  path: '/equipment/new',
  element: <NewEquipment />
},
{
  path: '/equipment/:equipmentId',
  element: <EquipmentDetail />
}
```

## Creating a New DocType

This example demonstrates how to create a new DocType for equipment management in the Nirmaan Stack backend.

### Step 1: Create the DocType JSON

Create a new directory at `nirmaan_stack/nirmaan_stack/doctype/equipment/` and add a file named `equipment.json`:

```json
{
  "actions": [],
  "allow_rename": 1,
  "autoname": "format:EQP-{####}",
  "creation": "2023-05-28 10:00:00.000000",
  "doctype": "DocType",
  "engine": "InnoDB",
  "field_order": [
    "equipment_name",
    "equipment_type",
    "status_section",
    "status",
    "location",
    "project",
    "assigned_to",
    "maintenance_section",
    "last_maintenance_date",
    "next_maintenance_date",
    "maintenance_schedule",
    "financial_section",
    "purchase_date",
    "purchase_cost",
    "current_value",
    "depreciation_method",
    "notes_section",
    "notes"
  ],
  "fields": [
    {
      "fieldname": "equipment_name",
      "fieldtype": "Data",
      "label": "Equipment Name",
      "reqd": 1
    },
    {
      "fieldname": "equipment_type",
      "fieldtype": "Link",
      "label": "Equipment Type",
      "options": "Equipment Type",
      "reqd": 1
    },
    {
      "fieldname": "status_section",
      "fieldtype": "Section Break",
      "label": "Status"
    },
    {
      "fieldname": "status",
      "fieldtype": "Select",
      "label": "Status",
      "options": "Available\nIn Use\nUnder Maintenance\nRetired",
      "default": "Available"
    },
    {
      "fieldname": "location",
      "fieldtype": "Data",
      "label": "Location"
    },
    {
      "fieldname": "project",
      "fieldtype": "Link",
      "label": "Project",
      "options": "Projects"
    },
    {
      "fieldname": "assigned_to",
      "fieldtype": "Link",
      "label": "Assigned To",
      "options": "Nirmaan Users"
    },
    {
      "fieldname": "maintenance_section",
      "fieldtype": "Section Break",
      "label": "Maintenance"
    },
    {
      "fieldname": "last_maintenance_date",
      "fieldtype": "Date",
      "label": "Last Maintenance Date"
    },
    {
      "fieldname": "next_maintenance_date",
      "fieldtype": "Date",
      "label": "Next Maintenance Date"
    },
    {
      "fieldname": "maintenance_schedule",
      "fieldtype": "Table",
      "label": "Maintenance Schedule",
      "options": "Equipment Maintenance Schedule"
    },
    {
      "fieldname": "financial_section",
      "fieldtype": "Section Break",
      "label": "Financial"
    },
    {
      "fieldname": "purchase_date",
      "fieldtype": "Date",
      "label": "Purchase Date"
    },
    {
      "fieldname": "purchase_cost",
      "fieldtype": "Currency",
      "label": "Purchase Cost"
    },
    {
      "fieldname": "current_value",
      "fieldtype": "Currency",
      "label": "Current Value"
    },
    {
      "fieldname": "depreciation_method",
      "fieldtype": "Select",
      "label": "Depreciation Method",
      "options": "Straight Line\nDouble Declining Balance\nNone"
    },
    {
      "fieldname": "notes_section",
      "fieldtype": "Section Break",
      "label": "Notes"
    },
    {
      "fieldname": "notes",
      "fieldtype": "Text Editor",
      "label": "Notes"
    }
  ],
  "links": [],
  "modified": "2023-05-28 10:00:00.000000",
  "modified_by": "Administrator",
  "module": "Nirmaan Stack",
  "name": "Equipment",
  "naming_rule": "Expression",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1,
      "delete": 1,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "System Manager",
      "share": 1,
      "write": 1
    },
    {
      "create": 1,
      "delete": 0,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "Nirmaan Project Manager",
      "share": 1,
      "write": 1
    },
    {
      "create": 0,
      "delete": 0,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "Nirmaan Site Engineer",
      "share": 0,
      "write": 0
    }
  ],
  "sort_field": "modified",
  "sort_order": "DESC",
  "states": [],
  "track_changes": 1
}
```
### Step 2: Create the Python Controller

Create a file at `nirmaan_stack/nirmaan_stack/doctype/equipment/equipment.py`:

```python
# Copyright (c) 2023, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from datetime import datetime, timedelta

class Equipment(Document):
    def validate(self):
        self.validate_dates()
        self.calculate_current_value()
    
    def validate_dates(self):
        """Validate that dates are in logical order"""
        if self.purchase_date and self.last_maintenance_date:
            if frappe.utils.getdate(self.last_maintenance_date) < frappe.utils.getdate(self.purchase_date):
                frappe.throw("Last maintenance date cannot be before purchase date")
        
        if self.next_maintenance_date and self.last_maintenance_date:
            if frappe.utils.getdate(self.next_maintenance_date) < frappe.utils.getdate(self.last_maintenance_date):
                frappe.throw("Next maintenance date cannot be before last maintenance date")
    
    def calculate_current_value(self):
        """Calculate current value based on depreciation method"""
        if not self.purchase_date or not self.purchase_cost:
            return
        
        purchase_date = frappe.utils.getdate(self.purchase_date)
        today = frappe.utils.getdate(frappe.utils.nowdate())
        age_years = (today - purchase_date).days / 365.0
        
        if self.depreciation_method == "Straight Line":
            # Assume 10-year useful life with 10% salvage value
            useful_life = 10
            salvage_value = self.purchase_cost * 0.1
            
            if age_years >= useful_life:
                self.current_value = salvage_value
            else:
                annual_depreciation = (self.purchase_cost - salvage_value) / useful_life
                self.current_value = self.purchase_cost - (annual_depreciation * age_years)
        
        elif self.depreciation_method == "Double Declining Balance":
            # Assume 10-year useful life
            useful_life = 10
            rate = 2 / useful_life
            
            current_value = self.purchase_cost
            for _ in range(int(age_years)):
                current_value = current_value * (1 - rate)
            
            # For partial year
            partial_year = age_years - int(age_years)
            if partial_year > 0:
                current_value = current_value * (1 - (rate * partial_year))
            
            self.current_value = current_value
        
        else:  # No depreciation
            self.current_value = self.purchase_cost
```

### Step 3: Register Document Events in hooks.py

Update `nirmaan_stack/hooks.py` to include document events for the new DocType:

```python
doc_events = {
    # ... existing doc events ...
    "Equipment": {
        "after_insert": "nirmaan_stack.integrations.controllers.equipment.after_insert",
        "on_update": "nirmaan_stack.integrations.controllers.equipment.on_update",
        "on_trash": [
            "nirmaan_stack.integrations.controllers.equipment.on_trash",
            "nirmaan_stack.integrations.controllers.delete_doc_versions.generate_versions",
        ]
    }
}
```

### Step 4: Create the Controller

Create a file at `nirmaan_stack/integrations/controllers/equipment.py`:

```python
import frappe
from frappe import _

def after_insert(doc, method):
    """Actions to perform after equipment is created"""
    create_maintenance_schedule(doc)
    notify_project_manager(doc)

def on_update(doc, method):
    """Actions to perform when equipment is updated"""
    update_maintenance_schedule(doc)
    check_status_change(doc)

def on_trash(doc, method):
    """Actions to perform when equipment is deleted"""
    cleanup_maintenance_records(doc)

def create_maintenance_schedule(doc):
    """Create initial maintenance schedule based on equipment type"""
    equipment_type = frappe.get_doc("Equipment Type", doc.equipment_type)
    
    if not equipment_type.maintenance_frequency_days:
        return
    
    # Create first maintenance entry if not already scheduled
    if not doc.maintenance_schedule:
        schedule_entry = {
            "scheduled_date": frappe.utils.add_days(frappe.utils.today(), equipment_type.maintenance_frequency_days),
            "maintenance_type": "Regular",
            "status": "Scheduled"
        }
        
        doc.append("maintenance_schedule", schedule_entry)
        doc.next_maintenance_date = schedule_entry["scheduled_date"]
        doc.save()

def update_maintenance_schedule(doc):
    """Update maintenance schedule based on changes"""
    # Implementation details here
    pass

def check_status_change(doc):
    """Check if status has changed and take appropriate actions"""
    if doc.has_value_changed("status"):
        if doc.status == "Under Maintenance":
            create_maintenance_record(doc)
        elif doc.status == "In Use" and doc.has_value_changed("project"):
            log_project_assignment(doc)

def create_maintenance_record(doc):
    """Create a maintenance record when equipment goes under maintenance"""
    # Implementation details here
    pass

def log_project_assignment(doc):
    """Log when equipment is assigned to a project"""
    # Implementation details here
    pass

def cleanup_maintenance_records(doc):
    """Clean up related maintenance records when equipment is deleted"""
    # Implementation details here
    pass

def notify_project_manager(doc):
    """Notify project manager about new equipment"""
    if doc.project:
        project = frappe.get_doc("Projects", doc.project)
        if project.project_manager:
            frappe.sendmail(
                recipients=[frappe.db.get_value("Nirmaan Users", project.project_manager, "user")],
                subject=f"New Equipment Added to {project.project_name}",
                message=f"""
                    <p>Dear Project Manager,</p>
                    <p>New equipment has been added to your project {project.project_name}:</p>
                    <ul>
                        <li><strong>Equipment:</strong> {doc.equipment_name}</li>
                        <li><strong>Type:</strong> {doc.equipment_type}</li>
                        <li><strong>Location:</strong> {doc.location}</li>
                    </ul>
                    <p>Please review the details in the system.</p>
                """
            )
```

## Adding a New API Endpoint

This example demonstrates how to add a new API endpoint for equipment management.

### Step 1: Create the API File

Create a file at `nirmaan_stack/api/equipment.py`:

```python
import frappe
from frappe import _
from frappe.utils import cint

@frappe.whitelist()
def get_equipment_list(project=None, status=None, equipment_type=None, limit=20, start=0):
    """
    Get a list of equipment with optional filters
    
    Args:
        project (str, optional): Filter by project
        status (str, optional): Filter by status
        equipment_type (str, optional): Filter by equipment type
        limit (int, optional): Number of records to return
        start (int, optional): Starting offset
        
    Returns:
        dict: Dictionary with equipment list and total count
    """
    filters = {}
    
    if project:
        filters["project"] = project
    
    if status:
        filters["status"] = status
    
    if equipment_type:
        filters["equipment_type"] = equipment_type
    
    equipment_list = frappe.get_list(
        "Equipment",
        filters=filters,
        fields=["name", "equipment_name", "equipment_type", "status", "location", 
                "project", "assigned_to", "last_maintenance_date", "next_maintenance_date"],
        limit=cint(limit),
        start=cint(start),
        order_by="creation desc"
    )
    
    total_count = frappe.db.count("Equipment", filters=filters)
    
    return {
        "equipment": equipment_list,
        "total": total_count
    }

@frappe.whitelist()
def get_equipment_details(equipment_name):
    """
    Get detailed information about a specific equipment
    
    Args:
        equipment_name (str): Name of the equipment
        
    Returns:
        dict: Equipment details
    """
    equipment = frappe.get_doc("Equipment", equipment_name)
    
    # Get maintenance history
    maintenance_history = frappe.get_list(
        "Equipment Maintenance",
        filters={"equipment": equipment_name},
        fields=["name", "maintenance_date", "maintenance_type", "performed_by", "cost", "notes"],
        order_by="maintenance_date desc"
    )
    
    # Get usage history
    usage_history = frappe.get_list(
        "Equipment Usage",
        filters={"equipment": equipment_name},
        fields=["name", "project", "start_date", "end_date", "assigned_to", "notes"],
        order_by="start_date desc"
    )
    
    return {
        "equipment": equipment,
        "maintenance_history": maintenance_history,
        "usage_history": usage_history
    }

@frappe.whitelist()
def update_equipment_status(equipment_name, status, notes=None):
    """
    Update the status of an equipment
    
    Args:
        equipment_name (str): Name of the equipment
        status (str): New status
        notes (str, optional): Notes about the status change
        
    Returns:
        dict: Success message
    """
    if not frappe.has_permission("Equipment", "write"):
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    
    equipment = frappe.get_doc("Equipment", equipment_name)
    old_status = equipment.status
    
    equipment.status = status
    
    if notes:
        equipment.add_comment("Comment", notes)
    
    equipment.save()
    
    # Log status change
    frappe.get_doc({
        "doctype": "Equipment Status Log",
        "equipment": equipment_name,
        "old_status": old_status,
        "new_status": status,
        "changed_by": frappe.session.user,
        "notes": notes or ""
    }).insert(ignore_permissions=True)
    
    return {
        "success": True,
        "message": _("Equipment status updated successfully")
    }
### Step 2: Create a Custom Hook for the Frontend

Create a file at `frontend/src/hooks/useEquipment.ts`:

```typescript
import { useFrappeGetCall, useFrappePostCall } from 'frappe-react-sdk';
import { Equipment } from '@/types/NirmaanStack/Equipment';

interface EquipmentListResponse {
  equipment: Equipment[];
  total: number;
}

interface EquipmentDetailsResponse {
  equipment: Equipment;
  maintenance_history: any[];
  usage_history: any[];
}

export function useEquipmentList(
  project?: string,
  status?: string,
  equipmentType?: string,
  limit: number = 20,
  start: number = 0
) {
  const { data, error, isLoading, mutate } = useFrappeGetCall<EquipmentListResponse>(
    'nirmaan_stack.api.equipment.get_equipment_list',
    {
      project,
      status,
      equipment_type: equipmentType,
      limit,
      start
    }
  );
  
  return {
    equipmentList: data?.message?.equipment || [],
    totalCount: data?.message?.total || 0,
    isLoading,
    error,
    mutate
  };
}

export function useEquipmentDetails(equipmentName: string) {
  const { data, error, isLoading, mutate } = useFrappeGetCall<EquipmentDetailsResponse>(
    'nirmaan_stack.api.equipment.get_equipment_details',
    {
      equipment_name: equipmentName
    },
    equipmentName ? `equipment-details-${equipmentName}` : null
  );
  
  return {
    equipment: data?.message?.equipment,
    maintenanceHistory: data?.message?.maintenance_history || [],
    usageHistory: data?.message?.usage_history || [],
    isLoading,
    error,
    mutate
  };
}

export function useUpdateEquipmentStatus() {
  const { call, error, isLoading } = useFrappePostCall('nirmaan_stack.api.equipment.update_equipment_status');
  
  const updateStatus = async (equipmentName: string, status: string, notes?: string) => {
    return call({
      equipment_name: equipmentName,
      status,
      notes
    });
  };
  
  return {
    updateStatus,
    error,
    isLoading
  };
}
```

## Implementing a New Workflow

This example demonstrates how to implement a workflow for equipment maintenance requests.

### Step 1: Create the DocType for Maintenance Requests

Create a new DocType for maintenance requests with appropriate fields:

```json
{
  "actions": [],
  "allow_rename": 0,
  "autoname": "format:EQMR-{####}",
  "creation": "2023-05-28 10:00:00.000000",
  "doctype": "DocType",
  "engine": "InnoDB",
  "field_order": [
    "equipment",
    "equipment_name",
    "maintenance_type",
    "priority",
    "description_section",
    "description",
    "status_section",
    "status",
    "assigned_to",
    "scheduled_date",
    "completion_date",
    "cost",
    "notes"
  ],
  "fields": [
    {
      "fieldname": "equipment",
      "fieldtype": "Link",
      "label": "Equipment",
      "options": "Equipment",
      "reqd": 1
    },
    {
      "fieldname": "equipment_name",
      "fieldtype": "Data",
      "label": "Equipment Name",
      "fetch_from": "equipment.equipment_name",
      "read_only": 1
    },
    {
      "fieldname": "maintenance_type",
      "fieldtype": "Select",
      "label": "Maintenance Type",
      "options": "Preventive\nCorrective\nEmergency",
      "reqd": 1
    },
    {
      "fieldname": "priority",
      "fieldtype": "Select",
      "label": "Priority",
      "options": "Low\nMedium\nHigh\nCritical",
      "default": "Medium"
    },
    {
      "fieldname": "description_section",
      "fieldtype": "Section Break",
      "label": "Description"
    },
    {
      "fieldname": "description",
      "fieldtype": "Text Editor",
      "label": "Description",
      "reqd": 1
    },
    {
      "fieldname": "status_section",
      "fieldtype": "Section Break",
      "label": "Status"
    },
    {
      "fieldname": "status",
      "fieldtype": "Select",
      "label": "Status",
      "options": "Draft\nSubmitted\nApproved\nIn Progress\nOn Hold\nCompleted\nRejected",
      "default": "Draft"
    },
    {
      "fieldname": "assigned_to",
      "fieldtype": "Link",
      "label": "Assigned To",
      "options": "Nirmaan Users"
    },
    {
      "fieldname": "scheduled_date",
      "fieldtype": "Date",
      "label": "Scheduled Date"
    },
    {
      "fieldname": "completion_date",
      "fieldtype": "Date",
      "label": "Completion Date"
    },
    {
      "fieldname": "cost",
      "fieldtype": "Currency",
      "label": "Cost"
    },
    {
      "fieldname": "notes",
      "fieldtype": "Text Editor",
      "label": "Notes"
    }
  ],
  "modified": "2023-05-28 10:00:00.000000",
  "modified_by": "Administrator",
  "module": "Nirmaan Stack",
  "name": "Equipment Maintenance Request",
  "naming_rule": "Expression",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1,
      "delete": 1,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "System Manager",
      "share": 1,
      "write": 1
    }
  ],
  "sort_field": "modified",
  "sort_order": "DESC",
  "states": [],
  "track_changes": 1
}
```

### Step 2: Define the Workflow in Frappe

Create a workflow in Frappe with the following states and transitions:

1. Go to Desk > Workflow > New
2. Set the following values:
   - Workflow Name: Equipment Maintenance Request Workflow
   - Document Type: Equipment Maintenance Request
   - Is Active: Yes

3. Add the following states:
   - Draft (Doc Status: 0)
   - Submitted (Doc Status: 1)
   - Approved (Doc Status: 1)
   - In Progress (Doc Status: 1)
   - On Hold (Doc Status: 1)
   - Completed (Doc Status: 1)
   - Rejected (Doc Status: 0)

4. Add the following transitions:
   - Draft to Submitted (Role: Nirmaan Site Engineer)
   - Submitted to Approved (Role: Nirmaan Project Manager)
   - Submitted to Rejected (Role: Nirmaan Project Manager)
   - Approved to In Progress (Role: Nirmaan Maintenance Supervisor)
   - In Progress to On Hold (Role: Nirmaan Maintenance Supervisor)
   - On Hold to In Progress (Role: Nirmaan Maintenance Supervisor)
   - In Progress to Completed (Role: Nirmaan Maintenance Supervisor)
   - Rejected to Draft (Role: Nirmaan Site Engineer)

### Step 3: Create a Controller for the Workflow

Create a file at `nirmaan_stack/integrations/controllers/equipment_maintenance_request.py`:

```python
import frappe
from frappe import _

def on_update(doc, method):
    """Actions to perform when maintenance request is updated"""
    check_status_change(doc)
    update_equipment_status(doc)

def check_status_change(doc):
    """Check if status has changed and take appropriate actions"""
    if doc.has_value_changed("status"):
        # Log status change
        frappe.get_doc({
            "doctype": "Equipment Maintenance Log",
            "maintenance_request": doc.name,
            "equipment": doc.equipment,
            "old_status": doc.get_db_value("status") or "Draft",
            "new_status": doc.status,
            "changed_by": frappe.session.user,
            "notes": f"Status changed from {doc.get_db_value('status') or 'Draft'} to {doc.status}"
        }).insert(ignore_permissions=True)
        
        # Send notifications
        if doc.status == "Approved":
            notify_maintenance_supervisor(doc)
        elif doc.status == "Completed":
            notify_completion(doc)
        elif doc.status == "Rejected":
            notify_rejection(doc)

def update_equipment_status(doc):
    """Update equipment status based on maintenance request status"""
    if doc.status == "In Progress":
        equipment = frappe.get_doc("Equipment", doc.equipment)
        if equipment.status != "Under Maintenance":
            equipment.status = "Under Maintenance"
            equipment.save()
    elif doc.status == "Completed":
        equipment = frappe.get_doc("Equipment", doc.equipment)
        if equipment.status == "Under Maintenance":
            equipment.status = "Available"
            equipment.last_maintenance_date = doc.completion_date
            equipment.save()

def notify_maintenance_supervisor(doc):
    """Notify maintenance supervisor about approved request"""
    supervisors = frappe.get_list(
        "Nirmaan Users",
        filters={"role": "Nirmaan Maintenance Supervisor"},
        fields=["user"]
    )
    
    if supervisors:
        frappe.sendmail(
            recipients=[user.user for user in supervisors],
            subject=f"Maintenance Request {doc.name} Approved",
            message=f"""
                <p>Dear Maintenance Supervisor,</p>
                <p>A maintenance request has been approved and requires your attention:</p>
                <ul>
                    <li><strong>Request:</strong> {doc.name}</li>
                    <li><strong>Equipment:</strong> {doc.equipment_name}</li>
                    <li><strong>Type:</strong> {doc.maintenance_type}</li>
                    <li><strong>Priority:</strong> {doc.priority}</li>
                </ul>
                <p>Please assign this request to a maintenance technician.</p>
            """
        )

def notify_completion(doc):
    """Notify relevant parties about completed maintenance"""
    # Implementation details here
    pass

def notify_rejection(doc):
    """Notify requester about rejected maintenance request"""
    # Implementation details here
    pass
```

### Step 4: Register Document Events in hooks.py

Update `nirmaan_stack/hooks.py` to include document events for the new DocType:

```python
doc_events = {
    # ... existing doc events ...
    "Equipment Maintenance Request": {
        "on_update": "nirmaan_stack.integrations.controllers.equipment_maintenance_request.on_update"
    }
}
```

## Adding a New Form Component

This example demonstrates how to add a new reusable form component.

### Step 1: Create the Component

Create a file at `frontend/src/components/forms/LocationSelector.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { useFrappeGetCall } from 'frappe-react-sdk';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
=> handleFilterChange('maintenance_type', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Types</SelectItem>
                  <SelectItem value="Preventive">Preventive</SelectItem>
                  <SelectItem value="Corrective">Corrective</SelectItem>
                  <SelectItem value="Emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="from_date">From Date</Label>
              <Input
                id="from_date"
                type="date"
                value={filters.from_date}
                onChange={(e) => handleFilterChange('from_date', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to_date">To Date</Label>
              <Input
                id="to_date"
                type="date"
                value={filters.to_date}
                onChange={(e) => handleFilterChange('to_date', e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleApplyFilters}>Apply Filters</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <p>Loading report data...</p>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-red-500">Error loading report: {error.message}</p>
        </div>
      ) : data?.data?.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64">
          <FileText className="h-12 w-12 text-gray-400" />
          <p className="mt-2 text-gray-500">No maintenance records found</p>
        </div>
      ) : (
        <>
          {data?.chart_data && (
            <Card>
              <CardHeader>
                <CardTitle>Maintenance Types Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  {/* Chart component would go here */}
                  <p className="text-center text-gray-500">Chart visualization</p>
                </div>
              </CardContent>
            </Card>
          )}
          
          <Card>
            <CardHeader>
              <CardTitle>Maintenance Records</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Equipment ID</TableHead>
                      <TableHead>Equipment Name</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Performed By</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.data?.map((record, index) => (
                      <TableRow key={index}>
                        <TableCell>{record.equipment}</TableCell>
                        <TableCell>{record.equipment_name}</TableCell>
                        <TableCell>{format(new Date(record.maintenance_date), 'dd/MM/yyyy')}</TableCell>
                        <TableCell>{record.maintenance_type}</TableCell>
                        <TableCell>{record.performed_by}</TableCell>
                        <TableCell>{record.cost}</TableCell>
                        <TableCell>{record.status}</TableCell>
                        <TableCell className="max-w-xs truncate">{record.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default EquipmentMaintenanceReport;
```

### Step 4: Add the Report to the Router

Update the router configuration to include the new report page:

```tsx
import EquipmentMaintenanceReport from '@/pages/reports/EquipmentMaintenanceReport';

// In your router configuration
{
  path: '/reports/equipment-maintenance',
  element: <EquipmentMaintenanceReport />
}
```

This completes the examples of how to add new features to the Nirmaan Stack. These examples demonstrate the recommended file structure and coding patterns for common development tasks.
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Check, ChevronsUpDown, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationSelectorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  projectId?: string;
}

interface Location {
  id: string;
  name: string;
  type: string;
}

export function LocationSelector({
  value,
  onChange,
  label = 'Location',
  placeholder = 'Select location',
  required = false,
  className,
  projectId
}: LocationSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const { data, error, isLoading } = useFrappeGetCall<{ locations: Location[] }>(
    'nirmaan_stack.api.locations.get_locations',
    {
      project: projectId,
      search_term: searchTerm
    }
  );
  
  const locations = data?.message?.locations || [];
  
  const handleSelect = (locationId: string) => {
    onChange(locationId);
    setOpen(false);
  };
  
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor="location">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {value ? locations.find((location) => location.id === value)?.name || value : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <Command>
            <CommandInput 
              placeholder="Search locations..." 
              onValueChange={setSearchTerm}
            />
            {isLoading ? (
              <div className="py-6 text-center text-sm">Loading...</div>
            ) : error ? (
              <div className="py-6 text-center text-sm text-red-500">Error loading locations</div>
            ) : (
              <>
                <CommandEmpty>No locations found.</CommandEmpty>
                <CommandGroup>
                  {locations.map((location) => (
                    <CommandItem
                      key={location.id}
                      value={location.id}
                      onSelect={handleSelect}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === location.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{location.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">({location.type})</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

### Step 2: Use the Component

Use the component in a form:

```tsx
import { LocationSelector } from '@/components/forms/LocationSelector';

// In your form component
const [location, setLocation] = useState('');

// In your JSX
<LocationSelector
  value={location}
  onChange={setLocation}
  required
  projectId={projectId}
/>
```

## Creating a Custom Hook

This example demonstrates how to create a custom hook for managing pagination.

### Step 1: Create the Hook

Create a file at `frontend/src/hooks/usePagination.ts`:

```typescript
import { useState, useCallback, useMemo } from 'react';

interface UsePaginationProps {
  totalItems: number;
  initialPage?: number;
  itemsPerPage?: number;
  maxPageButtons?: number;
}

interface UsePaginationReturn {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  startIndex: number;
  endIndex: number;
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setPageSize: (size: number) => void;
  pageButtons: number[];
  canNextPage: boolean;
  canPrevPage: boolean;
}

export function usePagination({
  totalItems,
  initialPage = 1,
  itemsPerPage = 10,
  maxPageButtons = 5
}: UsePaginationProps): UsePaginationReturn {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(itemsPerPage);
  
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  
  // Ensure current page is within valid range
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  if (safePage !== currentPage) {
    setCurrentPage(safePage);
  }
  
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize - 1, totalItems - 1);
  
  const setPage = useCallback((page: number) => {
    setCurrentPage(Math.min(Math.max(1, page), totalPages));
  }, [totalPages]);
  
  const nextPage = useCallback(() => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  }, [totalPages]);
  
  const prevPage = useCallback(() => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  }, []);
  
  const canNextPage = safePage < totalPages;
  const canPrevPage = safePage > 1;
  
  // Generate array of page buttons to display
  const pageButtons = useMemo(() => {
    const halfMaxButtons = Math.floor(maxPageButtons / 2);
    let startPage = Math.max(safePage - halfMaxButtons, 1);
    let endPage = Math.min(startPage + maxPageButtons - 1, totalPages);
    
    if (endPage - startPage + 1 < maxPageButtons) {
      startPage = Math.max(endPage - maxPageButtons + 1, 1);
    }
    
    return Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  }, [safePage, totalPages, maxPageButtons]);
  
  return {
    currentPage: safePage,
    totalPages,
    pageSize,
    startIndex,
    endIndex,
    setPage,
    nextPage,
    prevPage,
    setPageSize,
    pageButtons,
    canNextPage,
    canPrevPage
  };
}
```

### Step 2: Use the Hook

Use the hook in a component:

```tsx
import { usePagination } from '@/hooks/usePagination';

// In your component
const {
  currentPage,
  totalPages,
  pageSize,
  startIndex,
  endIndex,
  setPage,
  nextPage,
  prevPage,
  setPageSize,
  pageButtons,
  canNextPage,
  canPrevPage
} = usePagination({
  totalItems: 100,
  initialPage: 1,
  itemsPerPage: 10,
  maxPageButtons: 5
});

// In your JSX
<div className="flex items-center justify-between">
  <div>
    Showing {startIndex + 1} to {endIndex + 1} of {totalItems} items
  </div>
  <div className="flex items-center space-x-2">
    <Button
      variant="outline"
      size="sm"
      onClick={prevPage}
      disabled={!canPrevPage}
    >
      Previous
    </Button>
    {pageButtons.map(page => (
      <Button
        key={page}
        variant={page === currentPage ? "default" : "outline"}
        size="sm"
        onClick={() => setPage(page)}
      >
        {page}
      </Button>
    ))}
    <Button
      variant="outline"
      size="sm"
      onClick={nextPage}
      disabled={!canNextPage}
    >
      Next
    </Button>
  </div>
</div>
```

## Implementing a New Report

This example demonstrates how to implement a new report for equipment maintenance history.

### Step 1: Create the Report Script

Create a file at `nirmaan_stack/nirmaan_stack/report/equipment_maintenance_history/equipment_maintenance_history.py`:

```python
# Copyright (c) 2023, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _

def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    
    chart_data = get_chart_data(data)
    
    return columns, data, None, chart_data

def get_columns():
    return [
        {
            "fieldname": "equipment",
            "label": _("Equipment ID"),
            "fieldtype": "Link",
            "options": "Equipment",
            "width": 120
        },
        {
            "fieldname": "equipment_name",
            "label": _("Equipment Name"),
            "fieldtype": "Data",
            "width": 180
        },
        {
            "fieldname": "maintenance_date",
            "label": _("Maintenance Date"),
            "fieldtype": "Date",
            "width": 100
        },
        {
            "fieldname": "maintenance_type",
            "label": _("Type"),
            "fieldtype": "Data",
            "width": 100
        },
        {
            "fieldname": "performed_by",
            "label": _("Performed By"),
            "fieldtype": "Link",
            "options": "Nirmaan Users",
            "width": 150
        },
        {
            "fieldname": "cost",
            "label": _("Cost"),
            "fieldtype": "Currency",
            "width": 100
        },
        {
            "fieldname": "status",
            "label": _("Status"),
            "fieldtype": "Data",
            "width": 100
        },
        {
            "fieldname": "notes",
            "label": _("Notes"),
            "fieldtype": "Text",
            "width": 200
        }
    ]

def get_data(filters):
    conditions = get_conditions(filters)
    
    data = frappe.db.sql("""
        SELECT
            em.equipment,
            e.equipment_name,
            em.maintenance_date,
            em.maintenance_type,
            em.performed_by,
            em.cost,
            em.status,
            em.notes
        FROM
            `tabEquipment Maintenance` em
        JOIN
            `tabEquipment` e ON em.equipment = e.name
        WHERE
            {conditions}
        ORDER BY
            em.maintenance_date DESC
    """.format(conditions=conditions), filters, as_dict=1)
    
    return data

def get_conditions(filters):
    conditions = "1=1"
    
    if filters.get("equipment"):
        conditions += " AND em.equipment = %(equipment)s"
    
    if filters.get("equipment_type"):
        conditions += " AND e.equipment_type = %(equipment_type)s"
    
    if filters.get("maintenance_type"):
        conditions += " AND em.maintenance_type = %(maintenance_type)s"
    
    if filters.get("from_date") and filters.get("to_date"):
        conditions += " AND em.maintenance_date BETWEEN %(from_date)s AND %(to_date)s"
    elif filters.get("from_date"):
        conditions += " AND em.maintenance_date >= %(from_date)s"
    elif filters.get("to_date"):
        conditions += " AND em.maintenance_date <= %(to_date)s"
    
    return conditions

def get_chart_data(data):
    if not data:
        return None
    
    maintenance_types = {}
    for entry in data:
        maintenance_type = entry.get("maintenance_type")
        if maintenance_type not in maintenance_types:
            maintenance_types[maintenance_type] = 0
        maintenance_types[maintenance_type] += 1
    
    chart_data = {
        "data": {
            "labels": list(maintenance_types.keys()),
            "datasets": [
                {
                    "name": "Maintenance Count",
                    "values": list(maintenance_types.values())
                }
            ]
        },
        "type": "pie",
        "height": 300
    }
    
    return chart_data
```

### Step 2: Create the Report JSON

Create a file at `nirmaan_stack/nirmaan_stack/report/equipment_maintenance_history/equipment_maintenance_history.json`:

```json
{
  "add_total_row": 0,
  "creation": "2023-05-28 10:00:00.000000",
  "disable_prepared_report": 0,
  "disabled": 0,
  "docstatus": 0,
  "doctype": "Report",
  "filters": [],
  "idx": 0,
  "is_standard": "Yes",
  "modified": "2023-05-28 10:00:00.000000",
  "modified_by": "Administrator",
  "module": "Nirmaan Stack",
  "name": "Equipment Maintenance History",
  "owner": "Administrator",
  "prepared_report": 0,
  "ref_doctype": "Equipment Maintenance",
  "report_name": "Equipment Maintenance History",
  "report_type": "Script Report",
  "roles": [
    {
      "role": "System Manager"
    },
    {
      "role": "Nirmaan Project Manager"
    },
    {
      "role": "Nirmaan Maintenance Supervisor"
    }
  ]
}
```

### Step 3: Create the Report Frontend

Create a file at `frontend/src/pages/reports/EquipmentMaintenanceReport.tsx`:

```tsx
import React, { useState } from 'react';
import { useFrappeGetCall } from 'frappe-react-sdk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, FileText, Printer } from 'lucide-react';
import { format } from 'date-fns';

interface MaintenanceRecord {
  equipment: string;
  equipment_name: string;
  maintenance_date: string;
  maintenance_type: string;
  performed_by: string;
  cost: number;
  status: string;
  notes: string;
}

const EquipmentMaintenanceReport: React.FC = () => {
  const [filters, setFilters] = useState({
    equipment: '',
    equipment_type: '',
    maintenance_type: '',
    from_date: '',
    to_date: ''
  });
  
  const { data, error, isLoading, mutate } = useFrappeGetCall<{
    columns: any[];
    data: MaintenanceRecord[];
    chart_data: any;
  }>(
    'nirmaan_stack.nirmaan_stack.report.equipment_maintenance_history.equipment_maintenance_history.execute',
    filters
  );
  
  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };
  
  const handleApplyFilters = () => {
    mutate();
  };
  
  const handleExportCSV = () => {
    // Implementation for exporting to CSV
  };
  
  const handlePrint = () => {
    window.print();
  };
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Equipment Maintenance History</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportCSV}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="equipment">Equipment</Label>
              <Input
                id="equipment"
                value={filters.equipment}
                onChange={(e) => handleFilterChange('equipment', e.target.value)}
                placeholder="Equipment ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipment_type">Equipment Type</Label>
              <Select
                value={filters.equipment_type}
                onValueChange={(value) => handleFilterChange('equipment_type', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Types</SelectItem>
                  <SelectItem value="Heavy Machinery">Heavy Machinery</SelectItem>
                  <SelectItem value="Hand Tools">Hand Tools</SelectItem>
                  <SelectItem value="Power Tools">Power Tools</SelectItem>
                  <SelectItem value="Vehicles">Vehicles</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maintenance_type">Maintenance Type</Label>
              <Select
                value={filters.maintenance_type}
                onValueChange={(value)
```
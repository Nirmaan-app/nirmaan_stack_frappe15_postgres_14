import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { TaskStatusBadge } from "./components/TaskStatusBadge";
import { EditTaskDialog } from "./components/EditTaskDialog";
import { LinkedPOsColumn } from "./components/LinkedPOsColumn";
import { formatDate } from "@/utils/FormatDate";
import { Settings2, ChevronRight, MoreVertical } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LinkPODialog } from "./components/LinkPODialog";

// Mobile Card Component for tasks
interface TaskMobileCardProps {
  task: CriticalPOTask;
  projectId: string;
  mutate: () => Promise<any>;
  canEdit: boolean;
}

const TaskMobileCard: React.FC<TaskMobileCardProps> = ({ task, projectId, mutate, canEdit }) => {
  const [isOpen, setIsOpen] = useState(false);

  // Parse linked POs count
  const linkedPOsCount = React.useMemo(() => {
    try {
      const associated = task.associated_pos;
      if (typeof associated === "string") {
        const parsed = JSON.parse(associated);
        return parsed?.pos?.length || 0;
      } else if (associated && typeof associated === "object") {
        return associated.pos?.length || 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }, [task.associated_pos]);

  return (
    <Card className="p-3">
      {/* Header: Item name + Actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm leading-tight">{task.item_name}</h4>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Badge variant="outline" className="text-xs">
              {task.critical_po_category}
            </Badge>
            {task.sub_category && (
              <Badge variant="secondary" className="text-xs">
                {task.sub_category}
              </Badge>
            )}
            <TaskStatusBadge status={task.status} />
          </div>
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <EditTaskDialog task={task} projectId={projectId} mutate={mutate} />
              <LinkPODialog task={task} projectId={projectId} mutate={mutate} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Deadline info */}
      <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
        <div className="flex items-center gap-1">
          <span className="text-gray-500">Deadline:</span>
          <span className="font-medium">{formatDate(task.po_release_date)}</span>
        </div>
        {task.revised_date && (
          <div className="flex items-center gap-1">
            <span className="text-amber-600">Revised:</span>
            <span className="font-medium text-amber-700">{formatDate(task.revised_date)}</span>
          </div>
        )}
      </div>

      {/* Remarks (if any) */}
      {task.remarks && (
        <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">
          {task.remarks}
        </div>
      )}

      {/* Associated POs - collapsible section */}
      {linkedPOsCount > 0 && (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-2 pt-2 border-t">
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            <span>Show {linkedPOsCount} linked PO{linkedPOsCount > 1 ? "s" : ""}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <LinkedPOsColumn task={task} projectId={projectId} mutate={mutate} canDelete={canEdit} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
};

interface CriticalPOTasksListProps {
  tasks: CriticalPOTask[];
  projectId: string;
  mutate: () => Promise<any>;
  onManageSetup?: () => void;
  canEdit?: boolean; // Controls Edit button and delete associated POs visibility
}

export const CriticalPOTasksList: React.FC<CriticalPOTasksListProps> = ({
  tasks,
  projectId,
  mutate,
  onManageSetup,
  canEdit = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Get unique categories for filter
  const uniqueCategories = useMemo(() => {
    const categories = new Set(tasks.map((task) => task.critical_po_category));
    return Array.from(categories).sort();
  }, [tasks]);

  // Filter and search tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Search filter
      const matchesSearch =
        task.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.critical_po_category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (task.sub_category?.toLowerCase() || "").includes(searchQuery.toLowerCase());

      // Status filter
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;

      // Category filter
      const matchesCategory =
        categoryFilter === "all" || task.critical_po_category === categoryFilter;

      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [tasks, searchQuery, statusFilter, categoryFilter]);

  // Sort by PO Release Deadline (ascending)
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const dateA = new Date(a.po_release_date).getTime();
      const dateB = new Date(b.po_release_date).getTime();
      return dateA - dateB;
    });
  }, [filteredTasks]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-xl">Critical PO Tasks</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Showing {sortedTasks.length} of {tasks.length} task(s)
              </p>
            </div>
            {onManageSetup && (
              <Button variant="outline" onClick={onManageSetup} size="sm">
                <Settings2 className="h-4 w-4 mr-2" />
                Manage Setup
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Summary Stats */}
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-50 rounded-md">
              <p className="text-sm text-gray-500">Total Tasks</p>
              <p className="text-2xl font-bold">
                {tasks.filter((t) => t.status !== "Not Applicable").length}
              </p>
            </div>
            <div className="p-4 bg-red-50 rounded-md">
              <p className="text-sm text-red-700">Not Released</p>
              <p className="text-2xl font-bold text-red-700">
                {tasks.filter((t) => t.status === "Not Released").length}
              </p>
            </div>
            <div className="p-4 bg-yellow-50 rounded-md">
              <p className="text-sm text-yellow-700">Partially Released</p>
              <p className="text-2xl font-bold text-yellow-700">
                {tasks.filter((t) => t.status === "Partially Released").length}
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-md">
              <p className="text-sm text-green-700">Released</p>
              <p className="text-2xl font-bold text-green-700">
                {tasks.filter((t) => t.status === "Released").length}
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-0 sm:min-w-[200px]">
              <Input
                placeholder="Search by item, category, or sub-category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Not Released">Not Released</SelectItem>
                <SelectItem value="Partially Released">Partially Released</SelectItem>
                <SelectItem value="Released">Released</SelectItem>
                <SelectItem value="Not Applicable">Not Applicable</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {uniqueCategories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Task List */}
          {sortedTasks.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p>No tasks found matching your filters.</p>
            </div>
          ) : (
            <>
              {/* MOBILE VIEW - Card-based layout */}
              <div className="sm:hidden space-y-3">
                {sortedTasks.map((task) => (
                  <TaskMobileCard
                    key={task.name}
                    task={task}
                    projectId={projectId}
                    mutate={mutate}
                    canEdit={canEdit}
                  />
                ))}
              </div>

              {/* DESKTOP VIEW - Table with horizontal scroll */}
              <div className="hidden sm:block border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead className="min-w-[150px]">Item Name</TableHead>
                      <TableHead className="min-w-[100px]">Category</TableHead>
                      <TableHead className="min-w-[100px]">Sub Category</TableHead>
                      <TableHead className="min-w-[120px]">PO Release Deadline</TableHead>
                      <TableHead className="min-w-[120px]">Revised Deadline</TableHead>
                      <TableHead className="min-w-[100px]">Status</TableHead>
                      <TableHead className="min-w-[150px]">Remarks</TableHead>
                      <TableHead className="min-w-[140px]">Associated POs</TableHead>
                      {canEdit && <TableHead className="min-w-[100px] text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTasks.map((task) => (
                      <TableRow key={task.name} className="hover:bg-gray-50">
                        <TableCell className="font-medium">{task.item_name}</TableCell>
                        <TableCell>{task.critical_po_category}</TableCell>
                        <TableCell className="text-gray-500">
                          {task.sub_category || "-"}
                        </TableCell>
                        <TableCell>{formatDate(task.po_release_date)}</TableCell>
                        <TableCell className="text-gray-500">
                          {task.revised_date ? formatDate(task.revised_date) : "-"}
                        </TableCell>
                        <TableCell>
                          <TaskStatusBadge status={task.status} />
                        </TableCell>
                        <TableCell className="text-gray-500 text-sm max-w-[200px] whitespace-normal break-words">
                          {task.remarks || "-"}
                        </TableCell>
                        <TableCell>
                          <LinkedPOsColumn task={task} projectId={projectId} mutate={mutate} canDelete={canEdit} />
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <EditTaskDialog task={task} projectId={projectId} mutate={mutate} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

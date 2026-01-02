import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { TaskStatusBadge } from "./components/TaskStatusBadge";
import { EditTaskDialog } from "./components/EditTaskDialog";
import { LinkPODialog } from "./components/LinkPODialog";
import { LinkedPOsColumn } from "./components/LinkedPOsColumn";
import { formatDate } from "@/utils/FormatDate";
import { Settings2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CriticalPOTasksListProps {
  tasks: CriticalPOTask[];
  projectId: string;
  mutate: () => Promise<any>;
  onManageSetup?: () => void;
}

export const CriticalPOTasksList: React.FC<CriticalPOTasksListProps> = ({
  tasks,
  projectId,
  mutate,
  onManageSetup,
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

  // Sort by PO Release Date (ascending)
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
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search by item, category, or sub-category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
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
              <SelectTrigger className="w-[180px]">
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

          {/* Table */}
          {sortedTasks.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p>No tasks found matching your filters.</p>
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead className="w-[15%]">Item Name</TableHead>
                    <TableHead className="w-[10%]">Category</TableHead>
                    <TableHead className="w-[8%]">Sub Category</TableHead>
                    <TableHead className="w-[9%]">PO Release Date</TableHead>
                    <TableHead className="w-[9%]">Revised Date</TableHead>
                    <TableHead className="w-[10%]">Status</TableHead>
                    <TableHead className="w-[15%]">Remarks</TableHead>
                    <TableHead className="w-[14%]">Associated POs</TableHead>
                    <TableHead className="w-[10%] text-right">Actions</TableHead>
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
                      <TableCell className="text-gray-500 text-sm max-w-[200px] truncate" title={task.remarks || ""}>
                        {task.remarks || "-"}
                      </TableCell>
                      <TableCell>
                        <LinkedPOsColumn task={task} projectId={projectId} mutate={mutate} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col gap-1 items-end">
                          <EditTaskDialog task={task} mutate={mutate} />
                          <LinkPODialog task={task} projectId={projectId} mutate={mutate} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

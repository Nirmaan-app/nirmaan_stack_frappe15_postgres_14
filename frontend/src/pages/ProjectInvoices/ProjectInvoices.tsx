

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";

import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeGetDocList ,useFrappeDeleteDoc } from "frappe-react-sdk";
import { CirclePlus } from "lucide-react";
import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
//Component
import { ProjectInvoiceTable } from "./components/ProjectInvoiceTable";
import { ProjectInvoiceDialog } from "./components/ProjectInvoiceDialog";


const DOCTYPE="Project Invoices"
const ITEM_LIST_FIELDS_TO_FETCH=["name", "invoice_no", "amount", "attachment", "creation","owner","project", "modified_by"]

export const ProjectInvoices:  React.FC<{ projectId? : string, customerId?: string}> = ({ projectId, customerId}) => {
  const { toggleNewProjectInvoiceDialog } = useDialogStore();

  const { data, isLoading, error, mutate } = useFrappeGetDocList<ProjectInvoice>(DOCTYPE, {
    fields: ITEM_LIST_FIELDS_TO_FETCH as string[],
    filters: projectId ? [["project", "=", projectId]] : [],
    orderBy: {
      field: "creation",
      order: "desc"
    },
  });
const {deleteDoc, loading: deleteDocLoading} = useFrappeDeleteDoc()
const handleDeleteInvoiceEntry = async(invoiceId: string) => {
   try {
        await deleteDoc(DOCTYPE, invoiceId);
        await mutate(DOCTYPE);
        
         toast({
                        title: "Success!",
                        description: `Invoice  deleted successfully.`,
                        variant: "success"
                    });
        
      } catch (error: any) {
        console.error("deleteTask error", error);
        toast({
          title: "Failed!",
          description: error?.message || "Failed to delete task!",
          variant: "destructive",
        });
      }
  
  };
  return (
    <div className="flex-1 space-y-4">
      {/* <div className="flex justify-end items-center">
        <Button onClick={toggleNewProjectInvoiceDialog}>
          <CirclePlus className="h-4 w-4 mr-2" /> Add New Invoice
        </Button>
      </div> */}

      {isLoading ? (
        <TableSkeleton />
      ) : (
        // <DataTable columns={Columns} data={data || []} />
           <Card className=""> {/* Subtle styling */}
                        <CardHeader className="border-b border-gray-200">
                            <CardTitle className="flex justify-between items-center">
                                <p className="text-xl max-sm:text-lg text-red-600">Invoices</p>
                                <div className='flex gap-2 items-center'>
                                
                                <Button
                                    variant="outline"
                                    size="sm" // Consistent button size
                                    className="text-primary border-primary hover:bg-primary/5" // Subtle hover
                                  onClick={toggleNewProjectInvoiceDialog}
                                >
                                    <CirclePlus className="h-4 w-4 mr-2" /> Add Invoice
                                </Button>
        
                                </div>
                            </CardTitle>
                        </CardHeader>
                        <CardContent> {/* Remove padding to let table control it */}
                             <div className="overflow-x-auto"> {/* Ensure table scrolls horizontally if needed */}
                              <ProjectInvoiceTable items={data||[]} siteUrl={SITEURL} handleDeleteInvoiceEntry={handleDeleteInvoiceEntry} deleteLoading={deleteDocLoading} />
                                
                             </div>
                        </CardContent>
                    </Card>

      )}
      
      {/* This renders the dialog and passes it the function to refresh the table */}
      <ProjectInvoiceDialog listMutate={mutate} ProjectId={projectId} />
      

    </div>
  )
};

export default ProjectInvoices;
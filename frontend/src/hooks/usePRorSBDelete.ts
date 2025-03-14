import { toast } from "@/components/ui/use-toast";
import { UserContext } from "@/utils/auth/UserProvider";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";

export const usePRorSBDelete = (mutate : any) => {
  const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc()

  const {toggleDeleteDialog} = useContext(UserContext);
  const navigate = useNavigate()
  const handleDeletePR = async (id : string, navigation : boolean = false) => {
          try {
              await deleteDoc("Procurement Requests", id);
              await mutate();
              toast({
                  title: "Success!",
                  description: `PR: ${id} deleted successfully!`,
                  variant: "success"
              })
              toggleDeleteDialog()
              if(navigation) {
                navigate("/procurement-requests?tab=New PR Request")
              }
          } catch (error) {
              console.log("error while deleting procurement request", error);
              toast({
                  title: "Failed!",
                  description: `Procurement Request: ${id} Deletion Failed!`,
                  variant: "destructive"
              })
          }
      } 
  
      const handleDeleteSB = async (id : string, navigation : boolean = false) => {
        try {
            await deleteDoc("Sent Back Category", id);
            await mutate();
            toast({
                title: "Success!",
                description: `Sent Back: ${id} deleted successfully!`,
                variant: "success"
            })
            toggleDeleteDialog()
            if(navigation) {
              navigate("/procurement-requests?tab=Rejected")
            }
        } catch (error) {
            console.log("error while deleting Sent Back Request", error);
            toast({
                title: "Failed!",
                description: `Sent Back Request: ${id} Deletion Failed!`,
                variant: "destructive"
            })
        }
    } 
  
return {
  handleDeletePR,
  deleteLoading,
  handleDeleteSB
}
}
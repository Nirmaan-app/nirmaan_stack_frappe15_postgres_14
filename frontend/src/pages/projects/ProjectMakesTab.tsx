import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { Radio } from "antd";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import ReactSelect from "react-select";

interface ProjectMakesTabProps {
  projectData?: any;
  options?: {
    label: string;
    value: string;
}[];
  makesTab?: string;
  setProjectMakesTab?: (tab: any) => void;
  project_mutate?: any;
}

export const ProjectMakesTab : React.FC<ProjectMakesTabProps> = ({ projectData, options, makesTab, setProjectMakesTab, project_mutate }) => {


  const [wPmakesData, setWPMakesData] = useState([])

  const [editCategory, setEditCategory] = useState(null)

  const [selectedMakes, setSelectedMakes] = useState([])

  const [reactSelectOptions, setReactSelectOptions] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)

  const toggleDialog = () => {
    setDialogOpen((prevState) => !prevState);
  };

  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc()

  const { data: categoryMakeList, isLoading: categoryMakeListLoading } = useFrappeGetDocList("Category Makelist", {
    fields: ["make", "category"],
    limit: 100000,
  });

  useEffect(() => {
    if (makesTab) {
      const filteredWPMakes = JSON.parse(projectData?.project_work_packages)?.work_packages?.find(wp => wp?.work_package_name === makesTab)?.category_list?.list
      setWPMakesData(filteredWPMakes)
    }
  }, [makesTab, projectData])

  useEffect(() => {
    if (editCategory?.makes?.length > 0) {
      const options = []
      editCategory?.makes?.forEach(i => {
        options.push({ label: i, value: i })
      })
      setSelectedMakes(options)
    } else {
      setSelectedMakes([])
    }

    if (editCategory?.name) {
      const categoryMakes = categoryMakeList?.filter((i) => i?.category === editCategory?.name)?.map(j => ({ label: j?.make, value: j?.make })) || []
      setReactSelectOptions(categoryMakes)
    }
  }, [editCategory])

  const handleUpdateMakes = async () => {
    try {
      const reformattedMakes = selectedMakes?.map(i => i?.value)

      const updatedWorkPackages = [...JSON.parse(projectData?.project_work_packages)?.work_packages]

      updatedWorkPackages.forEach(wp => {
        if (wp?.work_package_name === makesTab) {
          wp.category_list.list.forEach(cat => {
            if (cat?.name === editCategory?.name) {
              cat.makes = reformattedMakes
            }
          })
        }
      })

      await updateDoc("Projects", projectData?.name, {
        project_work_packages: { work_packages: updatedWorkPackages }
      })

      await project_mutate()

      toast({
        title: "Success!",
        description: `${editCategory?.name} Makes updated successfully!`,
        variant: "success",
      })

      toggleDialog()

    } catch (error) {
      console.log("error while updating makes", error);
      toast({
        title: "Failed!",
        description: `${error?.message}`,
        variant: "destructive",
      });
    }
  }

  return (
    <>
      {options && (
        <Radio.Group
          block
          options={options}
          defaultValue="All"
          optionType="button"
          buttonStyle="solid"
          value={makesTab}
          onChange={(e) => setProjectMakesTab(e.target.value)}
        />
      )}

      <Table>
        <TableHeader className="bg-red-100">
          <TableRow>
            <TableHead className="w-[35%]">Category</TableHead>
            <TableHead className="w-[50%]">Makes</TableHead>
            <TableHead>Add/Edit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wPmakesData?.map((wpmake, index) => (
            <TableRow key={index}>
              <TableCell>{wpmake?.name}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {wpmake?.makes?.length > 0 ? (
                    wpmake?.makes?.map((make) => (
                      <Badge key={make}>{make}</Badge>
                    ))
                  ) : (
                    <span>--</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Dialog open={dialogOpen} onOpenChange={toggleDialog}>
                  <DialogTrigger onClick={() => setEditCategory(wpmake)} asChild>
                    <Button
                      variant="outline"
                    >
                      Edit
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit <span className="text-primary">{editCategory?.name}</span> makes</DialogTitle>
                      <DialogDescription className="pt-4">
                        <ReactSelect
                          options={reactSelectOptions}
                          value={selectedMakes}
                          className="w-full"
                          placeholder="Select Makes..."
                          isMulti
                          onChange={(selected) =>
                            setSelectedMakes(selected)
                          }
                        />
                      </DialogDescription>
                      <div className="pt-4 flex justify-end gap-2 items-center">
                        {updateLoading ? <TailSpin color="red" height={30} width={30} /> : (
                          <>
                            <DialogClose asChild>
                              <Button variant="secondary">Cancel</Button>
                            </DialogClose>
                            <Button onClick={handleUpdateMakes}>Save</Button>
                          </>
                        )}
                      </div>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
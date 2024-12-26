import { useNavigate, useParams } from "react-router-dom";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./ui/accordion";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";
import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import logo from "@/assets/logo-svg.svg";

export const ManPowerOverallSummary = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const {
    data: manpowerData,
    isLoading: manpowerLoading,
    error: manpowerError,
  } = useFrappeGetDocList(
    "Manpower Reports",
    {
      fields: ["*"],
      filters: [["project", "=", projectId]],
      orderBy: { field: "creation", order: "desc" },
    },
    projectId ? undefined : null
  );

  const componentRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => componentRef.current || null,
  });

  if (manpowerLoading) {
    return <p>Loading...</p>;
  }

  if (manpowerError) {
    return <p>Error loading manpower data</p>;
  }

  // Calculate total manpower from all reports
  const totalManpower = manpowerData
    ? manpowerData.reduce((total, report) => {
        return (
          total +
          (report.report?.data?.reduce((sum, role) => sum + role.count, 0) || 0)
        );
      }, 0)
    : 0;

  // Combine role distributions from all reports
  const roleDistribution = manpowerData
    ? manpowerData.reduce((roles, report) => {
        report.report?.data?.forEach((role) => {
          const existingRole = roles.find((r) => r.role === role.role);
          if (existingRole) {
            existingRole.count += role.count;
          } else {
            roles.push({ role: role.role, count: role.count });
          }
        });
        return roles;
      }, [])
    : [];

  // Group reports by role
  const roleReports = manpowerData
    ? manpowerData.reduce((acc, report) => {
        report.report?.data?.forEach((role) => {
          if (!acc[role.role]) {
            acc[role.role] = [];
          }
          acc[role.role].push({ date: report.creation, count: role.count });
        });
        return acc;
      }, {})
    : {};

  return (
    <div className="flex-1 space-y-4">
      {/* Header */}
      {/* <div className="flex justify-between items-center">
        <div className="flex items-center gap-1">
          <ArrowLeft
            className="cursor-pointer max-sm:w-4 max-sm:h-4"
            onClick={() => navigate(-1)}
          />
          <h1 className="text-2xl font-semibold max-sm:text-base">
            ManPower Overall Summary
          </h1>
        </div>
      </div> */}

      {/* Key Metrics */}
      <div className="flex justify-between items-start">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-[70%]">
          <div className="bg-white shadow rounded-lg p-4">
            <h3 className="text-lg font-semibold max-sm:text-base">
              Total Manpower
            </h3>
            <p className="text-3xl font-bold text-blue-600 max-sm:text-lg">
              {totalManpower}
            </p>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <h3 className="text-lg font-semibold max-sm:text-base">
              Roles Breakdown
            </h3>
            <p className="text-3xl font-bold text-yellow-600 max-sm:text-lg">
              {roleDistribution.length} Roles
            </p>
          </div>
        </div>

        <Button onClick={handlePrint} variant="outline">
          Export Report
        </Button>
      </div>

      {/* Accordion */}
      <div className="bg-white shadow rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-4 max-sm:text-base">
          Role-wise Detailed Reports
        </h3>
        {Object.keys(roleReports)?.length !== 0 && (
          <Accordion type="multiple" defaultValue={Object.keys(roleReports)}>
            {Object.keys(roleReports).map((role, index) => (
              <AccordionItem key={index} value={role}>
                <AccordionTrigger>
                  <h4 className="text-lg font-medium max-sm:text-base">
                    {role}
                  </h4>
                </AccordionTrigger>
                <AccordionContent>
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableCell className="font-semibold">Date</TableCell>
                        <TableCell className="font-semibold">Count</TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roleReports[role].map((entry, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            {new Date(entry.date).toLocaleDateString()}
                          </TableCell>
                          <TableCell>{entry.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <div className="hidden">
        <div ref={componentRef} className="p-8 bg-white text-black">
          {/* Report Header */}
          <header>
            <img src={logo} alt="Nirmaan" width="180" height="52" />
            <div className="pt-1 text-lg text-gray-500 font-semibold">
              Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
            </div>
          </header>
          <div className="flex justify-between items-center my-4">
            <h1 className="text-xl font-bold">Manpower Overall Summary</h1>
            <p className="text-lg">{projectId}</p>
          </div>

          {/* Key Metrics */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="p-4 border rounded shadow">
              <h3 className="text-xl font-semibold">Total Manpower</h3>
              <p className="text-2xl font-bold text-blue-600">
                {totalManpower}
              </p>
            </div>
            <div className="p-4 border rounded shadow">
              <h3 className="text-xl font-semibold">Roles Breakdown</h3>
              <p className="text-2xl font-bold text-yellow-600">
                {roleDistribution.length} Roles
              </p>
            </div>
          </section>

          {/* Detailed Role Breakdown */}
          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">Roles Breakdown</h2>
            <Table className="w-full border">
              <TableHeader>
                <TableRow>
                  <TableCell className="font-bold w-[60%]">Role</TableCell>
                  <TableCell className="font-bold">Count</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roleDistribution.map((roleData, index) => (
                  <TableRow key={index}>
                    <TableCell className="w-[60%]">{roleData.role}</TableCell>
                    <TableCell>{roleData.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          {/* Role-wise Detailed Reports */}
          <section>
            <h2 className="text-xl font-bold mb-4">
              Role-wise Detailed Reports
            </h2>
            {Object.keys(roleReports).map((role, index) => (
              <div key={index} className="mb-6">
                <h3 className="text-lg font-semibold mb-2">{role}</h3>
                <Table className="w-full border">
                  <TableHeader>
                    <TableRow>
                      <TableCell className="font-bold w-[60%]">Date</TableCell>
                      <TableCell className="font-bold">Count</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roleReports[role].map((entry, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="w-[60%]">
                          {new Date(entry.date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{entry.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
};

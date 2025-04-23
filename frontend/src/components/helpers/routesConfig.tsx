// src/routes.tsx
import { RouteObject } from "react-router-dom";

// --- Import all necessary components used in routes ---
import { ManPowerOverallSummary } from "@/components/ManPowerOverallSummary";
import { ManPowerReport } from "@/components/ManPowerReport";
import { MainLayout } from "@/components/layout/main-layout";
import { NotificationsPage } from "@/components/nav/notifications";
import { ProcurementPackages } from "@/components/procurement-packages";
import { LivePRTrackingTable } from "@/components/procurement-request/LivePRTrackingTable";
import ListPR from "@/components/procurement-request/list-pr";
import { EstimatedPriceOverview } from "@/components/procurement/EstimatedPriceOverview";
import NewMilestones from "@/components/updates/NewMilestones";
// import { SentBackSummary } from '@/components/procurement/sent-back-summary' // Example if needed

import { ApprovedQuotationsTable } from "@/pages/ApprovedQuotationsFlow/ApprovedQuotationsTable";
import DeliveryNote from "@/pages/DeliveryNotes/deliverynote";
import DeliveryNotes from "@/pages/DeliveryNotes/deliverynotes";
import Items from "@/pages/Items/items";
import { RenderPurchaseOrdersTab } from "@/pages/ProcurementOrders/RenderPurchaseOrdersTab";
import { ReleasePOSelect } from "@/pages/ProcurementOrders/release-po-select";
import { NewCustomPR } from "@/pages/ProcurementRequests/NewPR/NewCustomPR";
import { NewProcurementRequest } from "@/pages/ProcurementRequests/NewPR/new-new-pr";
import { ProcurementRequests } from "@/pages/ProcurementRequests/VendorQuotesSelection/procurement-requests";
import { RenderProcurementRequest } from "@/pages/ProcurementRequests/VendorQuotesSelection/render-procurement-requests";
import { RenderProjectPaymentsComponent } from "@/pages/ProjectPayments/RenderProjectPaymentsComponent";
import OrderPaymentSummary from "@/pages/ProjectPayments/order-payment-summary";
import { RenderSentBackComponent } from "@/pages/Sent Back Requests/RenderSentBackComponent";
import { RenderSRComponent } from "@/pages/ServiceRequests/RenderSRComponent";
import { ServiceRequestsTabs } from "@/pages/ServiceRequests/ServiceRequestsTabs";
import ApprovedSR from "@/pages/ServiceRequests/service-request/approved-sr";
import ListSR from "@/pages/ServiceRequests/service-request/list-sr";
import SelectServiceVendor from "@/pages/ServiceRequests/service-request/select-service-vendor";
import ForgotPassword from "@/pages/auth/forgot-password";
import Login from "@/pages/auth/old-login";
import NewCustomer from "@/pages/customers/add-new-customer";
import Customer from "@/pages/customers/customer";
import Customers from "@/pages/customers/customers";
import Dashboard from "@/pages/dashboard";
import { PDF } from "@/pages/pdf";
import { InFlowPayments } from "@/pages/projects/InFlowPayments";
import { ProjectForm } from "@/pages/projects/project-form";
import Projects from "@/pages/projects/projects";
import Roles from "@/pages/roles";
import EditUserForm from "@/pages/users/EditUserForm";
import { UserForm } from "@/pages/users/user-form";
import Profile from "@/pages/users/user-profile";
import Users from "@/pages/users/users";
import { NewVendor } from "@/pages/vendors/new-vendor";
import Vendors from "@/pages/vendors/vendors";
import WorkPackages from "@/pages/work-packages";
import { ProtectedRoute } from "@/utils/auth/ProtectedRoute";
import { ProjectManager } from "../layout/dashboards/dashboard-pm";
import InvoiceReconciliation from "@/pages/tasks/InvoiceReconciliation";
import InvoiceReconciliationContainer from "@/pages/tasks/invoices/InvoiceReconciliationContainer";
// --- End component imports ---

export const appRoutes: RouteObject[] = [
  // --- Public Routes ---
  { path: "/login", element: <Login /> },
  { path: "/forgot-password", element: <ForgotPassword /> },

  // --- Protected Routes ---
  {
    path: "/",
    element: <ProtectedRoute />, // Authentication Wrapper
    children: [
      {
        path: "/", // Matches the parent "/", layout applied here
        element: <MainLayout />, // Main application layout
        children: [
          // --- Dashboard ---
          { index: true, element: <Dashboard /> },

          // --- PRs & Milestones Section ---
          {
            path: "prs&milestones",
            children: [
              { index: true, element: <ProjectManager /> },
              {
                path: "procurement-requests",
                children: [
                  { index: true, element: <ListPR /> },
                  {
                    path: ":projectId",
                    children: [
                      { path: "new-pr", element: <NewProcurementRequest /> },
                      { path: "new-custom-pr", element: <NewCustomPR /> },
                    ],
                  },
                  {
                    path: ":prId",
                    children: [
                       {
                        path: "resolve-pr",
                        element: <NewProcurementRequest resolve={true} />,
                      },
                      {
                        path: "resolve-custom-pr",
                        element: <NewCustomPR resolve={true} />,
                      },
                      {
                        path: "edit-pr",
                        element: <NewProcurementRequest edit={true} />,
                      },
                      { index: true, lazy: () => import("@/components/pr-summary") },
                      {
                        path: ":poId",
                        lazy: () => import("@/components/POSummary"),
                      },
                      {
                        path: "dn",
                        children: [
                            { path: ":dnId", element: <DeliveryNote /> },
                            { path: ":dnId/:poId", lazy: () => import("@/components/POSummary") } // Check if this path makes sense
                        ]
                      }
                    ],
                  },
                ],
              },
              {
                path: "delivery-notes",
                children: [
                  { index: true, element: <DeliveryNotes /> },
                  {
                    path: ":dnId",
                    children: [
                      { index: true, element: <DeliveryNote /> },
                      {
                         path: ":prId",
                         children: [
                            { index: true, lazy: () => import("@/components/pr-summary") },
                            { path: ":poId", lazy: () => import("@/components/POSummary") }
                         ]
                      }
                    ],
                  },
                ],
              },
              {
                path: "man-power-report",
                children: [
                  { index: true, element: <ManPowerReport /> },
                  { path: ":projectId", element: <ManPowerOverallSummary /> },
                ],
              },
            ],
          },

          // --- Service Requests Section ---
           {
            path: "service-requests-list",
            children: [
              { index: true, element: <ListSR /> },
              {
                path: ":project/new-sr",
                lazy: () => import("@/pages/ServiceRequests/service-request/new-service-request"),
              },
              {
                path: ":srId",
                children: [
                  { index: true, lazy: () => import("@/pages/ServiceRequests/service-request/sr-summary") },
                  { path: "order-view", element: <ApprovedSR summaryPage={true} /> },
                  { path: "resolve-sr", element: <SelectServiceVendor /> },
                ],
              },
            ],
          },
          {
            path: "service-requests",
            children: [
                { index: true, element: <ServiceRequestsTabs /> },
                { path: ":srId", element: <RenderSRComponent /> },
            ]
          },


          // --- Procurement Requests (Vendor Quotes Selection View?) ---
          {
            path: "procurement-requests", // Duplicate path? Ensure unique top-level paths or nest appropriately. Assuming this is different view.
            children: [
              { index: true, element: <ProcurementRequests /> },
              { path: ":prId", element: <RenderProcurementRequest /> },
            ],
          },

          // --- Purchase Orders ---
          {
            path: "purchase-orders",
            children: [
              { index: true, element: <ReleasePOSelect /> },
              { path: ":id", element: <RenderPurchaseOrdersTab /> }, // :poId might be clearer if it's always PO ID
            ],
          },
          {
            path: "invoice-reconciliation",
            element: <InvoiceReconciliationContainer />
          },

          // --- Sent Back Requests ---
           {
            path: "sent-back-requests",
            children: [
              // No index route defined in original?
              {
                path: ":sbId",
                children: [
                    { index: true, element: <RenderSentBackComponent /> }
                    // Nested routes like update-quote were commented out in original
                ]
              },
            ],
          },

          // --- Estimate Overview ---
           {
            path: "estimate-overview",
            children: [
              { index: true, element: <EstimatedPriceOverview /> },
            ],
          },


          // --- Projects Section ---
          {
            path: "projects",
            children: [
              { index: true, element: <Projects /> },
              { path: "new-project", element: <ProjectForm /> },
              { path: ":projectId", lazy: () => import("@/pages/projects/project") },
              { path: ":projectId/add-estimates", lazy: () => import("@/pages/projects/add-project-estimates") },
              { path: ":projectId/po/:poId", lazy: () => import("@/components/POSummary") },
              {
                path: ":projectId/:prId", // This nesting might conflict if prId is not unique across projects?
                children: [
                    { index: true, lazy: () => import("@/components/pr-summary") },
                    { path: ":poId", lazy: () => import("@/components/POSummary") },
                    {
                        path: "dn",
                        children: [
                            { path: ":dnId", element: <DeliveryNote /> }
                        ]
                    }
                ]
              }
            ],
          },

          // --- Project Payments ---
          {
            path: "project-payments",
            children: [
                { index: true, element: <RenderProjectPaymentsComponent /> },
                { path: ":id", element: <OrderPaymentSummary />} // Consider :paymentId or :orderId for clarity
            ]
          },
          {
            path: "in-flow-payments",
            children: [
                { index: true, element: <InFlowPayments /> },
            ]
          },

          // --- Users Section ---
          {
            path: "users",
            children: [
              { index: true, element: <Users /> },
              { path: "new-user", element: <UserForm /> },
              { path: ":userId", element: <Profile /> },
              { path: ":userId/edit", element: <EditUserForm /> },
            ],
          },

          // --- Items/Products Section ---
          {
            path: "products",
            children: [
              { index: true, element: <Items /> },
              { path: ":productId", lazy: () => import("@/pages/Items/item") },
            ],
          },

          // --- Vendors Section ---
          {
            path: "vendors",
            children: [
              { index: true, element: <Vendors /> },
              { path: "new-vendor", element: <NewVendor /> },
              {
                path: ":vendorId",
                children: [
                  { index: true, lazy: () => import("@/pages/vendors/vendor") },
                  { path: ":poId", lazy: () => import("@/components/POSummary") },
                ],
              },
            ],
          },

          // --- Customers Section ---
          {
            path: "customers",
            children: [
              { index: true, element: <Customers /> },
              { path: "new-customer", element: <NewCustomer /> },
              { path: ":customerId", 
                children: [
                  {index: true, element: <Customer />},
                  { path: ":poId", lazy: () => import("@/components/POSummary") },
                ]
               },
            ],
          },

          // --- Notifications ---
           {
            path: "notifications",
            children: [
              { index: true, element: <NotificationsPage /> },
            ],
          },

          // --- Roles ---
           {
            path: "roles",
            children: [
              { index: true, element: <Roles /> },
            ],
          },

          // --- Approved Quotes / Debug ---
          {
            path: "approved-quotes", // Keep separate from debug or merge?
            children: [
              { index: true, element: <ApprovedQuotationsTable /> },
              { path: ":poId", lazy: () => import("@/components/POSummary") },
            ],
          },
          {
            path: "debug",
            children: [
              { index: true, element: <ApprovedQuotationsTable /> }, // Same component as approved-quotes?
              { path: ":poId", lazy: () => import("@/components/POSummary") },
            ],
          },

          // --- Live PR Tracking ---
           {
            path: "live-pr-tracking",
            children: [
              { index: true, element: <LivePRTrackingTable /> },
            ],
          },

          // --- Other Top-Level Routes within MainLayout ---
          { path: "wp", element: <WorkPackages /> },
          { path: "product-packages", element: <ProcurementPackages /> },
          { path: "pdf", element: <PDF /> }, // Should PDF rendering be a route? Or triggered differently?
          { path: "milestone-update", element: <NewMilestones /> },
          // Commented out routes from original:
          // { path: "delayed-pr", element: <DelayedPRSelect /> },
          // { path: "delayed-pr/:id", element: <DelayedPR /> },
        ],
      },
    ],
  },
  // Add a catch-all 404 route if desired
  // { path: "*", element: <NotFoundPage /> }
];
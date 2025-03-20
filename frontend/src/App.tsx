import { onMessage } from "firebase/messaging";
import { FrappeProvider } from "frappe-react-sdk";
import { FC, useEffect } from "react";
import {
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
} from "react-router-dom";
import { ManPowerOverallSummary } from "./components/ManPowerOverallSummary";
import { ManPowerReport } from "./components/ManPowerReport";
import { ProjectManager } from "./components/dashboard-pm";
import { MainLayout } from "./components/layout/main-layout";
import { NotificationsPage } from "./components/nav/notifications";
import { ProcurementPackages } from "./components/procurement-packages";
import { LivePRTrackingTable } from "./components/procurement-request/LivePRTrackingTable";
import ListPR from "./components/procurement-request/list-pr";
import { NewProcurementRequest } from "./components/procurement-request/new-new-pr";
import { EstimatedPriceOverview } from "./components/procurement/EstimatedPriceOverview";
import { SidebarProvider } from "./components/ui/sidebar";
import { ThemeProvider } from "./components/ui/theme-provider";
import NewMilestones from "./components/updates/NewMilestones";
import { messaging } from "./firebase/firebaseConfig";
import { ApprovedQuotationsTable } from "./pages/ApprovedQuotationsFlow/ApprovedQuotationsTable";
import DeliveryNote from "./pages/DeliveryNotes/deliverynote";
import DeliveryNotes from "./pages/DeliveryNotes/deliverynotes";
import Items from "./pages/Items/items";
import { RenderPurchaseOrdersTab } from "./pages/ProcurementOrders/RenderPurchaseOrdersTab";
import { ReleasePOSelect } from "./pages/ProcurementOrders/release-po-select";
import { NewCustomPR } from "./pages/ProcurementRequests/NewPR/NewCustomPR";
import { ProcurementRequests } from "./pages/ProcurementRequests/VendorQuotesSelection/procurement-requests";
import { RenderProcurementRequest } from "./pages/ProcurementRequests/VendorQuotesSelection/render-procurement-requests";
import OrderPaymentSummary from "./pages/ProjectPayments/order-payment-summary";
import { ProjectPaymentsPaymentWise } from "./pages/ProjectPayments/project-payments-payment-wise";
import { RenderSentBackComponent } from "./pages/Sent Back Requests/RenderSentBackComponent";
import { RenderSRComponent } from "./pages/ServiceRequests/RenderSRComponent";
import { ServiceRequestsTabs } from "./pages/ServiceRequests/ServiceRequestsTabs";
import ApprovedSR from "./pages/ServiceRequests/service-request/approved-sr";
import ListSR from "./pages/ServiceRequests/service-request/list-sr";
import SelectServiceVendor from "./pages/ServiceRequests/service-request/select-service-vendor";
import ForgotPassword from "./pages/auth/forgot-password";
import Login from "./pages/auth/old-login";
import NewCustomer from "./pages/customers/add-new-customer";
import Customers from "./pages/customers/customers";
import EditCustomer from "./pages/customers/edit-customer";
import Dashboard from "./pages/dashboard";
import { PDF } from "./pages/pdf";
import { InFlowPayments } from "./pages/projects/InFlowPayments";
import { EditProjectForm } from "./pages/projects/edit-project-form";
import { ProjectForm } from "./pages/projects/project-form";
import Projects from "./pages/projects/projects";
import Roles from "./pages/roles";
import EditUserForm from "./pages/users/EditUserForm";
import { UserForm } from "./pages/users/user-form";
import Profile from "./pages/users/user-profile";
import Users from "./pages/users/users";
import { EditVendor } from "./pages/vendors/edit-vendor";
import { NewVendor } from "./pages/vendors/new-vendor";
import Vendors from "./pages/vendors/vendors";
import WorkPackages from "./pages/work-packages";
import { ProtectedRoute } from "./utils/auth/ProtectedRoute";
import { UserProvider } from "./utils/auth/UserProvider";
// import { SentBackSummary } from './components/procurement/sent-back-summary'
// import { ManPowerReport } from './components/ManPowerReport'


// const Component = React.lazy(() => import("../src/pages/ProcurementRequests/ApproveVendorQuotes/approve-r-reject-vendor-quotes"));

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/" element={<ProtectedRoute />}>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />

          {/* PRs & Milestones Paths */}
          <Route path="prs&milestones">
            <Route index element={<ProjectManager />} />
            {/* Procurement Request Paths */}
            <Route path="procurement-requests">
              <Route index element={<ListPR />} />
              {/* <Route path=":id/new" lazy={() => import('@/components/procurement-request/new-pr')} /> */}
              <Route path=":projectId">
                {/* <Route index element={<WPSelection />} /> */}
                <Route path="new-pr" element={<NewProcurementRequest />} />
                <Route path="new-custom-pr" element={<NewCustomPR />} />
              </Route>
              <Route path=":prId">
                <Route
                  path="resolve-pr"
                  element={<NewProcurementRequest resolve={true} />}
                />
                <Route
                  path="resolve-custom-pr"
                  element={<NewCustomPR resolve={true} />}
                />
                <Route
                  path="edit-pr"
                  element={<NewProcurementRequest edit={true} />}
                />
                <Route index lazy={() => import("@/components/pr-summary")} />
                <Route path=":poId">
                  <Route index lazy={() => import("@/components/POSummary")} />
                </Route>
                <Route path="dn">
                  <Route path=":dnId" element={<DeliveryNote />} />
                  <Route path=":dnId/:poId" lazy={() => import("@/components/POSummary")} />
                </Route>
              </Route>
            </Route>

            {/* Delivery Notes Paths */}
            <Route path="delivery-notes">
              <Route index element={<DeliveryNotes />} />
              <Route path=":dnId">
                <Route index element={<DeliveryNote />} />
                <Route path=":prId">
                  <Route index lazy={() => import("@/components/pr-summary")} />
                  <Route path=":poId" lazy={() => import("@/components/POSummary")} />
                </Route>
              </Route>
            </Route>
            <Route path="man-power-report">
              <Route index element={<ManPowerReport />} />
              <Route path=":projectId" element={<ManPowerOverallSummary />} />
            </Route>
          </Route>

          {/* Service Requests Paths */}
          <Route path="service-requests-list">
            <Route index element={<ListSR />} />
            <Route
              path=":project/new-sr"
              lazy={() =>
                import("@/pages/ServiceRequests/service-request/new-service-request")
              }
            />
            <Route path=":srId">
              <Route
                index
                lazy={() => import("@/pages/ServiceRequests/service-request/sr-summary")}
              />

              <Route
                path="order-view"
                element={<ApprovedSR summaryPage={true}  />}
              />

              <Route
                path="resolve-sr"
                // lazy={() =>
                //   import("@/pages/ServiceRequests/service-request/select-service-vendor")
                // }
                element={<SelectServiceVendor />}
              />
            </Route>
          </Route>

          <Route path="service-requests">
              <Route index element={<ServiceRequestsTabs />} />
              <Route path=":srId" element={<RenderSRComponent />} />
          </Route>

          <Route path="procurement-requests">
            <Route index element={<ProcurementRequests />} />
            <Route path=":prId" element={<RenderProcurementRequest />} />
          </Route>

          <Route path='purchase-orders'>
            <Route index element={<ReleasePOSelect />} />
            {/* <Route path=":poId" element={<PurchaseOrder />} /> */}
            <Route path=":id" element={<RenderPurchaseOrdersTab />} />
          </Route>

          <Route path="sent-back-requests">
            {/* <Route index element={<SentBackRequest />} /> */}
            <Route path=":sbId">
              <Route index element={<RenderSentBackComponent />} />
              {/* <Route path="update-quote">
                <Route index element={<SentBackUpdateQuote />} />
                <Route
                  path="choose-vendor"
                  element={<SentBackSelectVendor />}
                />
              </Route> */}
            </Route>
          </Route>

          {/* <Route path="choose-service-vendor">
            <Route index element={<SelectServiceVendorList />} />
            <Route
              path=":srId"
              lazy={() =>
                import("@/components/service-request/select-service-vendor")
              }
            />
          </Route>

          <Route path="approved-sr">
            <Route index element={<ApprovedSRList />} />
            <Route path=":srId" element={<ApprovedSR />} />
          </Route> */}

          {/* Approve PR Paths  */}
          {/* <Route path="approve-new-pr">
            <Route index element={<ApprovePR />} />
            <Route path=":prId" lazy={() => import("@/pages/ProcurementRequests/ApproveNewPR/approve-order")} />
          </Route> */}

          {/* Approve PO Paths  */}
          {/* <Route path="approve-po">
            <Route index element={<ApproveSelectVendor />} />
            <Route path=":prId" lazy={() => import("@/pages/approve-vendor")} />
            <Route path=":prId" 
              lazy={() => import("@/pages/ProcurementRequests/ApproveVendorQuotes/approve-r-reject-vendor-quotes")}
             />
          </Route> */}

          {/* Approve Amended PO Paths  */}
          {/* <Route path="approve-amended-po">
            <Route index element={<ApproveSelectAmendPO />} />
            <Route
              path=":poId"
              lazy={() => import("@/pages/approve-amend-po")}
            />
          </Route> */}

          {/* Approve Sent Back Paths  */}
          {/* <Route path="approve-sent-back">
            <Route index element={<ApproveSelectSentBack />} />
            <Route
              path=":sbId"
              lazy={() => import("@/pages/Sent Back Requests/ApproveSBVendorQuotes")}
            />
          </Route> */}

          {/* Approve Service Request Paths  */}
          {/* <Route path="approve-service-request">
            <Route index element={<ApproveSelectSR />} />
            <Route path=":srId" element={<ApproveServiceRequest />} />
          </Route> */}

          {/* Approve Amended Service Request Paths  */}
          {/* <Route path="approve-amended-so">
            <Route index element={<ApproveSelectAmendSR />} />
            <Route path=":soId" 
              lazy={() => import("@/pages/ServiceRequests/service-request/approve-amended-sr")}
             />
          </Route>

          <Route path="approve-payments">
            <Route index element={<ApprovePayments />} />
          </Route> */}

          {/* New PR Request Paths  */}
          {/* <Route path="new-procure-request">
            <Route index element={<PRList />} />
            <Route path=":prId" element={<ProcurementOrder />} />
          </Route> */}

          {/* Update Quote Paths  */}
          {/* <Route path="update-quote">
            <Route index element={<QuoteUpdateSelect />} />
            <Route path=":prId" element={<UpdateQuote />} />
          </Route> */}

          {/* Select Vendor Paths  */}
          {/* <Route path="choose-vendor">
            <Route index element={<SelectVendorList />} />
            <Route path=":prId" element={<SelectVendors />} />
          </Route> */}



          {/* Approved PO Paths  */}
          {/* <Route path="approved-po">
            <Route
              index
              element={<ReleasePOSelect not={false} status="PO Approved" />}
            />
            <Route path=":poId" 
            // element={<ReleasePONew not={false} />} 
            element={<PurchaseOrder not={false} />} 
            />
          </Route> */}

          {/* Released PO Paths  */}
          {/* <Route path="released-po">
            <Route
              index
              element={<ReleasePOSelect not={true} status="PO Approved" />}
            />
            <Route path=":poId" 
            // element={<ReleasePONew not={true} />}
            element={<PurchaseOrder not={true} />} 
            />
          </Route> */}

          {/* Sent Back Paths */}
          {/* <Route path="rejected-sb">
            <Route index element={<SentBackRequest type="Rejected" />} />
            <Route path=":sbId">
              <Route index element={<SentBackSummary />} />
              <Route path="update-quote">
                <Route index element={<SentBackUpdateQuote />} />
                <Route
                  path="choose-vendor"
                  element={<SentBackSelectVendor />}
                />
              </Route>
            </Route>
          </Route>

          <Route path="delayed-sb">
            <Route index element={<SentBackRequest type="Delayed" />} />
            <Route path=":sbId">
              <Route index element={<SentBackSummary />} />
              <Route path="update-quote">
                <Route index element={<SentBackUpdateQuote />} />
                <Route
                  path="choose-vendor"
                  element={<SentBackSelectVendor />}
                />
              </Route>
            </Route>
          </Route>

          <Route path="cancelled-sb">
            <Route index element={<SentBackRequest type="Cancelled" />} />
            <Route path=":sbId">
              <Route index element={<SentBackSummary />} />
              <Route path="update-quote">
                <Route index element={<SentBackUpdateQuote />} />
                <Route
                  path="choose-vendor"
                  element={<SentBackSelectVendor />}
                />
              </Route>
            </Route>
          </Route> */}

          <Route path="estimate-overview">
            <Route index element={<EstimatedPriceOverview />} />
          </Route>

          {/* Project Paths */}
          <Route path="projects">
            <Route index element={<Projects />} />
            <Route path="new-project" element={<ProjectForm />} />
            <Route
              path=":projectId"
              lazy={() => import("@/pages/projects/project")}
            />
            <Route
              path=":projectId/add-estimates"
              lazy={() => import("@/pages/projects/add-project-estimates")}
            />
            <Route path=":projectId/edit" element={<EditProjectForm />} />
            <Route path=":projectId/po/:poId" lazy={() => import("@/components/POSummary")} />
            <Route path=":projectId/:prId">
              <Route index lazy={() => import("@/components/pr-summary")} />
              <Route path=":poId" lazy={() => import("@/components/POSummary")} />
              <Route path="dn">
                <Route path=":dnId" element={<DeliveryNote />} />
              </Route>
            </Route>
          </Route>

          <Route
            path="project-payments">
            <Route index element={<ProjectPaymentsPaymentWise />} />
            <Route path=":id" element={<OrderPaymentSummary />} />
          </Route>

          <Route
            path="in-flow-payments">
            <Route index element={<InFlowPayments />} />
          </Route>

          {/* User Paths */}
          <Route path="users">
            <Route index element={<Users />} />
            <Route path="new-user" element={<UserForm />} />
            <Route path=":userId" element={<Profile />} />
            <Route path=":userId/edit" element={<EditUserForm />} />
          </Route>

          {/* Item Paths  */}
          <Route path="items">
            <Route index element={<Items />} />
            <Route path=":itemId" lazy={() => import("@/pages/Items/item")} />
          </Route>

          {/* Vendor Paths  */}
          <Route path="vendors">
            <Route index element={<Vendors />} />
            <Route path="new-vendor" element={<NewVendor />} />
            <Route path=":vendorId">
              <Route index lazy={() => import("@/pages/vendors/vendor")} />
              <Route path=":poId" lazy={() => import("@/components/POSummary")} />
              <Route path="edit" element={<EditVendor />} />
            </Route>
          </Route>

          {/* Customer Paths */}
          <Route path="customers">
            <Route index element={<Customers />} />
            <Route path="new-customer" element={<NewCustomer />} />
            <Route
              path=":customerId"
              lazy={() => import("@/pages/customers/customer")}
            />
            <Route path=":customerId/edit" element={<EditCustomer />} />
          </Route>

          <Route path="notifications">
            <Route index element={<NotificationsPage />} />
          </Route>

          <Route path="roles">
            <Route index element={<Roles />} />
          </Route>

          {/* Debug Paths  */}
          <Route path="approved-quotes">
            {/* <Route index element={<Debug />} /> */}
            <Route index element={<ApprovedQuotationsTable />} />
            <Route path=":poId" lazy={() => import("@/components/POSummary")} />
          </Route>

          {/* Debug Paths  */}
          <Route path="debug">
            {/* <Route index element={<Debug />} /> */}
            <Route index element={<ApprovedQuotationsTable />} />
            <Route path=":poId" lazy={() => import("@/components/POSummary")} />
          </Route>

          <Route path="live-pr-tracking">
            <Route index element={<LivePRTrackingTable />} />
          </Route>

          {/* Other routes */}
          <Route path="wp" element={<WorkPackages />} />
          <Route
            path="procurement-packages"
            element={<ProcurementPackages />}
          />
          <Route path="pdf" element={<PDF />} />
          <Route path="milestone-update" element={<NewMilestones />} />
          {/* <Route path="delayed-pr" element={<DelayedPRSelect />} />
          <Route path="delayed-pr/:id" element={<DelayedPR />} /> */}
        </Route>
      </Route>
    </>
  ),
  {
    basename: `/${import.meta.env.VITE_BASE_NAME}` ?? "",
  }
);

const App: FC = () => {
  useEffect(() => {
    // Firebase onMessage handler for foreground notifications
    onMessage(messaging, (payload) => {
      console.log("Message received in the foreground: ", payload);

      const notificationTitle = payload?.notification?.title || "";
      const notificationOptions = {
        body: payload?.notification?.body,
        icon: payload?.notification?.icon || "../src/assets/red-logo.png",
        data: { click_action_url: payload?.data?.click_action_url },
      };

      const notification = new Notification(
        notificationTitle,
        notificationOptions
      );

      notification.onclick = () => {
        window.open(notificationOptions.data.click_action_url || "/", "_blank");
      };
    });
  }, []);

  const getSiteName = () => {
    // @ts-ignore
    // if (window.frappe?.boot?.versions?.frappe && (window.frappe.boot.versions.frappe.startsWith('15') || window.frappe.boot.versions.frappe.startsWith('16'))) {
    // 	// @ts-ignore
    // 	return window.frappe?.boot?.sitename ?? import.meta.env.VITE_SITE_NAME
    // }
    return window.frappe?.boot?.sitename !== undefined
      ? window.frappe?.boot?.sitename
      : import.meta.env.VITE_SITE_NAME;
  };

  // const queryClient = new QueryClient()

  return (
    <FrappeProvider
      url={import.meta.env.VITE_FRAPPE_PATH ?? ""}
      socketPort={
        import.meta.env.VITE_SOCKET_PORT
          ? import.meta.env.VITE_SOCKET_PORT
          : undefined
      }
      //@ts-ignore
      siteName={getSiteName()}
    >
      <UserProvider>
        <SidebarProvider>
          {/* <QueryClientProvider client={queryClient}> */}
          <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
            <RouterProvider router={router} />
          </ThemeProvider>
          {/* </QueryClientProvider> */}
        </SidebarProvider>
      </UserProvider>
    </FrappeProvider>
  );
};

export default App;